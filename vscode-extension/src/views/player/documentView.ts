/**
 * The "Document ouvert" block, from what the editor says. No `vscode` import, and
 * no content: a file name and line numbers are all the webview ever receives here.
 */

import type { PlayerDocumentView } from "../../core/playback.js";
import { describePassageLines, normalizeSelections, type SourceRange } from "../../core/source.js";

export interface DocumentViewInput {
  scheme: string;
  path: string;
  selections: readonly SourceRange[];
}

/** VS Code's own output panel is a text editor too, and nothing anyone wants read to them. */
const NOT_A_DOCUMENT = new Set(["output", "debug"]);

export function documentViewOf(input: DocumentViewInput | undefined): PlayerDocumentView | null {
  if (input === undefined || NOT_A_DOCUMENT.has(input.scheme)) {
    return null;
  }
  const passages = normalizeSelections(input.selections);
  return {
    fileName: input.path.split("/").pop() ?? input.path,
    passages: passages.length,
    ...(passages.length > 1 ? { passagesText: `Passages : ${describePassageLines(passages)}.` } : {})
  };
}
