/**
 * S8.2 — `LLM Voice: Use My Own Voice` (CdC §55) against a real extension
 * host. Only the "existing file" branch is driven end to end here — the
 * "record now" branch's platform-command/clipboard/file-watch logic is
 * covered in plain Node by `test/unit/onboarding/useOwnVoiceFlow.test.ts`,
 * which does not need a real VS Code at all.
 *
 * Every dialog VS Code would show is stubbed to answer deterministically
 * (same technique as `test/integration/commandUx.test.ts`'s
 * `stubUserInteractions`) so the whole wizard runs under `xvfb` without a
 * human. "Tout reste local" is asserted directly: the copied file lives
 * under this test run's own `globalStorageUri`, and the only network-ish
 * activity possible here is the fake TTS provider, in-process.
 */
import * as assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import type { FakeTtsProvider } from "../fakes/FakeTtsProvider.js";
import type { VoiceProfile } from "../../src/core/profile.js";
import { makeSilentWav, makeToneWav } from "../fakes/wav.js";

async function activateExtension(): Promise<ExtensionTestApi> {
  const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
  assert.ok(extension, "extension should be discoverable by id");
  const api = (await extension?.activate()) as ExtensionTestApi;
  assert.ok(api.ttsProvider, "LLM_VOICE_TEST_FAKE_TTS=1 should inject a FakeTtsProvider");
  return api;
}

interface TestPipeline {
  importProfileFromJson(json: string): Promise<VoiceProfile>;
  selectProfileById(id: string): Promise<void>;
  deleteProfileById(id: string): Promise<void>;
  getProfileById(id: string): Promise<VoiceProfile>;
  useOwnVoice(): Promise<void>;
}

function testPipeline(api: ExtensionTestApi): TestPipeline {
  return api.pipeline as unknown as TestPipeline;
}

function fakeProfileJson(id: string): string {
  const profile: VoiceProfile = {
    id,
    label: "Use My Own Voice test profile",
    mode: "faithful",
    language: "fr-FR",
    tts: { providerId: "fake-tts", baseUrl: "http://127.0.0.1:9" },
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 0 },
    playback: { rate: 1, volume: 1 }
  };
  return JSON.stringify(profile);
}

/** Stubs the dialog sequence the "existing file" branch drives through. */
function stubFileFlow(samplePath: string): () => void {
  const window = vscode.window as unknown as Record<string, unknown>;
  const originals = {
    showWarningMessage: window.showWarningMessage,
    showQuickPick: window.showQuickPick,
    showOpenDialog: window.showOpenDialog,
    showInformationMessage: window.showInformationMessage
  };
  window.showWarningMessage = () => Promise.resolve("Continuer");
  window.showQuickPick = () => Promise.resolve({ label: "file", value: "file" });
  window.showOpenDialog = () => Promise.resolve([vscode.Uri.file(samplePath)]);
  window.showInformationMessage = () => Promise.resolve(undefined);
  return () => Object.assign(window, originals);
}

suite("LLM Voice: Use My Own Voice (S8.2, CdC §55)", () => {
  test("registers the command", async () => {
    await activateExtension();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("llmVoice.useOwnVoice"));
  });

  test("an existing WAV file is validated, copied locally, applied and previewed", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const sink = api.ttsProvider as unknown as FakeTtsProvider;

    const profileId = `use-own-voice-${Date.now()}`;
    const imported = await pipeline.importProfileFromJson(fakeProfileJson(profileId));
    await pipeline.selectProfileById(imported.id);

    // Run-unique test text so this run's preview cannot hit an earlier
    // run's `DiskAudioCache` entry and skip the fake provider (same
    // rationale as `profiles.test.ts`'s "testVoice does not crash" case).
    await vscode.workspace
      .getConfiguration("llmVoice")
      .update("testVoice.text", `Voix personnelle ${Date.now()}.`, vscode.ConfigurationTarget.Global);

    const dir = mkdtempSync(join(tmpdir(), "llm-voice-own-voice-"));
    const samplePath = join(dir, "sample.wav");
    writeFileSync(samplePath, makeToneWav(15_000, 300, 24000));

    const restore = stubFileFlow(samplePath);
    const before = sink.requests.length;
    try {
      await pipeline.useOwnVoice();
    } finally {
      restore();
    }

    const updated = await pipeline.getProfileById(imported.id);
    assert.ok(updated.tts.referenceAudio, "referenceAudio should be set on the profile");
    assert.ok(
      updated.tts.referenceAudio!.split(/[\\/]/).includes("voices"),
      `expected the copy to live under a "voices" directory, got ${updated.tts.referenceAudio}`
    );
    assert.ok(existsSync(updated.tts.referenceAudio!), "the copied/converted file should exist on disk");
    assert.ok(sink.requests.length > before, "the immediate preview should reach the TTS provider");

    await pipeline.deleteProfileById(imported.id);
  });

  test("a silent recording is rejected and never applied to the profile", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);

    const profileId = `use-own-voice-silent-${Date.now()}`;
    const imported = await pipeline.importProfileFromJson(fakeProfileJson(profileId));
    await pipeline.selectProfileById(imported.id);

    const dir = mkdtempSync(join(tmpdir(), "llm-voice-own-voice-silent-"));
    const samplePath = join(dir, "silent.wav");
    writeFileSync(samplePath, makeSilentWav(15_000, 24000));

    const restore = stubFileFlow(samplePath);
    try {
      await pipeline.useOwnVoice();
    } finally {
      restore();
    }

    const updated = await pipeline.getProfileById(imported.id);
    assert.equal(updated.tts.referenceAudio, undefined, "a silent sample must never be applied");

    await pipeline.deleteProfileById(imported.id);
  });

  test("declining consent leaves the profile untouched", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);

    const profileId = `use-own-voice-decline-${Date.now()}`;
    const imported = await pipeline.importProfileFromJson(fakeProfileJson(profileId));
    await pipeline.selectProfileById(imported.id);

    const window = vscode.window as unknown as Record<string, unknown>;
    const original = window.showWarningMessage;
    window.showWarningMessage = () => Promise.resolve(undefined);
    try {
      await pipeline.useOwnVoice();
    } finally {
      window.showWarningMessage = original;
    }

    const updated = await pipeline.getProfileById(imported.id);
    assert.equal(updated.tts.referenceAudio, undefined);

    await pipeline.deleteProfileById(imported.id);
  });
});
