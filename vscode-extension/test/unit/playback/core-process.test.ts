/**
 * `CoreProcess` (ADR-012 §5, GAO-core-rust-mi-001 étape B): attach-or-spawn,
 * one bounded crash-restart, and shutdown scoped to what this instance
 * itself spawned. Exercised against `test/fakes/fakeCoreBinary.mjs`, a real
 * child process that publishes `core.json` exactly like
 * `crates/llm-voice-core` does — no Rust build required for this suite.
 */
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALREADY_RUNNING_EXIT_CODE, CoreProcess } from "../../../src/playback/CoreProcess.js";

const FAKE_BINARY = path.resolve(__dirname, "../../fakes/fakeCoreBinary.mjs");

describe("CoreProcess", () => {
  let stateDir: string;
  let cacheDir: string;
  let processes: CoreProcess[];

  beforeEach(async () => {
    stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "llm-voice-core-state-"));
    cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), "llm-voice-core-cache-"));
    processes = [];
  });

  afterEach(async () => {
    for (const coreProcess of processes) {
      coreProcess.dispose();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fsp.rm(stateDir, { recursive: true, force: true });
    await fsp.rm(cacheDir, { recursive: true, force: true });
  });

  function make(overrides: Partial<{ maxRestarts: number }> = {}): CoreProcess {
    const coreProcess = new CoreProcess({
      cacheDir,
      extensionPath: "/unused",
      corePathOverride: FAKE_BINARY,
      stateDirOverride: stateDir,
      ...overrides
    });
    processes.push(coreProcess);
    return coreProcess;
  }

  it("spawns the binary and resolves a connection once core.json is published", async () => {
    const core = make();
    const connection = await core.ensureRunning();
    expect(connection.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(connection.wsUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/v1\/ws$/);
    expect(connection.token).toHaveLength(32);
  });

  it("attaches to an already-running Core instead of spawning a second one", async () => {
    const first = make();
    const firstConnection = await first.ensureRunning();

    const second = make();
    const secondConnection = await second.ensureRunning();
    expect(secondConnection).toEqual(firstConnection);
  });

  it("rejects when the binary exits before publishing core.json", async () => {
    const core = new CoreProcess({
      cacheDir,
      extensionPath: "/unused",
      corePathOverride: FAKE_BINARY,
      stateDirOverride: stateDir,
      fetchImpl: fetch
    });
    processes.push(core);
    const originalEnv = process.env.FAKE_CORE_EXIT_CODE;
    process.env.FAKE_CORE_EXIT_CODE = "1";
    try {
      await expect(core.ensureRunning()).rejects.toThrow();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.FAKE_CORE_EXIT_CODE;
      } else {
        process.env.FAKE_CORE_EXIT_CODE = originalEnv;
      }
    }
  });

  it("restarts once after an unexpected crash", async () => {
    const logs: string[] = [];
    const core = new CoreProcess({
      cacheDir,
      extensionPath: "/unused",
      corePathOverride: FAKE_BINARY,
      stateDirOverride: stateDir,
      log: {
        info: () => {},
        warn: (message) => logs.push(message),
        error: (message) => logs.push(message)
      }
    });
    processes.push(core);
    const original = process.env.FAKE_CORE_CRASH_AFTER_MS;
    process.env.FAKE_CORE_CRASH_AFTER_MS = "80";
    try {
      const firstConnection = await core.ensureRunning();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(logs.some((line) => line.includes("arrêt inattendu"))).toBe(true);
      const secondConnection = await core.ensureRunning();
      expect(secondConnection.baseUrl).not.toBe(firstConnection.baseUrl);
    } finally {
      if (original === undefined) {
        delete process.env.FAKE_CORE_CRASH_AFTER_MS;
      } else {
        process.env.FAKE_CORE_CRASH_AFTER_MS = original;
      }
    }
  });

  it("dispose() only stops a Core this instance actually spawned", async () => {
    const owner = make();
    const ownerConnection = await owner.ensureRunning();

    const attacher = make();
    await attacher.ensureRunning();
    attacher.dispose();

    // The attacher never spawned anything: the Core owner started must still
    // answer `/health` (ADR-012 §5, "deux clients, une seule lecture").
    const response = await fetch(`${ownerConnection.baseUrl}/health`);
    expect(response.ok).toBe(true);
  });

  it("exposes the Rust-side ALREADY_RUNNING_EXIT_CODE for reference", () => {
    expect(ALREADY_RUNNING_EXIT_CODE).toBe(17);
  });
});
