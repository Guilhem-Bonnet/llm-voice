import { describe, expect, it } from "vitest";
import { isHeadingLine } from "../../../src/ui/heading.js";

describe("isHeadingLine", () => {
  it("matches ATX headings from level 1 to 6", () => {
    for (let level = 1; level <= 6; level++) {
      expect(isHeadingLine(`${"#".repeat(level)} Title`)).toBe(true);
    }
  });

  it("rejects a bare hash with no following text", () => {
    expect(isHeadingLine("#")).toBe(false);
    expect(isHeadingLine("# ")).toBe(false);
  });

  it("rejects more than 6 hashes (not a heading in CommonMark)", () => {
    expect(isHeadingLine("####### Title")).toBe(false);
  });

  it("rejects a hashtag inside regular text", () => {
    expect(isHeadingLine("This is #not a heading")).toBe(false);
  });

  it("rejects plain paragraph text", () => {
    expect(isHeadingLine("Just a paragraph.")).toBe(false);
  });
});
