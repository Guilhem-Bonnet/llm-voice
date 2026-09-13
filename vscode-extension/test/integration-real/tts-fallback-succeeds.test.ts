/**
 * Coordinator review (2026-09-12) of the voice-selection-not-applied /
 * infinite loop fix: replaces `tts-unavailable.test.ts`'s "real provider
 * unavailable" half with a scenario whose *outcome* never depends on the
 * machine running the suite — the exact fragility issue #50 closed
 * elsewhere. Before this split, the old test pinned an explicit
 * `chatterbox` profile at `localhost:8004` and asserted the session always
 * ends in `"error"`; on a machine where a real Chatterbox happens to be
 * reachable there (this repo's own dev machine, `_grimoire/_memory/
 * shared-context.md`), that assertion is simply false — and, since this
 * fix's whole point is "a reachable fallback must succeed instead of
 * failing", a green result there is *correct*, not a regression.
 *
 * Run under the `tts-auto-fallback-succeeds` `.vscode-test.mjs` profile:
 *  - `LLM_VOICE_TEST_AUTO_CHATTERBOX_BASE_URL`/`_PIPER_BASE_URL` (test-only
 *    seam, `Pipeline.autoSelectTts()`'s own doc comment) point the "auto"
 *    chain's two network probes at fixed, unusual closed loopback ports —
 *    never the real Chatterbox/Piper-local default ports a developer
 *    machine might actually be running.
 *  - `LLM_VOICE_TEST_SYSTEM_RUNNER=espeak-only` (test-only seam,
 *    `presets.ts`'s own doc comment) replaces `SystemTtsProvider`'s real
 *    runner with `EspeakOnlyRunner` (`test/fakes/FakeSystemTtsRunner.ts`):
 *    finds a fake `espeak-ng`, never Piper — regardless of what the real
 *    machine running the suite happens to have installed. A first attempt
 *    at this used `PATH` manipulation instead: verified live not to work
 *    (VS Code's own shell-env resolution overrides it).
 *  - a pre-seeded `profiles.json` (`seedAutoProfile`) names no explicit
 *    `tts.providerId` at all, resolving through `llmVoice.tts.provider`'s
 *    own shipped default, `"auto"`.
 *
 * The chain therefore always resolves: Chatterbox (closed port) → Piper
 * local (closed port) → `SystemTtsProvider`, which finds the fake
 * `espeak-ng` — never Piper, so `Pipeline.ensureVoiceReady` still offers
 * its one-button "install a better voice" prompt (`AutoVoiceInstall.ts`:
 * Piper outranks espeak-ng even when both would work). Declining it (this
 * test never clicks it, `vscode.window.showInformationMessage` stubbed to
 * always resolve `undefined`, same "stub the buttons" discipline
 * `chunk-invalid.test.ts` already uses) is deliberately silent —
 * `offerAutoVoiceInstall`'s own doc comment: "declining is simply not
 * clicking it, no second dialog" — so what actually "signale le repli" to
 * the user here is the resolved `"playing"` state and the status bar's
 * absence of `$(error)`, never an extra notification.
 */
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import { INSTALL_VOICE_ACTION_LABEL } from "../../src/tts/AutoVoiceInstall.js";

async function waitFor(predicate: () => boolean, timeoutMs = 10000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

suite("LLM Voice: 'auto' TTS chain falls back and succeeds (coordinator review, deterministic)", () => {
  test("Chatterbox and Piper local unreachable, system espeak-ng available: Speak succeeds, no error dialog", async () => {
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
    const warnCalls: Array<{ message: string; items: string[] }> = [];
    const errorCalls: Array<{ message: string; items: string[] }> = [];
    const originalInfo = vscode.window.showInformationMessage;
    const originalWarn = vscode.window.showWarningMessage;
    const originalError = vscode.window.showErrorMessage;
    (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
      ((message: string, ...items: string[]) => {
        infoCalls.push({ message, items });
        // Never clicks "Installer la voix française": the fallback path,
        // never the install path, is what this test proves.
        return Promise.resolve(undefined);
      }) as unknown as typeof vscode.window.showInformationMessage;
    (vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage = ((
      message: string,
      ...items: string[]
    ) => {
      warnCalls.push({ message, items });
      return Promise.resolve(undefined);
    }) as unknown as typeof vscode.window.showWarningMessage;
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

      await waitFor(() => testPipeline.getPlaybackState() === "playing" || testPipeline.getPlaybackState() === "error");
      assert.equal(
        testPipeline.getPlaybackState(),
        "playing",
        `expected the espeak-ng fallback to succeed, got state "${testPipeline.getPlaybackState()}"`
      );
      assert.doesNotMatch(api.statusBar.text, /\$\(error\)/, "no error must ever surface for this profile");

      // The one-button "install a better voice" offer is still expected
      // (Piper outranks espeak-ng, `AutoVoiceInstall.ts`) — declining it
      // (`offerAutoVoiceInstall`'s own doc comment: "declining is simply
      // not clicking it, no second dialog") must fall back immediately and
      // silently: no extra warning, and above all no error — the resolved
      // "playing" state and the status bar's absence of `$(error)` *are*
      // what "signale le repli" here, exactly what a user actually sees.
      assert.equal(infoCalls.length, 1, "exactly one voice-install offer, never repeated");
      assert.ok(infoCalls[0]!.items.includes(INSTALL_VOICE_ACTION_LABEL));
      assert.equal(warnCalls.length, 0, "a plain decline must not add a second dialog on top of the offer");
      assert.equal(errorCalls.length, 0, "no error dialog for a resolved fallback");
    } finally {
      (vscode.window as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
        originalInfo;
      (vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage =
        originalWarn;
      (vscode.window as { showErrorMessage: typeof vscode.window.showErrorMessage }).showErrorMessage = originalError;
    }
  });
});
