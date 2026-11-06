/**
 * `SourceAdapter` for reading a selection, a whole file or from the cursor in any
 * language but Markdown (CdC §10.2). Markdown is handled by `MarkdownDocumentSource` instead (keeps
 * `sourceType: "markdown"` so the Pipeline runs `parseMarkdown`); this one
 * covers every other language, and the Pipeline falls back to plain sentence
 * splitting for it (CdC §13, "texte brut en phrases pour non-Markdown").
 */

import * as vscode from "vscode";
import type { CaptureContext, SourceAdapter, SourceDocument, SourceRange, SourceType } from "../core/source.js";
import { CAPTURE_RANGE_METADATA_KEY } from "./captureRange.js";

export class TextSelectionSource implements SourceAdapter {
  readonly id = "source-text-selection";
  readonly sourceType: SourceType = "text";

  canCapture(context: CaptureContext): boolean {
    if (context.uri === undefined || context.languageId === "markdown") {
      return false;
    }
    return (
      (context.scope === "selection" && context.selection !== undefined) ||
      context.scope === "document" ||
      context.scope === "from-cursor"
    );
  }

  async capture(context: CaptureContext, signal?: AbortSignal): Promise<SourceDocument> {
    if (context.uri === undefined) {
      throw new Error("TextSelectionSource: capture requires a uri");
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(context.uri));
    if (signal?.aborted === true) {
      throw new DOMException("Aborted", "AbortError");
    }

    const title = document.uri.path.split("/").pop();
    const range = this.captureRange(context, document);
    return {
      id: `text-selection-${document.uri.toString()}-${Date.now()}`,
      sourceType: this.sourceType,
      uri: document.uri.toString(),
      ...(title !== undefined ? { title } : {}),
      rawText: document.getText(),
      languageId: document.languageId,
      capturedAt: Date.now(),
      ...(range !== undefined ? { metadata: { [CAPTURE_RANGE_METADATA_KEY]: range } } : {})
    };
  }

  private captureRange(context: CaptureContext, document: vscode.TextDocument): SourceRange | undefined {
    if (context.scope === "selection") {
      return context.selection;
    }
    if (context.scope === "from-cursor") {
      const cursor = context.cursor ?? { line: 0, column: 0 };
      const last = document.lineAt(document.lineCount - 1);
      return { startLine: cursor.line, startColumn: cursor.column, endLine: last.lineNumber, endColumn: last.text.length };
    }
    return undefined;
  }
}
