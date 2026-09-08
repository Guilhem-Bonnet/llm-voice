/**
 * `SourceAdapter` for "Speak Selection" on any language (CdC §10.2). Markdown
 * selections are handled by `MarkdownDocumentSource` instead (keeps
 * `sourceType: "markdown"` so the Pipeline runs `parseMarkdown`); this one
 * covers every other language, and the Pipeline falls back to plain sentence
 * splitting for it (CdC §13, "texte brut en phrases pour non-Markdown").
 */

import * as vscode from "vscode";
import type { CaptureContext, SourceAdapter, SourceDocument, SourceType } from "../core/source.js";
import { CAPTURE_RANGE_METADATA_KEY } from "./captureRange.js";

export class TextSelectionSource implements SourceAdapter {
  readonly id = "source-text-selection";
  readonly sourceType: SourceType = "text";

  canCapture(context: CaptureContext): boolean {
    return (
      context.scope === "selection" &&
      context.uri !== undefined &&
      context.selection !== undefined &&
      context.languageId !== "markdown"
    );
  }

  async capture(context: CaptureContext, signal?: AbortSignal): Promise<SourceDocument> {
    if (context.uri === undefined || context.selection === undefined) {
      throw new Error("TextSelectionSource: capture requires a uri and a selection");
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(context.uri));
    if (signal?.aborted === true) {
      throw new DOMException("Aborted", "AbortError");
    }

    const title = document.uri.path.split("/").pop();
    return {
      id: `text-selection-${document.uri.toString()}-${Date.now()}`,
      sourceType: this.sourceType,
      uri: document.uri.toString(),
      ...(title !== undefined ? { title } : {}),
      rawText: document.getText(),
      languageId: document.languageId,
      capturedAt: Date.now(),
      metadata: { [CAPTURE_RANGE_METADATA_KEY]: context.selection }
    };
  }
}
