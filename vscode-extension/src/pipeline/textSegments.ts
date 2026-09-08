/**
 * Plain-text segmentation for non-Markdown sources (CdC §13: "texte brut en
 * phrases pour non-Markdown"), and the capture-range filter shared by every
 * scope short of "document complet" (`src/sources/captureRange.ts`).
 */

import type { SourceRange, SourceSegment } from "../core/source.js";
import { splitSentences } from "../parser/SentenceSplitter.js";

interface Position {
  line: number;
  column: number;
}

/** Walks `text` from `{0,0}` up to character offset `upTo`, 0-indexed. */
function advancePosition(text: string, upTo: number): Position {
  let line = 0;
  let column = 0;
  for (let index = 0; index < upTo && index < text.length; index++) {
    if (text[index] === "\n") {
      line++;
      column = 0;
    } else {
      column++;
    }
  }
  return { line, column };
}

/**
 * One `SourceSegment` per sentence of `text`, positioned by walking the
 * whole document from its start — simple and correct for the selection- and
 * clipboard-sized inputs this slice's non-Markdown sources produce.
 */
export function plainTextSegments(text: string): SourceSegment[] {
  return splitSentences(text).map((sentence, index) => {
    const start = advancePosition(text, sentence.start);
    const end = advancePosition(text, sentence.end);
    return {
      id: `plain-${index}`,
      type: "sentence",
      rawText: sentence.text,
      spokenText: sentence.text,
      sourceRange: {
        startLine: start.line,
        startColumn: start.column,
        endLine: end.line,
        endColumn: end.column
      }
    };
  });
}

function comparePosition(a: Position, b: Position): number {
  return a.line !== b.line ? a.line - b.line : a.column - b.column;
}

/** True when line/column ranges `a` and `b` intersect (half-open, inclusive edges). */
export function rangesOverlap(a: SourceRange, b: SourceRange): boolean {
  const aStart: Position = { line: a.startLine, column: a.startColumn };
  const aEnd: Position = { line: a.endLine, column: a.endColumn };
  const bStart: Position = { line: b.startLine, column: b.startColumn };
  const bEnd: Position = { line: b.endLine, column: b.endColumn };
  return comparePosition(aStart, bEnd) <= 0 && comparePosition(bStart, aEnd) <= 0;
}
