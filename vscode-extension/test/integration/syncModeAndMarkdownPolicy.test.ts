/**
 * S8.2 profile editor fields that are more than form data:
 * `synchronization.mode` (CdC §18/§49 "Highlight behavior") actually gates
 * `HighlightController`, and `markdown` actually reaches `Segmenter`
 * instead of the hard-coded `DEFAULT_MARKDOWN_POLICY`. Run under the
 * `fake-tts` profile like `pipeline.test.ts`.
 *
 * Field names match the cahier des charges §18 example verbatim
 * (`markdown`, `synchronization.mode`) — not the pre-rename
 * `markdownPolicy`/`syncMode` a 0.1-era `profiles.json` may still carry;
 * the last test in this suite proves that legacy shape still imports and
 * behaves correctly through `VoiceProfileSchema`'s migration.
 */
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import type { SyncMode, VoiceProfile } from "../../src/core/profile.js";

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

function profileWithSyncMode(id: string, mode: SyncMode | undefined): string {
  const profile: VoiceProfile = {
    id,
    label: `syncMode test (${mode ?? "default"})`,
    mode: "faithful",
    language: "fr-FR",
    tts: { providerId: "fake-tts", baseUrl: "http://127.0.0.1:9" },
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 0 },
    playback: { rate: 1, volume: 1 },
    ...(mode !== undefined ? { synchronization: { mode } } : {})
  };
  return JSON.stringify(profile);
}

/** Same shape a pre-rename (0.1-era) `profiles.json`/import file used: `syncMode` at the top level instead of `synchronization.mode`. */
function legacyShapedProfileJson(id: string): string {
  return JSON.stringify({
    id,
    label: "legacy shape test",
    mode: "faithful",
    language: "fr-FR",
    tts: { providerId: "fake-tts", baseUrl: "http://127.0.0.1:9" },
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 0 },
    playback: { rate: 1, volume: 1 },
    syncMode: "off"
  });
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

  test("importing a legacy-shaped profile.json (syncMode at top level) migrates to synchronization.mode and still behaves", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    const fileUri = fixtureUri("markdown", "short.md");
    await vscode.workspace.openTextDocument(fileUri);

    const id = `sync-legacy-${Date.now()}`;
    const imported = await pipeline.importProfileFromJson(legacyShapedProfileJson(id));

    // The migration replaces the legacy field, it does not just tolerate it.
    assert.equal(imported.synchronization?.mode, "off");
    assert.equal((imported as unknown as Record<string, unknown>)["syncMode"], undefined);

    await pipeline.selectProfileById(imported.id);
    await api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });

    assert.equal(
      api.highlight.getRanges(fileUri),
      undefined,
      "the migrated 'off' mode must behave exactly like the CdC §18-named field"
    );

    await api.pipeline.stop();
    await pipeline.deleteProfileById(imported.id);
  });
});
