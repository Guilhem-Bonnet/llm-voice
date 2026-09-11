/**
 * S8.3 — run under the `system-no-engine` `.vscode-test.mjs` profile:
 * `PATH` stripped so `SystemTtsProvider` finds neither `espeak-ng` nor a
 * prior Piper install (`--user-data-dir` is brand new too), and
 * `LLM_VOICE_TEST_FAKE_TTS` unset, so this exercises the *real*
 * `SystemTtsProvider`/`Pipeline.ensureVoiceReady` path — the exact "fresh
 * install, zero local engine at all" case S8.3 fixes.
 *
 * The first-launch default profile is already "Voix système (aucune
 * installation)" (`system-voice`, `tts.providerId: "system"`, S7.1) — no
 * profile selection needed here.
 *
 * `ensureVoiceReady` awaits a real `vscode.window.showInformationMessage`
 * (the one-action install prompt) before building a session — exactly like
 * a user seeing it, nobody answers it automatically in a headless test, so
 * this dismisses it via `notifications.clearAll` shortly after `start()` is
 * called, the same "close the UI the user would otherwise click"
 * pattern `test/integration/onboarding.test.ts` uses for the Setup Voice
 * Quick Pick. A dismissed/declined prompt must resolve `start()` cleanly —
 * never an unhandled rejection, never a hang — which is the AC-01-style
 * guarantee this test proves for real.
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

suite("LLM Voice: first Speak with zero local engine (S8.3, real SystemTtsProvider)", () => {
  test("declining the one-action install prompt falls back cleanly — no unhandled rejection, no hang", async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension, "extension should be discoverable by id");
    const api = (await extension?.activate()) as ExtensionTestApi;
    assert.equal(api.ttsProvider, undefined, "this profile must not inject the fake TTS provider");

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test workspace should have a folder open");
    const fileUri = vscode.Uri.file(path.join(folder.uri.fsPath, "markdown", "short.md"));
    await vscode.workspace.openTextDocument(fileUri);

    const testPipeline = api.pipeline as unknown as {
      getPlaybackState(): string;
      getCurrentProfileLabelForTest(): string;
    };

    const started = api.pipeline.start({
      scope: "document",
      uri: fileUri.toString(),
      languageId: "markdown"
    });

    // Give `ensureVoiceReady`'s `showInformationMessage` time to actually
    // open, then dismiss it exactly like a user who does not click
    // "Installer la voix française" — the honest-fallback path (S8.3:
    // "En cas de refus... repli immédiat... aucun état intermédiaire
    // bloquant").
    await new Promise((resolve) => setTimeout(resolve, 500));
    await vscode.commands.executeCommand("notifications.clearAll");

    // Must resolve, never throw or hang, whichever branch it took (declined
    // install, or — on a machine where `PATH` stripping somehow still left
    // a system voice reachable — straight through to a normal session).
    await assert.doesNotReject(started);

    await waitFor(
      () => testPipeline.getPlaybackState() === "error" || testPipeline.getPlaybackState() === "playing"
    );
    assert.ok(
      ["error", "playing"].includes(testPipeline.getPlaybackState()),
      `expected a resolved end state, got ${testPipeline.getPlaybackState()}`
    );
  });
});
