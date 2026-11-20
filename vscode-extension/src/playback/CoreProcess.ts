/**
 * Spawns, attaches to, and supervises `llm-voice-core` (ADR-012 §5).
 *
 * Mirrors `crates/llm-voice-core/src/lock.rs`'s instance-lock protocol from
 * the client side: the same state directory resolution order
 * (`LLM_VOICE_CORE_STATE_DIR` → `XDG_RUNTIME_DIR/llm-voice` →
 * `$HOME/.cache/llm-voice/run`), the same `core.json` shape (`pid`, `port`,
 * `token`, `protocolVersion`, camelCase — `CoreStateFile`'s `serde(rename_all
 * = "camelCase")`), and the same exit code for "another instance already
 * holds the lock" (`ALREADY_RUNNING_EXIT_CODE = 17`, `lock.rs`). This class
 * never takes the `flock` itself (only the Rust binary does, `InstanceLock`)
 * — it just reads what the winner published, exactly like
 * `scripts/audio-spike/core-play.sh` does over `jq`.
 *
 * Three things this class owns:
 *  - **attach-or-spawn** (`ensureRunning`): reuse a Core already running for
 *    another VS Code window (`core.json` + a live `GET /health`) before ever
 *    spawning a new one — the whole point of "deux clients, une seule
 *    lecture" (ADR-012 §5);
 *  - **crash-restart**: one bounded automatic respawn if the process this
 *    instance itself spawned exits unexpectedly;
 *  - **shutdown scoping**: `dispose()` only ever kills a Core this instance
 *    spawned, never one it merely attached to — killing an attached Core on
 *    every window's deactivation would defeat the instance lock for whatever
 *    other window is still using it. The Core has no idle-timeout
 *    self-shutdown yet (`main.rs` only reacts to `SIGTERM`/`SIGINT`); until
 *    one exists, a Core nobody explicitly stopped can outlive every window
 *    that used it — a known limitation to close in a follow-up card, not a
 *    contradiction of this brief's "l'arrête à la désactivation" (which this
 *    class honours for the one case it can: the Core it spawned itself).
 */

import { constants as fsConstants } from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { NativeCoreConnection } from "./NativeAudioSink.js";

/** `crates/llm-voice-core/src/lock.rs::ALREADY_RUNNING_EXIT_CODE`. */
export const ALREADY_RUNNING_EXIT_CODE = 17;

export interface CoreProcessLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface CoreProcessOptions {
  /**
   * Absolute path every `enqueue`d file must resolve under
   * (`DiskAudioCache`'s `root`; becomes `LLM_VOICE_CACHE_DIR`).
   */
  cacheDir: string;
  /** `context.extensionUri.fsPath`: where a packaged `bin/<target>/` lives. */
  extensionPath: string;
  /** `llmVoice.audio.corePath`, when the user set one (absolute path). */
  corePathOverride?: string;
  /** Tests only: an isolated state dir, never the user's real one. */
  stateDirOverride?: string;
  log?: CoreProcessLogger;
  /** Automatic respawns after an unexpected crash (default: one). */
  maxRestarts?: number;
  /** Test seam; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface CoreStateFile {
  pid: number;
  port: number;
  token: string;
  protocolVersion: string;
}

const STATE_FILE_NAME = "core.json";
const SPAWN_TIMEOUT_MS = 5000;
const SPAWN_POLL_MS = 50;
const HEALTH_TIMEOUT_MS = 1000;

function platformTarget(): string {
  const { platform, arch } = process;
  if (platform === "linux") {
    return arch === "arm64" ? "linux-arm64" : "linux-x64";
  }
  if (platform === "darwin") {
    return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  }
  if (platform === "win32") {
    return "win32-x64";
  }
  throw new Error(`llm-voice-core: plateforme non prise en charge par ADR-012 (${platform})`);
}

function binaryName(): string {
  return process.platform === "win32" ? "llm-voice-core.exe" : "llm-voice-core";
}

export class CoreProcess {
  private child: ChildProcess | undefined;
  private restarts = 0;
  private stopped = false;
  private ensuring: Promise<NativeCoreConnection> | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CoreProcessOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Resolves once a Core (existing or freshly spawned) answers `/health`.
   * Safe to call repeatedly and concurrently: in-flight calls share one
   * attempt, and a later call after a crash-restart re-resolves fresh
   * connection details.
   */
  async ensureRunning(): Promise<NativeCoreConnection> {
    this.ensuring ??= this.doEnsure().finally(() => {
      this.ensuring = undefined;
    });
    return this.ensuring;
  }

