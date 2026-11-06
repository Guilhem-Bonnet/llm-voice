import { describe, expect, it } from "vitest";
import { describePassageLines, normalizeSelections, type SourceRange } from "../../../src/core/source.js";
import { readCaptureRanges } from "../../../src/sources/captureRange.js";

function range(startLine: number, startColumn: number, endLine: number, endColumn: number): SourceRange {
  return { startLine, startColumn, endLine, endColumn };
}

describe("normalizeSelections", () => {
  it("keeps only the non-empty passages", () => {
    expect(normalizeSelections([range(3, 2, 3, 2), range(1, 0, 1, 4)])).toEqual([range(1, 0, 1, 4)]);
    expect(normalizeSelections([range(3, 2, 3, 2)])).toEqual([]);
  });

  it("puts them in document order, whatever order they were selected in", () => {
    expect(normalizeSelections([range(40, 0, 44, 0), range(12, 0, 18, 0), range(90, 0, 90, 5)])).toEqual([
      range(12, 0, 18, 0),
      range(40, 0, 44, 0),
      range(90, 0, 90, 5)
    ]);
  });

  it("merges overlapping and touching passages, one inside another included", () => {
    expect(normalizeSelections([range(1, 0, 5, 0), range(4, 0, 8, 2)])).toEqual([range(1, 0, 8, 2)]);
    expect(normalizeSelections([range(1, 0, 2, 3), range(2, 3, 2, 9)])).toEqual([range(1, 0, 2, 9)]);
    expect(normalizeSelections([range(1, 0, 9, 0), range(3, 0, 4, 0)])).toEqual([range(1, 0, 9, 0)]);
  });

  it("does not modify what it receives", () => {
    const first = range(1, 0, 5, 0);
    normalizeSelections([first, range(4, 0, 8, 2)]);
    expect(first).toEqual(range(1, 0, 5, 0));
  });
});

describe("describePassageLines", () => {
  it("says the lines as the mockup does, from 1, with « et » before the last", () => {
    expect(describePassageLines([range(11, 0, 17, 3), range(39, 0, 43, 1), range(89, 0, 89, 5)])).toBe(
      "lignes 12-18, 40-44 et 90"
    );
  });

  it("does not count a line the selection merely reaches at its first column", () => {
    expect(describePassageLines([range(11, 0, 18, 0)])).toBe("lignes 12-18");
    expect(describePassageLines([range(11, 2, 11, 9)])).toBe("ligne 12");
  });
});

describe("readCaptureRanges", () => {
  it("prefers several passages, then one, and means the whole document otherwise", () => {
    const one = range(1, 0, 2, 0);
    const two = range(5, 0, 6, 0);
    expect(readCaptureRanges({ captureRange: one, captureRanges: [one, two] })).toEqual([one, two]);
    expect(readCaptureRanges({ captureRange: one })).toEqual([one]);
    expect(readCaptureRanges(undefined)).toBeUndefined();
    expect(readCaptureRanges({ captureRanges: ["x"] })).toBeUndefined();
  });
});
