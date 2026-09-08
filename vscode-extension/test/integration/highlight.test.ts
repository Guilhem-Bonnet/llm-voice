import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ExtensionTestApi } from "../../src/extension.js";

suite("LLM Voice highlight (ADR-002)", () => {
  test("show() poses a decoration and clear() removes it", async () => {
    const extension = vscode.extensions.getExtension("guilhem-bonnet.llm-voice");
    const api = (await extension?.activate()) as ExtensionTestApi;

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "test workspace should have a folder open");
    const fileUri = vscode.Uri.file(path.join(folder.uri.fsPath, "markdown", "short.md"));
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);

    api.highlight.show(fileUri, [{ startLine: 0, startColumn: 0, endLine: 0, endColumn: 5 }]);
    const afterShow = api.highlight.getRanges(fileUri);
    assert.ok(afterShow, "a highlight state should exist after show()");
    assert.equal(afterShow?.current.length, 1);

    api.highlight.clear(fileUri);
    const afterClear = api.highlight.getRanges(fileUri);
    assert.equal(afterClear, undefined, "clear() should drop the tracked state");
  });
});