  /** Stops the Core, but only the one this instance spawned (class doc). */
  dispose(): void {
    this.stopped = true;
    if (this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
    }
    this.child = undefined;
  }

  // --------------------------------------------------------------- internals

  private get stateDir(): string {
    if (this.options.stateDirOverride !== undefined) {
      return this.options.stateDirOverride;
    }
    const override = process.env.LLM_VOICE_CORE_STATE_DIR;
    if (override !== undefined && override.length > 0) {
      return override;
    }
    const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
    if (xdgRuntimeDir !== undefined && xdgRuntimeDir.length > 0) {
      return path.join(xdgRuntimeDir, "llm-voice");
    }
    return path.join(os.homedir(), ".cache", "llm-voice", "run");
  }

  private get stateFilePath(): string {
    return path.join(this.stateDir, STATE_FILE_NAME);
  }

  private async doEnsure(): Promise<NativeCoreConnection> {
    const attached = await this.tryAttach();
    if (attached !== undefined) {
      return attached;
    }
    return this.spawnAndWait();
  }

  private async tryAttach(): Promise<NativeCoreConnection | undefined> {
    const state = await this.readState();
    if (state === undefined) {
      return undefined;
    }
    const connection = this.connectionFrom(state);
    return (await this.healthCheck(connection)) ? connection : undefined;
  }

  private async readState(): Promise<CoreStateFile | undefined> {
    try {
      const raw = await fsp.readFile(this.stateFilePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as CoreStateFile).pid === "number" &&
        typeof (parsed as CoreStateFile).port === "number" &&
        typeof (parsed as CoreStateFile).token === "string" &&
        typeof (parsed as CoreStateFile).protocolVersion === "string"
      ) {
        return parsed as CoreStateFile;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private connectionFrom(state: CoreStateFile): NativeCoreConnection {
    return {
      baseUrl: `http://127.0.0.1:${state.port}`,
      wsUrl: `ws://127.0.0.1:${state.port}/v1/ws`,
      token: state.token
    };
  }

  private async healthCheck(connection: NativeCoreConnection): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, HEALTH_TIMEOUT_MS);
      try {
        const response = await this.fetchImpl(`${connection.baseUrl}/health`, {
          signal: controller.signal
        });
        if (!response.ok) {
          return false;
        }
        const body = (await response.json()) as { protocolVersion?: unknown; status?: unknown };
        return typeof body.protocolVersion === "string" && body.protocolVersion.startsWith("1.");
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }

  private async resolveBinaryPath(): Promise<string> {
    const candidates = [
      this.options.corePathOverride,
      path.join(this.options.extensionPath, "bin", platformTarget(), binaryName()),
      // Dev fallback: `cargo build --release -p llm-voice-core` from the
      // monorepo root (`vscode-extension/..`), never used in a packaged VSIX
      // (no `Cargo.toml`/`target/` ships in it).
      path.join(this.options.extensionPath, "..", "target", "release", binaryName())
    ].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);

    for (const candidate of candidates) {
      try {
        await fsp.access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }
    throw new Error(
      `llm-voice-core introuvable (essayé : ${candidates.join(", ")}). Compile-le avec ` +
        "'cargo build --release -p llm-voice-core' ou configure 'llmVoice.audio.corePath'."
    );
  }

  private async spawnAndWait(): Promise<NativeCoreConnection> {
    const binPath = await this.resolveBinaryPath();
    const token = randomBytes(16).toString("hex");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LLM_VOICE_CORE_TOKEN: token,
      LLM_VOICE_CACHE_DIR: this.options.cacheDir
    };
    if (this.options.stateDirOverride !== undefined) {
      env.LLM_VOICE_CORE_STATE_DIR = this.options.stateDirOverride;
    }
    // Stable PipeWire identity (GAO-s1-fedora-va-001): without it the stream
    // shows up as "PipeWire ALSA [llm-voice-core]" and WirePlumber restores
    // its output under that generic key. With a named application the user
    // sees "LLM Voice" in the desktop sound settings, can move it to any
    // output, and WirePlumber remembers that choice like for any desktop app.
    // An explicit PIPEWIRE_PROPS from the environment (test bench) wins.
    if (process.platform === "linux" && env.PIPEWIRE_PROPS === undefined) {
      env.PIPEWIRE_PROPS =
        '{ application.name = "LLM Voice" application.id = "llm-voice" node.name = "llm-voice-core" node.description = "LLM Voice" media.role = "Accessibility" }';
    }
    // `--parent-pid`: lets the Core stop itself when this extension host
    // dies without a clean `dispose()` (F-02, evidence-pack
    // GAO-audit-s-curi-001 — `main.rs::parse_parent_pid`/`wait_for_parent_death`
    // poll `/proc/<pid>` at most once a second).
    const child = spawn(binPath, ["--parent-pid", String(process.pid)], {
      env,
      stdio: ["ignore", "ignore", "pipe"]
    });
    this.child = child;
    this.wireLifecycle(child);
    try {
      return await this.waitForState(child, token);
    } catch (error) {
      if (this.child === child) {
        this.child = undefined;
      }
      throw error;
    }
  }

