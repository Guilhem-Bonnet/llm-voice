import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";

suite("LLM Voice CodeLens (CdC §69)", () => {
  test("one 'Lire cette section' CodeLens per Markdown heading", async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    await extension?.activate();

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test workspace should have a folder open");
    const fileUri = vscode.Uri.file(path.join(folder.uri.fsPath, "markdown", "codelens.md"));
    await vscode.workspace.openTextDocument(fileUri);

    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      fileUri,
      100
    );

    assert.ok(lenses, "the CodeLens provider should return results");
    assert.equal(lenses?.length, 4, "codelens.md has 4 headings");
    for (const lens of lenses ?? []) {
      assert.equal(lens.command?.title, "▶ Lire cette section");
      assert.equal(lens.command?.command, "llmVoice.speakSection");
    }
  });

  test("no CodeLens on a non-Markdown document", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "plaintext",
      content: "# not a heading here, this is plaintext"
    });

    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      "vscode.executeCodeLensProvider",
      document.uri,
      100
    );

    assert.equal(lenses?.length ?? 0, 0);
  });
});
