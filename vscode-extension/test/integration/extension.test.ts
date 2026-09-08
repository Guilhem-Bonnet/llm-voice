import * as assert from "node:assert/strict";
import * as vscode from "vscode";

suite("LLM Voice extension activation", () => {
  test("activates and registers llmVoice.hello", async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    assert.ok(extension, "extension should be discoverable by id");

    await extension?.activate();
    assert.equal(extension?.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("llmVoice.hello"),
      "llmVoice.hello should be registered after activation"
    );
  });

  test("llmVoice.hello command executes without throwing", async () => {
    await assert.doesNotReject(
      Promise.resolve(vscode.commands.executeCommand("llmVoice.hello"))
    );
  });
});