  private waitForState(child: ChildProcess, token: string): Promise<NativeCoreConnection> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const deadline = Date.now() + SPAWN_TIMEOUT_MS;

      const onExit = (code: number | null): void => {
        if (settled) {
          return;
        }
        if (code === ALREADY_RUNNING_EXIT_CODE) {
          // Lost a race with another window's Core: attach to the winner.
          settled = true;
          this.tryAttach().then(
            (connection) => {
              if (connection !== undefined) {
                resolve(connection);
              } else {
                reject(new Error("llm-voice-core: instance concurrente introuvable après le code 17"));
              }
            },
            (error: unknown) => {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          );
          return;
        }
        settled = true;
        reject(new Error(`llm-voice-core s'est arrêté avant de publier son état (code ${code ?? "signal"})`));
      };
      child.once("exit", onExit);

      const poll = (): void => {
        if (settled) {
          return;
        }
        this.readState()
          .then((state) => {
            if (settled) {
              return;
            }
            if (state !== undefined && state.pid === child.pid && state.token === token) {
              settled = true;
              child.off("exit", onExit);
              resolve(this.connectionFrom(state));
              return;
            }
            if (Date.now() > deadline) {
              settled = true;
              child.off("exit", onExit);
              reject(new Error("llm-voice-core: core.json jamais publié (délai dépassé)"));
              return;
            }
            setTimeout(poll, SPAWN_POLL_MS);
          })
          .catch((error: unknown) => {
            if (!settled) {
              settled = true;
              child.off("exit", onExit);
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
      };
      poll();
    });
  }

  private wireLifecycle(child: ChildProcess): void {
    child.stderr?.on("data", (chunk: Buffer) => {
      this.options.log?.info(`llm-voice-core: ${chunk.toString("utf8").trim()}`);
    });
    child.once("exit", (code, signal) => {
      if (this.child !== child) {
        return;
      }
      this.child = undefined;
      if (this.stopped || code === ALREADY_RUNNING_EXIT_CODE) {
        return;
      }
      this.options.log?.warn("llm-voice-core: arrêt inattendu", { code, signal });
      if (this.restarts < (this.options.maxRestarts ?? 1)) {
        this.restarts += 1;
        void this.ensureRunning().catch((error: unknown) => {
          this.options.log?.error("llm-voice-core: relance impossible", {
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    });
  }
}
