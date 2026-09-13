/**
 * S5.3, AC-16 — "Chunk TTS invalide" (CdC §52): run under the
 * `chunk-invalid-fake-tts` `.vscode-test.mjs` profile
 * (`LLM_VOICE_TEST_FAKE_TTS=1` + `LLM_VOICE_TEST_FAKE_TTS_FAIL_FROM=2`), so
 * chunk 0 always succeeds and every later chunk fails for good after
 * `AudioQueue`'s `maxRetries` — deterministically reaching
 * `Pipeline.handleChunkError`'s "later chunk" branch (Skip/Stop) instead of
 * the first-chunk "TTS unavailable" one `tts-fallback-fails.test.ts` covers.
 *
 * `vscode.window.showErrorMessage` is monkey-patched for the duration of
 * each test (restored in `finally`) to stub the button the user would click
 * — exactly what CdC §52's "stub des boutons" asks for at the integration
 * level, on top of `notifications.test.ts`'s pure unit coverage of the same
 * decision.
 */
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";

async function waitFor(predicate: () => boolean, timeoutMs = 10000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Stubs `vscode.window.showErrorMessage` to always answer `choice`, recording every call. */
function stubShowErrorMessage(choice: string): {
  calls: Array<{ message: string; items: string[] }>;
  restore: () => void;
} {
  const calls: Array<{ message: string; items: string[] }> = [];
  const original = vscode.window.showErrorMessage;
  (vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage = ((
    message: string,
    ...items: string[]
  ) => {
    calls.push({ message, items });
    return Promise.resolve(choice);
  }) as unknown as typeof vscode.window.showErrorMessage;
  return {
    calls,
    restore: () => {
      (vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage = original;
    }
  };
}

suite("LLM Voice: chunk invalide (S5.3, AC-16, CdC §52)", () => {
  test("2 retries then Skip: one dialog, playback keeps going, extension stays active", async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension, "extension should be discoverable by id");
    const api = (await extension?.activate()) as ExtensionTestApi;
    assert.ok(api.ttsProvider, "this profile should inject the failing FakeTtsProvider");

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test workspace should have a folder open");
    const fileUri = vscode.Uri.file(path.join(folder.uri.fsPath, "markdown", "short.md"));
    await vscode.workspace.openTextDocument(fileUri);
    // This suite runs two `start()` calls (this test, then "Stop" below)
    // against the *same* `FakeTtsProvider` instance and disk cache: without
    // resetting both, the second test's call count would already be past
    // `LLM_VOICE_TEST_FAKE_TTS_FAIL_FROM`, and a cached chunk 0 would skip
    // the provider entirely — either way shifting which call actually fails.
    (api.ttsProvider as unknown as { reset?: () => void } | undefined)?.reset?.();
    await api.pipeline.clearAudioCache();

    const testPipeline = api.pipeline as unknown as {
      getPlaybackState(): string;
      getTotalChunks(): number;
    };
    const stub = stubShowErrorMessage("Skip");
    try {
      await assert.doesNotReject(
        api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" })
      );

      await waitFor(() => testPipeline.getTotalChunks() > 1, 10000);
      // Every chunk after the first fails for good: the session ends in
      // "error" either way (Skip only postpones it to the next chunk) —
      // what this test actually proves is the *dialog* behaviour: exactly
      // one shown (anti-spam, CdC §52), not one per failing chunk.
      await waitFor(() => testPipeline.getPlaybackState() === "error", 10000);
      assert.equal(stub.calls.length, 1, "anti-spam: only one 'chunk invalide' dialog per session");
      assert.match(stub.calls[0]!.message, /chunk failed after/);
      assert.deepEqual(stub.calls[0]!.items, ["Skip", "Stop"]);
    } finally {
      stub.restore();
    }

    assert.equal(extension?.isActive, true, "the extension must still be active after the failure");
  });

  test("Stop: playback halts on the failing chunk without an unhandled exception", async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension, "extension should be discoverable by id");
    const api = (await extension?.activate()) as ExtensionTestApi;

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test workspace should have a folder open");
    const fileUri = vscode.Uri.file(path.join(folder.uri.fsPath, "markdown", "short.md"));
    await vscode.workspace.openTextDocument(fileUri);
    // This suite runs two `start()` calls (this test, then "Stop" below)
    // against the *same* `FakeTtsProvider` instance and disk cache: without
    // resetting both, the second test's call count would already be past
    // `LLM_VOICE_TEST_FAKE_TTS_FAIL_FROM`, and a cached chunk 0 would skip
    // the provider entirely — either way shifting which call actually fails.
    (api.ttsProvider as unknown as { reset?: () => void } | undefined)?.reset?.();
    await api.pipeline.clearAudioCache();

    const testPipeline = api.pipeline as unknown as {
      getPlaybackState(): string;
      getCurrentChunkIndex(): number;
    };
    const stub = stubShowErrorMessage("Stop");
    try {
      await assert.doesNotReject(
        api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" })
      );

      await waitFor(() => testPipeline.getPlaybackState() === "error", 10000);
      assert.equal(stub.calls.length, 1);
      // Stop halts on the chunk that failed — never advances past index 1
      // (chunk 0 always succeeds in this profile).
      assert.equal(testPipeline.getCurrentChunkIndex(), 1);
    } finally {
      stub.restore();
    }

    assert.equal(extension?.isActive, true, "the extension must still be active after Stop");
  });
});
