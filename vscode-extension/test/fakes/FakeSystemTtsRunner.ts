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
 * Finds a fake `espeak-ng` only — `which("piper")` always resolves to
 * `undefined`, so `SystemTtsProvider.detectPiper()` never even reaches the
 * voice-model search that a real machine's home directory could otherwise
 * satisfy. Deterministic "fallback available" (case 1).
 */
export class EspeakOnlyRunner implements SystemTtsProcessRunner {
  private static readonly FAKE_BINARY_PATH = "/fake/espeak-ng";

  async which(command: string): Promise<string | undefined> {
    return command === "espeak-ng" ? EspeakOnlyRunner.FAKE_BINARY_PATH : undefined;
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
  /** Mirrors `buildEspeakInvocation`'s own argv shape (`-w <output.wav>` for synthesis). */
  async run(invocation: SystemTtsInvocation, _options: RunOptions): Promise<void> {
    const wIndex = invocation.args.indexOf("-w");
    const outputPath = wIndex !== -1 ? invocation.args[wIndex + 1] : undefined;
    if (outputPath === undefined) {
      throw new Error("EspeakOnlyRunner: missing -w output path");
    }
    fs.writeFileSync(outputPath, makeSilentWav(300, 22050));
  }
  /** `--voices=fr` (voice listing) is the only `capture()` call `SystemTtsProvider` makes for this engine. */
  async capture(_invocation: SystemTtsInvocation, _options: RunOptions): Promise<string> {
    return FAKE_ESPEAK_VOICES_TABLE;
  }
}
