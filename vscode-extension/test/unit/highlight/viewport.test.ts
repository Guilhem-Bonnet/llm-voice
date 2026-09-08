import { describe, expect, it } from "vitest";
import { containsRange, shouldReveal, type PlainRange } from "../../../src/highlight/viewport.js";

function range(startLine: number, startCol: number, endLine: number, endCol: number): PlainRange {
  return { start: { line: startLine, column: startCol }, end: { line: endLine, column: endCol } };
}

describe("containsRange", () => {
  it("is true when inner is fully inside outer", () => {
    expect(containsRange(range(0, 0, 10, 0), range(2, 0, 3, 5))).toBe(true);
  });

  it("is true at the exact boundaries", () => {
    expect(containsRange(range(0, 0, 5, 10), range(0, 0, 5, 10))).toBe(true);
  });

  it("is false when inner starts before outer", () => {
    expect(containsRange(range(2, 0, 10, 0), range(1, 0, 3, 0))).toBe(false);
  });

  it("is false when inner ends after outer", () => {
    expect(containsRange(range(0, 0, 5, 0), range(1, 0, 6, 0))).toBe(false);
  });
});

describe("shouldReveal", () => {
  it("returns false when the range is already visible (ADR-002)", () => {
    const visible = [range(0, 0, 50, 0)];
    expect(shouldReveal(range(10, 0, 10, 20), visible)).toBe(false);
  });

  it("returns true when the range is outside every visible range", () => {
    const visible = [range(0, 0, 10, 0)];
    expect(shouldReveal(range(20, 0, 20, 5), visible)).toBe(true);
  });

  it("returns true when there are no visible ranges at all", () => {
    expect(shouldReveal(range(0, 0, 0, 5), [])).toBe(true);
  });
});
