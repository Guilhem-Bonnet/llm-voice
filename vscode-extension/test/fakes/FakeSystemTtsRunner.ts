/**
 * Fake `SystemTtsProcessRunner` implementations (coordinator review of the
 * voice-selection-not-applied / infinite loop fix, 2026-09-12).
 *
 * `test/integration-real/tts-fallback-succeeds.test.ts` and
 * `tts-fallback-fails.test.ts` used to try to make `SystemTtsProvider`
 * deterministic by manipulating the extension host's `PATH` env var
 * (mirroring `system-no-engine`'s existing approach) — verified live not to
 * work in this environment: VS Code's own "resolve shell environment"
 * startup step re-derives `PATH` from the user's actual login shell before
 * the extension host ever sees it, silently discarding/merging whatever
 * `.vscode-test.mjs`'s `env.PATH` set. On a machine with a real
 * `espeak-ng`/`piper` installed (this repo's own dev machine), that made
 * `SystemTtsProvider` find the *real* engine regardless of what the test
 * asked for — exactly the kind of machine-dependent result the coordinator
 * flagged.
 *
 * `SystemTtsProviderOptions.runner` is the seam this class actually needs:
 * injected via `Pipeline`'s own test-only `systemRunnerOverride`
 * (`extension.ts`, same `extensionMode !== Production` gate as
 * `LLM_VOICE_TEST_FAKE_TTS`), it replaces `createDefaultRunner` entirely —
 * no `PATH` lookup, no real filesystem/process access, ever.
 */
import * as fs from "node:fs";
import type { RunOptions, SystemTtsInvocation, SystemTtsProcessRunner } from "../../src/tts/SystemTtsProvider.js";
import { makeSilentWav } from "./wav.js";

const FAKE_ESPEAK_VOICES_TABLE =
  "Pty Language Age/Gender VoiceName          File          Other Languages\n" +
  " 5  fr             M  french               fr\n";

/** One plain name per line — `parseSapiVoices`'s expected `-List` shape. */
const FAKE_SAPI_VOICES_LIST = "Microsoft Hortense Desktop\n";

/**
 * `SystemTtsProvider.detectEngine()` (`src/tts/SystemTtsProvider.ts`)
 * branches on the *real* `os.platform()` the CI runner happens to be —
 * `win32` never even calls `which("espeak-ng")` (it calls
 * `which("powershell")`/`which("pwsh")` for SAPI instead), `darwin` calls
 * `which("say")`. A runner that only answers `espeak-ng` truthily is
 * therefore only ever "found" on Linux runners — confirmed live: the
 * Windows leg of this PR's own CI failed with "expected the espeak-ng
 * fallback to succeed, got state 'error'" because `detectSapi()` never
 * found a `powershell`/`pwsh` this runner didn't know to answer for.
 * Answering for all four keeps the fake OS-agnostic, matching what these
 * tests' own doc comments already claim ("never depends on the real
 * machine"/"whichever OS runs the suite").
 */
const FAKE_SYSTEM_ENGINE_COMMANDS = new Set(["espeak-ng", "say", "powershell", "pwsh"]);

/** Finds the output-path argument regardless of which engine's invocation shape actually arrived (`-w` espeak-ng, `-o` say, `-OutputPath` SAPI). */
function findOutputPath(args: readonly string[]): string | undefined {
  for (const flag of ["-w", "-o", "-OutputPath"]) {
    const index = args.indexOf(flag);
    if (index !== -1) {
      return args[index + 1];
    }
  }
  return undefined;
}

/** Finds nothing at all — deterministic "no local engine anywhere" (case 2, "aucun moyen de parler"). */
export class NoEngineRunner implements SystemTtsProcessRunner {
  async which(): Promise<string | undefined> {
    return undefined;
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async writeFile(): Promise<void> {}
  async readFile(): Promise<Buffer> {
    return Buffer.alloc(0);
  }
  async removeFile(): Promise<void> {}
  async readdir(): Promise<string[]> {
    return [];
  }
  async run(): Promise<void> {
    throw new Error("NoEngineRunner: no engine available");
  }
  async capture(): Promise<string> {
    throw new Error("NoEngineRunner: no engine available");
  }
}

/**
 * Finds a fake system engine only — `which("piper")`/`which("piper.exe")`
 * always resolves to `undefined`, so `SystemTtsProvider.detectPiper()`
 * never even reaches the voice-model search that a real machine's home
 * directory could otherwise satisfy. Deterministic "fallback available"
 * (case 1), on every OS `detectEngine()` might branch to (see
 * `FAKE_SYSTEM_ENGINE_COMMANDS`'s doc comment above).
 */
export class EspeakOnlyRunner implements SystemTtsProcessRunner {
  private static readonly FAKE_BINARY_PATH = "/fake/system-tts-engine";

  async which(command: string): Promise<string | undefined> {
    return FAKE_SYSTEM_ENGINE_COMMANDS.has(command) ? EspeakOnlyRunner.FAKE_BINARY_PATH : undefined;
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async writeFile(): Promise<void> {}
  /**
   * `run()` below genuinely writes the fake WAV to the real filesystem
   * path `SystemTtsProvider.synthesizeChunk` picked (`this.tempPath`) —
   * this must read it back for real too, exactly like the default runner
   * (`createDefaultRunner`'s own `readFile`): `synthesizeChunk` throws
   * "produced an empty file" on anything else, byte length being the one
   * thing it actually checks.
   */
  async readFile(candidate: string): Promise<Buffer> {
    return fs.promises.readFile(candidate);
  }
  async removeFile(candidate: string): Promise<void> {
    await fs.promises.rm(candidate, { force: true }).catch(() => {});
  }
  async readdir(): Promise<string[]> {
    return [];
  }
  /** Mirrors whichever engine's argv shape actually arrived (`-w` espeak-ng, `-o` say, `-OutputPath` SAPI). */
  async run(invocation: SystemTtsInvocation, _options: RunOptions): Promise<void> {
    const outputPath = findOutputPath(invocation.args);
    if (outputPath === undefined) {
      throw new Error("EspeakOnlyRunner: could not find an output path in the invocation");
    }
    fs.writeFileSync(outputPath, makeSilentWav(300, 22050));
  }
  /**
   * Voice listing (`SystemTtsProvider.listVoices()`, also reached from
   * `Pipeline.withDefaultVoice` when a profile names no explicit voice):
   * espeak-ng's `--voices=fr` table on Linux, SAPI's `-List` (one name per
   * line, `parseSapiVoices`) on Windows — `say -v '?'` never calls
   * `capture()` with a flag this fake needs to distinguish, so the
   * espeak-ng shape is also a harmless default there (`parseSayVoices`
   * simply matches nothing and returns `[]`, exactly like a real answer it
   * cannot parse would).
   */
  async capture(invocation: SystemTtsInvocation, _options: RunOptions): Promise<string> {
    return invocation.args.includes("-List") ? FAKE_SAPI_VOICES_LIST : FAKE_ESPEAK_VOICES_TABLE;
  }
}
