import { describe, expect, it } from "vitest";
import { plainTextSegments, rangesOverlap } from "../../../src/pipeline/textSegments.js";

describe("plainTextSegments (CdC §13, non-Markdown fallback)", () => {
  it("splits multi-sentence text and positions each sentence absolutely", () => {
    const text = "Première phrase. Deuxième phrase.";
    const segments = plainTextSegments(text);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.spokenText).toBe("Première phrase.");
    expect(segments[0]?.sourceRange?.startLine).toBe(0);
    expect(segments[0]?.sourceRange?.startColumn).toBe(0);
    expect(segments[1]?.spokenText).toBe("Deuxième phrase.");
  });

  it("accounts for newlines when positioning later sentences", () => {
    const text = "Ligne un.\nLigne deux.";
    const segments = plainTextSegments(text);
    expect(segments).toHaveLength(2);
    expect(segments[1]?.sourceRange?.startLine).toBe(1);
    expect(segments[1]?.sourceRange?.startColumn).toBe(0);
  });

  it("returns an empty array for empty input", () => {
    expect(plainTextSegments("")).toEqual([]);
  });

  it("tags every segment as type 'sentence'", () => {
    for (const segment of plainTextSegments("Une phrase. Une autre.")) {
      expect(segment.type).toBe("sentence");
    }
  });
});

describe("rangesOverlap", () => {
  it("is true when two ranges intersect on the same line", () => {
    const a = { startLine: 0, startColumn: 0, endLine: 0, endColumn: 10 };
    const b = { startLine: 0, startColumn: 5, endLine: 0, endColumn: 15 };
    expect(rangesOverlap(a, b)).toBe(true);
  });

  it("is true when one range fully contains the other", () => {
    const outer = { startLine: 0, startColumn: 0, endLine: 5, endColumn: 0 };
    const inner = { startLine: 2, startColumn: 0, endLine: 2, endColumn: 10 };
    expect(rangesOverlap(outer, inner)).toBe(true);
  });

  it("is false when ranges are on disjoint lines", () => {
    const a = { startLine: 0, startColumn: 0, endLine: 0, endColumn: 5 };
    const b = { startLine: 3, startColumn: 0, endLine: 3, endColumn: 5 };
    expect(rangesOverlap(a, b)).toBe(false);
  });

  it("is true when ranges touch at a single point", () => {
    const a = { startLine: 0, startColumn: 0, endLine: 0, endColumn: 5 };
    const b = { startLine: 0, startColumn: 5, endLine: 0, endColumn: 10 };
    expect(rangesOverlap(a, b)).toBe(true);
  });
});
