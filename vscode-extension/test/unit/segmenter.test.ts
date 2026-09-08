import { describe, expect, it } from "vitest";
import { splitIntoSentences } from "../../src/parser/segmenter.js";

describe("splitIntoSentences", () => {
  it("splits a paragraph into individual sentences", () => {
    const result = splitIntoSentences("Bonjour. Comment vas-tu ? Très bien !");
    expect(result).toEqual(["Bonjour.", "Comment vas-tu ?", "Très bien !"]);
  });

  it("returns a single sentence unchanged when there is no terminator", () => {
    expect(splitIntoSentences("Pas de ponctuation finale")).toEqual([
      "Pas de ponctuation finale"
    ]);
  });

  it("filters out empty segments produced by extra whitespace", () => {
    expect(splitIntoSentences("  Un.   Deux.  ")).toEqual(["Un.", "Deux."]);
  });

  it("returns an empty array for empty input", () => {
    expect(splitIntoSentences("")).toEqual([]);
  });
});
