/**
 * Pure "is this range outside the visible viewport" predicate (ADR-002:
 * `revealRange` only fires when the range is not already visible). Free of
 * any `vscode` import so it can be unit tested in plain Node;
 * `HighlightController.ts` adapts `vscode.Range` to/from this shape.
 */

export interface PlainPosition {
  line: number;
  column: number;
}

export interface PlainRange {
  start: PlainPosition;
  end: PlainPosition;
}

function isBeforeOrEqual(a: PlainPosition, b: PlainPosition): boolean {
  if (a.line !== b.line) {
    return a.line < b.line;
  }
  return a.column <= b.column;
}

/** True when every point of `inner` lies within `outer` (inclusive bounds). */
export function containsRange(outer: PlainRange, inner: PlainRange): boolean {
  return isBeforeOrEqual(outer.start, inner.start) && isBeforeOrEqual(inner.end, outer.end);
}

/**
 * True when `range` is not fully contained in any of `visibleRanges` — i.e.
 * a `revealRange` call is warranted (ADR-002: never reveal when already
 * visible, to avoid jumping the editor on every segment).
 */
export function shouldReveal(range: PlainRange, visibleRanges: readonly PlainRange[]): boolean {
  return !visibleRanges.some((visible) => containsRange(visible, range));
}
