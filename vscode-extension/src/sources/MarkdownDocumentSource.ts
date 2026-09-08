/**
 * `SourceAdapter` for the Markdown-aware capture scopes (CdC §10.1): whole
 * document, from the cursor to the end, the current section (heading to next
 * heading of the same or shallower depth), and a selection inside a Markdown
 * document — kept here rather than in `TextSelectionSource` so the result
 * stays `sourceType: "markdown"` and the Pipeline runs the real
 * `parseMarkdown`/`segment` chain on it.
 */

import * as vscode from "vscode";
import type { CaptureContext, SourceAdapter, SourceDocument, SourceRange, SourceType } from "../core/source.js";
import { CAPTURE_RANGE_METADATA_KEY } from "./captureRange.js";

const HEADING_RE = /^(#{1,6})\s/;

function headingDepth(lineText: string): number | undefined {
  const match = HEADING_RE.exec(lineText);
  return match ? match[1]?.length : undefined;
}

/** `[headingLine, sectionEndLineExclusive]` for the section containing `cursorLine`. */
function findSectionBounds(document: vscode.TextDocument, cursorLine: number): [number, number] | undefined {
  let headingLine: number | undefined;
  let depth: number | undefined;
  for (let line = Math.min(cursorLine, document.lineCount - 1); line >= 0; line--) {
    const candidateDepth = headingDepth(document.lineAt(line).text);
    if (candidateDepth !== undefined) {
      headingLine = line;
      depth = candidateDepth;
      break;
    }
  }
  if (headingLine === undefined || depth === undefined) {
    return undefined;
  }
  let end = document.lineCount;
  for (let line = headingLine + 1; line < document.lineCount; line++) {
    const candidateDepth = headingDepth(document.lineAt(line).text);
    if (candidateDepth !== undefined && candidateDepth <= depth) {
      end = line;
      break;
    }
  }
  return [headingLine, end];
}

function endOfDocument(document: vscode.TextDocument): { line: number; column: number } {
  const lastLine = Math.max(0, document.lineCount - 1);
  return { line: lastLine, column: document.lineAt(lastLine).text.length };
}

export class MarkdownDocumentSource implements SourceAdapter {
  readonly id = "source-markdown-document";
  readonly sourceType: SourceType = "markdown";

  canCapture(context: CaptureContext): boolean {
    return (
      context.uri !== undefined &&
      context.languageId === "markdown" &&
      (context.scope === "document" ||
        context.scope === "from-cursor" ||
        context.scope === "section" ||
        context.scope === "selection")
    );
  }

  async capture(context: CaptureContext, signal?: AbortSignal): Promise<SourceDocument> {
    if (context.uri === undefined) {
      throw new Error("MarkdownDocumentSource: capture requires a uri");
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(context.uri));
    if (signal?.aborted === true) {
      throw new DOMException("Aborted", "AbortError");
    }

    const captureRange = this.resolveCaptureRange(context, document);

    const metadata: Record<string, unknown> = {};
    if (captureRange !== undefined) {
      metadata[CAPTURE_RANGE_METADATA_KEY] = captureRange;
    }

    const title = document.uri.path.split("/").pop();
    return {
      id: `markdown-${document.uri.toString()}-${Date.now()}`,
      sourceType: this.sourceType,
      uri: document.uri.toString(),
      ...(title !== undefined ? { title } : {}),
      rawText: document.getText(),
      languageId: document.languageId,
      capturedAt: Date.now(),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {})
    };
  }

  private resolveCaptureRange(
    context: CaptureContext,
    document: vscode.TextDocument
  ): SourceRange | undefined {
    switch (context.scope) {
      case "document":
        return undefined;
      case "selection":
        return context.selection;
      case "from-cursor": {
        const cursor = context.cursor ?? { line: 0, column: 0 };
        const end = endOfDocument(document);
        return { startLine: cursor.line, startColumn: cursor.column, endLine: end.line, endColumn: end.column };
      }
      case "section": {
        const cursorLine = context.cursor?.line ?? 0;
        const bounds = findSectionBounds(document, cursorLine);
        if (bounds === undefined) {
          return undefined;
        }
        const [start, endExclusive] = bounds;
        if (endExclusive >= document.lineCount) {
          const end = endOfDocument(document);
          return { startLine: start, startColumn: 0, endLine: end.line, endColumn: end.column };
        }
        return { startLine: start, startColumn: 0, endLine: endExclusive, endColumn: 0 };
      }
      default:
        return undefined;
    }
  }
}
