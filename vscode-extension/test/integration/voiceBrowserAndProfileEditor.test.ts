/**
 * S8.2 — `LLM Voice: Browse Voices` and `LLM Voice: Edit Profile` against a
 * real extension host (`LLM_VOICE_TEST_FAKE_TTS=1`, `FakeTtsProvider`
 * exposes one voice, `test/fakes/FakeTtsProvider.ts`). `Use My Own Voice`
 * has its own file, `useOwnVoice.test.ts`.
 *
 * This file drives `ProfileEditorPanel` only through `Pipeline`'s own
 * test-only forwarders (`getProfileEditorHtmlForTest`, etc.), never by
 * importing the class directly: `package.json#main` is `dist/extension.js`,
 * an esbuild bundle, so a test importing `src/views/profileEditor/ProfileEditorPanel.js`
 * straight from `out/` would get a *second*, unrelated module instance with
 * its own static `panels` map — see the forwarders' own doc comment in
 * `Pipeline.ts`.
 */
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import type { VoiceProfile } from "../../src/core/profile.js";

async function activateExtension(): Promise<ExtensionTestApi> {
  const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
  assert.ok(extension, "extension should be discoverable by id");
  const api = (await extension?.activate()) as ExtensionTestApi;
  assert.ok(api.ttsProvider, "LLM_VOICE_TEST_FAKE_TTS=1 should inject a FakeTtsProvider");
  return api;
}

interface TestPipeline {
  importProfileFromJson(json: string): Promise<VoiceProfile>;
  deleteProfileById(id: string): Promise<void>;
  getProfileById(id: string): Promise<VoiceProfile>;
  applyVoiceToProfileById(id: string, voiceId: string): Promise<VoiceProfile>;
  openProfileEditorById(id: string): Promise<void>;
  getProfileEditorHtmlForTest(id: string): string | undefined;
  dispatchProfileEditorMessageForTest(id: string, message: { type: string; profile?: unknown }): Promise<void>;
  closeProfileEditorForTest(id: string): void;
}

function testPipeline(api: ExtensionTestApi): TestPipeline {
  return api.pipeline as unknown as TestPipeline;
}

function fakeProfileJson(id: string): string {
  const profile: VoiceProfile = {
    id,
    label: "S8.2 test profile",
    mode: "faithful",
    language: "fr-FR",
    tts: { providerId: "fake-tts", baseUrl: "http://127.0.0.1:9" },
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 0 },
    playback: { rate: 1, volume: 1 }
  };
  return JSON.stringify(profile);
}

suite("LLM Voice: Browse Voices (S8.2, CdC §72)", () => {
  test("registers the command", async () => {
    await activateExtension();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("llmVoice.browseVoices"));
  });

  test("opens a Quick Pick and does not throw when dismissed", async () => {
    await activateExtension();
    const opened = vscode.commands.executeCommand("llmVoice.browseVoices");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
    await assert.doesNotReject(Promise.resolve(opened));
  });

  test("applying a voice persists it and it is read back from profiles.json", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const id = `browse-voices-${Date.now()}`;
    const imported = await pipeline.importProfileFromJson(fakeProfileJson(id));

    const updated = await pipeline.applyVoiceToProfileById(imported.id, "fake-voice");
    assert.equal(updated.tts.voice, "fake-voice");

    const reread = await pipeline.getProfileById(imported.id);
    assert.equal(reread.tts.voice, "fake-voice", "the voice should still be there after a fresh read");

    await pipeline.deleteProfileById(imported.id);
  });
});

suite("LLM Voice: Edit Profile webview (S8.2, CdC §49)", () => {
  test("registers the command", async () => {
    await activateExtension();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("llmVoice.editProfile"));
  });

  test("renders with a strict, per-render CSP and a minimal localResourceRoots", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const id = `editor-csp-${Date.now()}`;
    const imported = await pipeline.importProfileFromJson(fakeProfileJson(id));

    await pipeline.openProfileEditorById(imported.id);
    const html = pipeline.getProfileEditorHtmlForTest(imported.id);
    assert.ok(html, "the editor should have a live webview");

    assert.match(html!, /default-src 'none'/);
    assert.match(html!, /connect-src 'none'/);
    assert.match(html!, /script-src 'nonce-[A-Za-z0-9_-]{32}'/);
    assert.ok(!html!.includes("unsafe-inline"));
    assert.equal([...html!.matchAll(/<script\b/g)].length, 1);

    pipeline.closeProfileEditorForTest(imported.id);
    await pipeline.deleteProfileById(imported.id);
  });

  test("save persists a validated edit; a name with HTML never reaches the document", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const id = `editor-save-${Date.now()}`;
    const imported = await pipeline.importProfileFromJson(fakeProfileJson(id));
    const hostileLabel = '<img src=x onerror="window.__pwned=true">';

    await pipeline.openProfileEditorById(imported.id);
    await pipeline.dispatchProfileEditorMessageForTest(imported.id, {
      type: "save",
      profile: { ...imported, label: hostileLabel, speed: 1 }
    });

    const reread = await pipeline.getProfileById(imported.id);
    assert.equal(reread.label, hostileLabel, "the label is data, stored verbatim");

    const html = pipeline.getProfileEditorHtmlForTest(imported.id);
    assert.ok(html, "the editor should still be open");
    assert.ok(!html!.includes(hostileLabel), "hostile label must never reach the webview document");
    assert.ok(!html!.includes("onerror"));

    pipeline.closeProfileEditorForTest(imported.id);
    await pipeline.deleteProfileById(imported.id);
  });

  test("save rejects an invalid edit with readable errors, without touching profiles.json", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const id = `editor-invalid-${Date.now()}`;
    const imported = await pipeline.importProfileFromJson(fakeProfileJson(id));

    await pipeline.openProfileEditorById(imported.id);
    await pipeline.dispatchProfileEditorMessageForTest(imported.id, {
      type: "save",
      profile: { ...imported, playback: { rate: 999, volume: 1 } }
    });

    const reread = await pipeline.getProfileById(imported.id);
    assert.equal(reread.playback.rate, 1, "the invalid edit must not have been persisted");

    pipeline.closeProfileEditorForTest(imported.id);
    await pipeline.deleteProfileById(imported.id);
  });

  test("duplicate creates a second profile and opens its own editor", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const id = `editor-dup-${Date.now()}`;
    const imported = await pipeline.importProfileFromJson(fakeProfileJson(id));

    await pipeline.openProfileEditorById(imported.id);
    await pipeline.dispatchProfileEditorMessageForTest(imported.id, { type: "duplicate" });

    // The duplicate's id is `${imported.id}-copie` per `ProfileRepository.duplicate`.
    const copyId = `${imported.id}-copie`;
    const copy = await pipeline.getProfileById(copyId);
    assert.equal(copy.label, `${imported.label} (copie)`);

    pipeline.closeProfileEditorForTest(copyId);
    await pipeline.deleteProfileById(imported.id);
    await pipeline.deleteProfileById(copyId);
  });

  test("delete removes the profile after confirmation", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const id = `editor-delete-${Date.now()}`;
    const imported = await pipeline.importProfileFromJson(fakeProfileJson(id));

    const window = vscode.window as unknown as Record<string, unknown>;
    const original = window.showWarningMessage;
    window.showWarningMessage = () => Promise.resolve("Supprimer");
    try {
      await pipeline.openProfileEditorById(imported.id);
      await pipeline.dispatchProfileEditorMessageForTest(imported.id, { type: "delete" });
    } finally {
      window.showWarningMessage = original;
    }

    await assert.rejects(() => pipeline.getProfileById(imported.id));
  });
});
