import { describe, expect, it } from "vitest";
import * as ParserModule from "../../../src/parser/index.js";

describe("parser barrel (index.ts)", () => {
  it("re-exports the full public surface of the pipeline", () => {
    expect(typeof ParserModule.parseMarkdown).toBe("function");
    expect(typeof ParserModule.treeToBlocks).toBe("function");
    expect(typeof ParserModule.splitSentences).toBe("function");
    expect(typeof ParserModule.normalize).toBe("function");
    expect(typeof ParserModule.segment).toBe("function");
  });

  it("wires the re-exported functions together end to end", async () => {
    const blocks = await ParserModule.parseMarkdown("# Titre\n\nUne phrase. Une autre.");
    const segments = ParserModule.segment(blocks, {
      mode: "sentence",
      maxSentencesPerChunk: 1,
      markdown: {
        headings: "read",
        links: "labelOnly",
        images: "altText",
        code: "skip",
        tables: "summarize",
        frontmatter: "skip"
      },
      lang: "fr"
    });
    expect(segments.map((s) => s.type)).toEqual(["heading", "sentence", "sentence"]);
  });
});
