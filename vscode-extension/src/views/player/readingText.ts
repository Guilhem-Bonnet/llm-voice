/** What the player says during a reading. No `vscode` import. */

import type { AudioChunk } from "../../core/playback.js";
import { describePassageLines, type SourceRange, type SourceSegment } from "../../core/source.js";

export function charsOf(texts: readonly (string | undefined)[]): number {
  return texts.reduce((total, text) => total + (text?.length ?? 0), 0);
}

/**
 * Passages generated past the one being read, without a gap: what `AudioQueue`'s timing
 * events have just updated. `undefined` once nothing follows: no "next passage" to announce.
 */
export function passagesAhead(chunks: readonly AudioChunk[], index: number): number | undefined {
  if (index + 1 >= chunks.length) {
    return undefined;
  }
  let ahead = 0;
  for (let next = index + 1; next < chunks.length && chunks[next]?.status === "ready"; next += 1) {
    ahead += 1;
  }
  return ahead;
}

/** "Lecture de : Titre, lignes 42-58", or nothing when no heading comes before these lines. */
export function describeReading(
  headings: readonly SourceSegment[],
  ranges: readonly SourceRange[]
): string | undefined {
  const first = ranges[0];
  const last = ranges.at(-1);
  if (first === undefined || last === undefined) {
    return undefined;
  }
  let title: string | undefined;
  for (const heading of headings) {
    if (heading.sourceRange !== undefined && heading.sourceRange.startLine <= first.startLine) {
      title = heading.rawText.replace(/^#+\s*/, "").trim();
    }
  }
  if (title === undefined || title.length === 0) {
    return undefined;
  }
  const lines = describePassageLines([{ ...first, endLine: last.endLine, endColumn: last.endColumn }]);
  return `Lecture de : ${title}, ${lines}`;
}
