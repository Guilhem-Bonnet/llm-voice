/**
 * S5.3 — `llmVoice.audio.prefetchChunks` (CdC §32/§48) wired into
 * `PlaybackController`/`AudioQueue`. Run under the dedicated
 * `prefetch-chunks-fake-tts` `.vscode-test.mjs` profile, whose
 * `--user-data-dir` is pre-seeded with `{"llmVoice.audio.prefetchChunks": 0}`
 * *before* the extension host activates (the setting is read once, at
 * `Pipeline` construction — a live `config.update()` from inside a test
 * would arrive too late).
 *
 * `test/unit/playback/audio-queue.test.ts` already proves the default
 * (`prefetchChunks` unset → 2) synthesises the cursor chunk plus 2 ahead;
 * this only has to show the *setting*, not just the option, actually
 * reaches the queue: with it forced to 0, exactly one chunk is
 * synthesised up front, never more.
 */
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import type { FakeTtsProvider } from "../fakes/FakeTtsProvider.js";

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

function fixtureUri(...segments: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "test workspace should have a folder open");
  return vscode.Uri.file(path.join(folder.uri.fsPath, ...segments));
}

suite("LLM Voice audio.prefetchChunks wiring (S5.3, CdC §32/§48)", () => {
  test("llmVoice.audio.prefetchChunks=0 synthesises only the cursor chunk, never ahead", async () => {
    const api = await activateExtension();
    const config = vscode.workspace.getConfiguration("llmVoice");
    assert.equal(
      config.get<number>("audio.prefetchChunks"),
      0,
      "this profile's --user-data-dir should have pre-seeded the setting to 0"
    );

    // A long, multi-sentence document (10+ chunks under the default
    // profile's "sentence" chunking) so a prefetch window wider than 0
    // would be visible as more than one request up front.
    const fileUri = fixtureUri("markdown", "kubernetes-course.md");
    await vscode.workspace.openTextDocument(fileUri);

    await api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" });

    const tts = api.ttsProvider as FakeTtsProvider;
    // Give the queue a moment to fire every request it is going to fire
    // up front before asserting the window never grew past 1.
    await waitFor(() => tts.requests.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(
      tts.requests.length,
      1,
      "prefetchChunks=0 must synthesise only the current chunk, not the next ones ahead of it"
    );
  });
});
