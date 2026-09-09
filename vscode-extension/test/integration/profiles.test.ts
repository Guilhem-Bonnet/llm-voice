/**
 * S5.2 — profile management, per-source defaults, Test Voice, Provider
 * Status, SecretStorage keys (CdC §47-51, AC-07/17). Run under the
 * `fake-tts` `.vscode-test.mjs` profile like `pipeline.test.ts`.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import type { FakeTtsProvider } from "../fakes/FakeTtsProvider.js";
import type { VoiceProfile } from "../../src/core/profile.js";

async function waitFor(predicate: () => boolean, timeoutMs = 5000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function activateExtension(): Promise<ExtensionTestApi> {
  const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
  assert.ok(extension, "extension should be discoverable by id");
  const api = (await extension?.activate()) as ExtensionTestApi;
  assert.ok(api.ttsProvider, "LLM_VOICE_TEST_FAKE_TTS=1 should inject a FakeTtsProvider");
  return api;
}

/** Full `PipelineFacade` plus the test-only, non-interactive helpers `Pipeline` adds. */
interface TestPipeline {
  getPlaybackState(): string;
  start(source: { scope: string; text?: string }): Promise<void>;
  selectProfileById(id: string): Promise<void>;
  duplicateProfileById(id: string): Promise<VoiceProfile>;
  deleteProfileById(id: string): Promise<void>;
  setDefaultProfileById(id: string): Promise<void>;
  importProfileFromJson(json: string): Promise<VoiceProfile>;
  exportProfileToJson(id: string): Promise<string>;
  testVoice(): Promise<void>;
  providerStatus(): Promise<void>;
  setProviderApiKeyValue(providerId: string, value: string): Promise<void>;
  clearProviderApiKeyValue(providerId: string): Promise<void>;
  openProfiles(): Promise<void>;
}

function testPipeline(api: ExtensionTestApi): TestPipeline {
  return api.pipeline as unknown as TestPipeline;
}

function importedProfile(id: string, voice: string): string {
  const profile: VoiceProfile = {
    id,
    label: `Test ${voice}`,
    mode: "faithful",
    language: "fr-FR",
    tts: { providerId: "fake-tts", baseUrl: "http://127.0.0.1:9", voice },
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 0 },
    playback: { rate: 1, volume: 1 }
  };
  return JSON.stringify(profile);
}

suite("LLM Voice profiles & status (S5.2, CdC §47-51, AC-07/17)", () => {
  test("AC-07: selecting a different profile sends a different voice to the TTS provider", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const sink = api.ttsProvider as unknown as FakeTtsProvider;

    const profileA = await pipeline.importProfileFromJson(importedProfile("ac07-a", "voice-a"));
    const profileB = await pipeline.importProfileFromJson(importedProfile("ac07-b", "voice-b"));
    // Distinct, run-unique text: `DiskAudioCache` keys on spoken text +
    // provider + voice (ADR-004), so a fixed sentence would hit an earlier
    // run's cached entry on a re-run against the same `.vscode-test`
    // `globalStorageUri` and skip `synthesize()` — a fake TTS *loaded* the
    // same audio either way (AC-07's "different voice" is about the
    // request the provider received, not the cache).
    const runId = Date.now();

    await pipeline.selectProfileById(profileA.id);
    await pipeline.start({ scope: "clipboard", text: `Bonjour le monde ${runId} A.` });
    await waitFor(() => pipeline.getPlaybackState() === "playing");
    const requestsWithA = sink.requests.length;
    assert.equal(sink.requests[requestsWithA - 1]?.voice, "voice-a");

    await pipeline.selectProfileById(profileB.id);
    await pipeline.start({ scope: "clipboard", text: `Bonjour le monde ${runId} B.` });
    await waitFor(() => pipeline.getPlaybackState() === "playing" && sink.requests.length > requestsWithA);
    assert.equal(sink.requests[sink.requests.length - 1]?.voice, "voice-b");

    await pipeline.deleteProfileById(profileA.id);
    await pipeline.deleteProfileById(profileB.id);
  });

  test("openProfiles opens a valid, schema-conformant profiles.json document", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);

    await pipeline.openProfiles();
    await waitFor(() => vscode.window.activeTextEditor?.document.fileName.endsWith("profiles.json") === true);

    const document = vscode.window.activeTextEditor?.document;
    assert.ok(document, "profiles.json should be the active document");
    const parsed: unknown = JSON.parse(document.getText());
    assert.ok(typeof parsed === "object" && parsed !== null, "profiles.json should parse as an object");
    assert.ok(Array.isArray((parsed as { profiles?: unknown }).profiles), "profiles.json should have a profiles array");
  });

  test("duplicate / set default / delete round-trip through ProfileRepository", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);

    const imported = await pipeline.importProfileFromJson(importedProfile("crud-source", "voice-crud"));
    const copy = await pipeline.duplicateProfileById(imported.id);
    assert.notEqual(copy.id, imported.id);
    assert.equal(copy.label, `${imported.label} (copie)`);

    await pipeline.setDefaultProfileById(copy.id);

    const exported = await pipeline.exportProfileToJson(copy.id);
    const reparsed = JSON.parse(exported) as VoiceProfile;
    assert.equal(reparsed.id, copy.id);

    await pipeline.deleteProfileById(imported.id);
    await pipeline.deleteProfileById(copy.id);
  });

  test("importProfileFromJson rejects a profile that fails VoiceProfileSchema (AC-SEC-05)", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);

    await assert.rejects(() => pipeline.importProfileFromJson(JSON.stringify({ id: "broken" })));
  });

  test("providerStatus probes providers without crashing even when nothing listens (CdC §51)", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);

    // `providerStatus()`'s final step is an informational `showQuickPick`
    // that only resolves on user input; close it right after it opens so
    // the awaited call settles instead of hanging the test.
    const opened = pipeline.providerStatus();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
    await opened;
  });

  test("testVoice does not crash and reaches the TTS provider", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const sink = api.ttsProvider as unknown as FakeTtsProvider;
    const before = sink.requests.length;
    // Run-unique text (same `DiskAudioCache` rationale as AC-07 above): a
    // fixed default would hit an earlier run's cache and never reach the
    // fake provider, making `sink.requests.length` grow flaky on re-runs.
    const config = vscode.workspace.getConfiguration("llmVoice");
    await config.update("testVoice.text", `Ceci est un test ${Date.now()}.`, vscode.ConfigurationTarget.Global);

    await pipeline.testVoice();
    await waitFor(() => sink.requests.length > before);
  });

  test("AC-17/AC-SEC-08: a provider API key is stored in SecretStorage, never in globalState", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const secretValue = `sk-test-${Date.now()}`;

    await pipeline.setProviderApiKeyValue("openai-compatible", secretValue);

    const stored = await api.context.secrets.get("llmVoice.apiKey.openai-compatible");
    assert.equal(stored, secretValue);

    for (const key of api.context.globalState.keys()) {
      assert.notEqual(
        api.context.globalState.get(key),
        secretValue,
        `globalState[${key}] must never hold the raw API key value`
      );
    }

    await pipeline.clearProviderApiKeyValue("openai-compatible");
    const cleared = await api.context.secrets.get("llmVoice.apiKey.openai-compatible");
    assert.equal(cleared, undefined);
  });
});
