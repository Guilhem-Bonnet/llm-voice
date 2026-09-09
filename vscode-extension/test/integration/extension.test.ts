import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";

const EXPECTED_COMMANDS = [
  "llmVoice.speakDocument",
  "llmVoice.speakSelection",
  "llmVoice.speakFromCursor",
  "llmVoice.speakSection",
  "llmVoice.speakClipboard",
  "llmVoice.play",
  "llmVoice.playPause",
  "llmVoice.pause",
  "llmVoice.stop",
  "llmVoice.previousSegment",
  "llmVoice.nextSegment",
  "llmVoice.selectProfile",
  "llmVoice.openProfiles",
  "llmVoice.openInbox",
  "llmVoice.speakLatestClaudeResponse",
  "llmVoice.clearHighlight",
  "llmVoice.clearAudioCache",
  "llmVoice.verifyLocalMode",
  "llmVoice.installClaudeHook",
  "llmVoice.setupVoice",
  "llmVoice.walkthroughOpenExample"
];

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 50
): Promise<void> {
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
  assert.equal(extension?.isActive, true);
  return api;
}

suite("LLM Voice extension activation", () => {
  test("activates and returns the test API", async () => {
    const api = await activateExtension();
    assert.ok(api.highlight, "activate() should expose the HighlightController");
    assert.ok(api.player, "activate() should expose the PlayerViewProvider");
    assert.ok(api.statusBar, "activate() should expose the StatusBar");
  });

  test("registers every command from CdC §7", async () => {
    await activateExtension();
    const commands = await vscode.commands.getCommands(true);
    for (const commandId of EXPECTED_COMMANDS) {
      assert.ok(commands.includes(commandId), `${commandId} should be registered`);
    }
  });

  test("pipeline-backed commands execute without throwing (NotWiredPipeline)", async () => {
    await activateExtension();
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("llmVoice.play"))
    );
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("llmVoice.stop"))
    );
  });
});

suite("LLM Voice status bar", () => {
  test("a single status bar item exists and renders the idle text", async () => {
    const api = await activateExtension();
    assert.match(api.statusBar.text, /^\$\(unmute\)|\$\(lock\)/);
  });
});

suite("LLM Voice player view", () => {
  test("the Panel view resolves when focused", async () => {
    const api = await activateExtension();
    await vscode.commands.executeCommand("llmVoice.player.focus");
    await waitFor(() => api.player.isResolved);
    assert.equal(api.player.isResolved, true);
  });
});
