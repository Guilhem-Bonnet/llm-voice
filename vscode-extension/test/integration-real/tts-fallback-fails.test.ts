/**
 * Coordinator review (2026-09-12) of the voice-selection-not-applied /
 * infinite loop fix: the "no repli at all" counterpart to
 * `tts-fallback-succeeds.test.ts` — see that file's header for why the old
 * `tts-unavailable.test.ts` it replaces could not be trusted (its result
 * depended on whether a real Chatterbox happened to be reachable on the
 * machine running the suite).
 *
 * Run under the `tts-auto-fallback-fails` `.vscode-test.mjs` profile:
 *  - `LLM_VOICE_TEST_AUTO_CHATTERBOX_BASE_URL`/`_PIPER_BASE_URL` point the
 *    "auto" chain's two network probes at the same fixed closed loopback
 *    ports as the "succeeds" profile.
 *  - `PATH=/nonexistent-on-purpose` (the same value `system-no-engine`
 *    already uses) — `SystemTtsProvider`, the chain's final rung, finds no
 *    engine at all either, on any machine.
 *  - the same pre-seeded, provider-less `profiles.json` resolving to
 *    `"auto"`.
 *
 * Every rung of the chain is therefore unreachable by construction, on any
 * machine: Speak must end in the diagnostic "TTS unavailable" dialog
 * (`Pipeline.handleChunkError`) — never a hang, never an unhandled
 * rejection, and never a result that depends on what happens to be running
 * on `localhost`.
 */
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import { TTS_UNAVAILABLE_MESSAGE } from "../../src/ui/notifications.js";

async function waitFor(predicate: () => boolean, timeoutMs = 10000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

suite("LLM Voice: 'auto' TTS chain has no fallback anywhere (coordinator review, deterministic)", () => {
  test("Chatterbox, Piper local and system all unreachable: the diagnostic error dialog appears", async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension, "extension should be discoverable by id");
    const api = (await extension?.activate()) as ExtensionTestApi;
    assert.equal(api.audioSink, undefined, "this profile must not inject the fake sink");
    assert.equal(api.ttsProvider, undefined, "this profile must not inject the fake TTS provider");

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test workspace should have a folder open");
    const fileUri = vscode.Uri.file(path.join(folder.uri.fsPath, "markdown", "short.md"));
    await vscode.workspace.openTextDocument(fileUri);

    const testPipeline = api.pipeline as unknown as { getPlaybackState(): string };

    const infoCalls: Array<{ message: string; items: string[] }> = [];
    const errorCalls: Array<{ message: string; items: string[] }> = [];
    const originalInfo = vscode.window.showInformationMessage;
    const originalError = vscode.window.showErrorMessage;
    // `ensureVoiceReady`'s one-button "install a better voice" offer fires
    // first (status "unreachable", same as `no-voice-available.test.ts`) —
    // declined the same way, deterministically, no timing wait needed.
    (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
      ((message: string, ...items: string[]) => {
        infoCalls.push({ message, items });
        return Promise.resolve(undefined);
      }) as unknown as typeof vscode.window.showInformationMessage;
    (vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage = ((
      message: string,
      ...items: string[]
    ) => {
      errorCalls.push({ message, items });
      return Promise.resolve(undefined);
    }) as unknown as typeof vscode.window.showErrorMessage;

    try {
      await assert.doesNotReject(
        api.pipeline.start({ scope: "document", uri: fileUri.toString(), languageId: "markdown" })
      );

      await waitFor(() => testPipeline.getPlaybackState() === "error");
      assert.equal(testPipeline.getPlaybackState(), "error");
      assert.match(api.statusBar.text, /\$\(error\)/);

      assert.equal(errorCalls.length, 1, "exactly one 'TTS unavailable' dialog (CdC §52 anti-spam)");
      // First failure this fresh `Pipeline` instance has ever shown a
      // dialog for: the plain, actionable message — never the diagnostic
      // wording reserved for a *second* consecutive failure
      // (`chooseTtsUnavailableMessage`, `notifications.test.ts`'s own unit
      // coverage of that decision).
      assert.equal(errorCalls[0]!.message, TTS_UNAVAILABLE_MESSAGE);
    } finally {
      (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
        originalInfo;
      (vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage = originalError;
    }
  });
});
