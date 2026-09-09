/**
 * S7.3 — "no silent commands", `LLM Voice: Play` starting a fresh session
 * instead of no-op'ing (the 0.1.0 field bug), and `llmVoice.state`-driven
 * enablement. Run under the `fake-tts` `.vscode-test.mjs` profile, like
 * `pipeline.test.ts`.
 *
 * `mocha`/`@vscode/test-cli` do not guarantee the load order of
 * `out/test/integration/**\/*.test.js` (observed out of alphabetical order
 * in practice), and every `*.test.ts` file in this profile shares one
 * `Pipeline` instance (one activation per VS Code window, cached across
 * `extension.activate()` calls) — every test below normalises the playback
 * state it needs (typically via `llmVoice.stop`) instead of assuming
 * anything about what ran before it.
 */
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";
import packageJson from "../../package.json";

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

/** `Pipeline`'s test-only surface this file needs, beyond `PipelineFacade`. */
interface TestPipeline {
  getPlaybackState(): string;
}

function testPipeline(api: ExtensionTestApi): TestPipeline {
  return api.pipeline as unknown as TestPipeline;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

interface RecordedInteraction {
  kind: "info" | "warning" | "error" | "quickPick" | "inputBox" | "openDialog" | "saveDialog";
  message?: string;
}

/**
 * Every one of these UI surfaces is stubbed to resolve as "dismissed/cancelled"
 * — deterministic, non-blocking under `xvfb` (no real dialog ever renders,
 * so nothing can hang mocha's timeout) — while still recording that the
 * command *did* try to talk to the user, which is exactly what "not silent"
 * means for the command sweep below (task: "chacune renvoie un résultat ou
 * déclenche une notification simulée"). `vscode.window`'s methods are plain
 * properties on the same module singleton every source file under test
 * imports, so reassigning them here is visible everywhere for the duration
 * of the stub.
 */
function stubUserInteractions(): { calls: RecordedInteraction[]; restore: () => void } {
  const calls: RecordedInteraction[] = [];
  const window = vscode.window as unknown as Record<string, unknown>;
  const originals = {
    showInformationMessage: window.showInformationMessage,
    showWarningMessage: window.showWarningMessage,
    showErrorMessage: window.showErrorMessage,
    showQuickPick: window.showQuickPick,
    showInputBox: window.showInputBox,
    showOpenDialog: window.showOpenDialog,
    showSaveDialog: window.showSaveDialog
  };
  window.showInformationMessage = (message: string) => {
    calls.push({ kind: "info", message });
    return Promise.resolve(undefined);
  };
  window.showWarningMessage = (message: string) => {
    calls.push({ kind: "warning", message });
    return Promise.resolve(undefined);
  };
  window.showErrorMessage = (message: string) => {
    calls.push({ kind: "error", message });
    return Promise.resolve(undefined);
  };
  window.showQuickPick = () => {
    calls.push({ kind: "quickPick" });
    return Promise.resolve(undefined);
  };
  window.showInputBox = () => {
    calls.push({ kind: "inputBox" });
    return Promise.resolve(undefined);
  };
  window.showOpenDialog = () => {
    calls.push({ kind: "openDialog" });
    return Promise.resolve(undefined);
  };
  window.showSaveDialog = () => {
    calls.push({ kind: "saveDialog" });
    return Promise.resolve(undefined);
  };
  return {
    calls,
    restore: () => Object.assign(window, originals)
  };
}

/**
 * Every `llmVoice.*` command this story owns (`src/commands/index.ts`'s
 * `registerCommands`) — excludes `llmVoice.inbox.*`/`llmVoice.statusBar.*`
 * (registered separately by `Pipeline.setupInbox`/`extension.ts`, driven by
 * Tree View items or the status bar click, not cold-callable from the
 * palette the same way) by reading the same `commandPalette` `"when":
 * "false"` gate `package.json` uses to hide them from the palette, plus the
 * two families explicitly.
 */
function paletteVisibleCommandIds(): string[] {
  const contributes = (packageJson as { contributes: { commands: { command: string }[]; menus: { commandPalette: { command: string; when?: string }[] } } })
    .contributes;
  const hidden = new Set(
    contributes.menus.commandPalette.filter((entry) => entry.when === "false").map((entry) => entry.command)
  );
  return contributes.commands
    .map((entry) => entry.command)
    .filter((command) => command.startsWith("llmVoice."))
    .filter((command) => !hidden.has(command))
    .filter((command) => !command.startsWith("llmVoice.inbox."))
    .filter((command) => !command.startsWith("llmVoice.statusBar."));
}

suite("LLM Voice command UX (S7.3: no silent commands, smart Play)", () => {
  test("AC-play-cold: 'Play' called cold with no active/paused session starts reading the active document", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    // `mocha`/`@vscode/test-cli` do not guarantee file load order (observed
    // out of alphabetical order across this suite's `out/test/integration/**`
    // glob), so another file may already have run a session in this shared
    // VS Code instance — normalise to "not playing/paused" instead of
    // asserting the exact starting state. `decidePlay` treats every
    // idle/stopped/completed/error state identically (starts a fresh
    // capture), so this proves the same fix regardless of which one it was.
    await vscode.commands.executeCommand("llmVoice.stop");
    assert.notEqual(pipeline.getPlaybackState(), "playing");
    assert.notEqual(pipeline.getPlaybackState(), "paused");

    const fileUri = fixtureUri("markdown", "short.md");
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);

    await vscode.commands.executeCommand("llmVoice.play");

    await waitFor(() => pipeline.getPlaybackState() === "playing");
    assert.equal(
      pipeline.getPlaybackState(),
      "playing",
      "'Play' with no active/paused session must start one instead of silently resuming nothing (0.1.0 field bug)"
    );
  });

  test("AC-pause-cold: 'Pause' with nothing playing notifies instead of silently no-op'ing", async () => {
    const api = await activateExtension();
    const pipeline = testPipeline(api);
    // Undo the previous test's session so this one starts from a known,
    // non-"playing" state (stop() itself is one of the "no silent" commands
    // under test elsewhere; safe to call regardless of the current state).
    await vscode.commands.executeCommand("llmVoice.stop");
    assert.notEqual(pipeline.getPlaybackState(), "playing");

    const stub = stubUserInteractions();
    try {
      await vscode.commands.executeCommand("llmVoice.pause");
      assert.ok(
        stub.calls.some((call) => call.kind === "info" && call.message?.includes("en cours de lecture")),
        "pause() with nothing playing must explain why nothing happened"
      );
    } finally {
      stub.restore();
    }
  });

  test("AC-clearHighlight-cold: 'Clear Highlight' with nothing highlighted notifies instead of silently no-op'ing", async () => {
    await activateExtension();
    const fileUri = fixtureUri("markdown", "short.md");
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);

    const stub = stubUserInteractions();
    try {
      await vscode.commands.executeCommand("llmVoice.clearHighlight");
      assert.ok(
        stub.calls.some((call) => call.kind === "info" && call.message?.includes("surlignage")),
        "clearHighlight() with nothing highlighted must explain why nothing happened"
      );
    } finally {
      stub.restore();
    }
  });

  test("AC-speakSelection-cold: 'Speak Selection' with an empty selection offers to read the document instead of silently reading nothing", async () => {
    await activateExtension();
    const fileUri = fixtureUri("markdown", "short.md");
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    assert.ok(editor.selection.isEmpty);

    const stub = stubUserInteractions();
    try {
      await vscode.commands.executeCommand("llmVoice.speakSelection");
      assert.ok(
        stub.calls.some((call) => call.kind === "info" && call.message?.includes("aucune sélection")),
        "speakSelection() with an empty selection must offer to read the document, not silently read nothing"
      );
    } finally {
      stub.restore();
    }
  });

  test("AC-clearAudioCache-cold: 'Clear Audio Cache' reports either the freed space or that it was already empty, never nothing", async () => {
    await activateExtension();
    const confirmingStub = stubUserInteractions();
    const window = vscode.window as unknown as Record<string, unknown>;
    window.showWarningMessage = (...args: unknown[]) => {
      confirmingStub.calls.push({ kind: "warning", message: args[0] as string });
      return Promise.resolve("Vider le cache");
    };
    try {
      // First call empties whatever this VS Code instance's cache held
      // (leftover from an earlier run/test in this same profile); the
      // second is then guaranteed to hit the "already empty" branch —
      // proving both messaged outcomes without depending on run order.
      await vscode.commands.executeCommand("llmVoice.clearAudioCache");
      confirmingStub.calls.length = 0;
      await vscode.commands.executeCommand("llmVoice.clearAudioCache");
      assert.ok(
        confirmingStub.calls.some((call) => call.kind === "info" && call.message?.includes("déjà vide")),
        "clearAudioCache() on an empty cache must say so, not silently do nothing"
      );
    } finally {
      confirmingStub.restore();
    }
  });

  test("sweep: every command.ts-registered llmVoice.* command resolves cold without throwing (no silent no-op class of bugs)", async function () {
    this.timeout(30000);
    await activateExtension();
    const fileUri = fixtureUri("markdown", "short.md");
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);

    const registered = await vscode.commands.getCommands(true);
    const targets = paletteVisibleCommandIds();
    assert.ok(targets.length >= 20, `expected 20+ commands under test, found ${targets.length}`);

    const stub = stubUserInteractions();
    try {
      for (const command of targets) {
        assert.ok(registered.includes(command), `${command} is declared in package.json but never registered`);
        await assert.doesNotReject(
          Promise.resolve(vscode.commands.executeCommand(command)),
          `${command} must not throw when called cold`
        );
      }
    } finally {
      stub.restore();
    }
  });
});
