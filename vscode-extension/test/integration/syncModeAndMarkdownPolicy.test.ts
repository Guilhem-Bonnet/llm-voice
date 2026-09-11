/**
 * S8.2 profile editor fields that are more than form data: `syncMode`
 * (CdC §49 "Highlight behavior") actually gates `HighlightController`, and
 * `markdownPolicy` actually reaches `Segmenter` instead of the hard-coded
 * `DEFAULT_MARKDOWN_POLICY`. Run under the `fake-tts` profile like
 * `pipeline.test.ts`.
 */
import * as assert from "node:assert/strict";
import * as path from "node:path";
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

function fixtureUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "test workspace should have a folder open");
  return vscode.Uri.file(path.join(folder.uri.fsPath, ...segments));
}

interface TestPipeline {
  importProfileFromJson(json: string): Promise<VoiceProfile>;
  selectProfileById(id: string): Promise<void>;
  deleteProfileById(id: string): Promise<void>;
}

function testPipeline(api: ExtensionTestApi): TestPipeline {
  return api.pipeline as unknown as TestPipeline;
}

function profileWithSyncMode(id: string, syncMode: VoiceProfile["syncMode"]): string {
  const profile: VoiceProfile = {
    id,
    label: `syncMode test (${syncMode ?? "default"})`,
    mode: "faithful",
    language: "fr-FR",
    tts: { providerId: "fake-tts", baseUrl: "http://127.0.0.1:9" },
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 0 },
    playback: { rate: 1, volume: 1 },
    ...(syncMode !== undefined ? { syncMode } : {})
  };
  return JSON.stringify(profile);
}

suite("LLM Voice profile editor fields with real behaviour (S8.2, CdC §49)", () => {
  test("syncMode: 'off' plays without ever posing a highlight decoration", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const fileUri = fixtureUri("markdown", "short.md");
    await vscode.workspace.openTextDocument(fileUri);

    const id = `sync-off-${Date.now()}`;
    const imported = await pipeline.importProfileFromJson(profileWithSyncMode(id, "off"));
    await pipeline.selectProfileById(imported.id);

    await api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });

    assert.equal(
      api.highlight.getRanges(fileUri),
      undefined,
      "syncMode 'off' must never pose a highlight decoration"
    );

    await api.pipeline.stop();
    await pipeline.deleteProfileById(imported.id);
  });

  test("the default syncMode still highlights (0.1 behaviour preserved)", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const fileUri = fixtureUri("markdown", "short.md");
    await vscode.workspace.openTextDocument(fileUri);

    const id = `sync-default-${Date.now()}`;
    const imported = await pipeline.importProfileFromJson(profileWithSyncMode(id, undefined));
    await pipeline.selectProfileById(imported.id);

    await api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });

    const ranges = api.highlight.getRanges(fileUri);
    assert.ok(ranges, "the default syncMode should still pose a highlight decoration");
    assert.ok(ranges!.current.length > 0);

    await api.pipeline.stop();
    await pipeline.deleteProfileById(imported.id);
  });
});
