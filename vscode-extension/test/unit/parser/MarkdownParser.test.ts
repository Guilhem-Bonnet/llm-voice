import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../../src/parser/MarkdownParser.js";
import type { SourceBlock } from "../../../src/parser/types.js";

function readFixture(name: string): string {
  return readFileSync(resolve(__dirname, `../../fixtures/markdown/${name}`), "utf8");
}

/** Every block's `[startOffset, endOffset)` must reproduce `rawSource` verbatim. */
function expectOffsetsMatchSource(text: string, blocks: readonly SourceBlock[]): void {
  for (const block of blocks) {
    expect(text.slice(block.startOffset, block.endOffset)).toBe(block.rawSource);
    if (block.children) {
      expectOffsetsMatchSource(text, block.children);
    }
  }
}

describe("parseMarkdown — short.md", () => {
  it("produces one heading block followed by two paragraph blocks", async () => {
    const text = readFixture("short.md");
    const blocks = await parseMarkdown(text, "file:///short.md");

    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "paragraph"]);
    expect(blocks[0]?.depth).toBe(1);
    expect(blocks[0]?.text).toBe("Note rapide");
  });

  it("has exact source ranges: text.slice(startOffset, endOffset) === rawSource", async () => {
    const text = readFixture("short.md");
    const blocks = await parseMarkdown(text);
    expectOffsetsMatchSource(text, blocks);
  });

  it("converts mdast 1-indexed positions to a 0-indexed sourceRange", async () => {
    const text = readFixture("short.md");
    const blocks = await parseMarkdown(text);
    // "# Note rapide" is on the very first line/column of the document.
    expect(blocks[0]?.sourceRange).toEqual({ startLine: 0, startColumn: 0, endLine: 0, endColumn: 13 });
  });
});

describe("parseMarkdown — kubernetes-course.md", () => {
  it("recognises every block type required by the story", async () => {
    const text = readFixture("kubernetes-course.md");
    const blocks = await parseMarkdown(text, "file:///kubernetes-course.md");

    const counts = new Map<string, number>();
    for (const block of blocks) {
      counts.set(block.type, (counts.get(block.type) ?? 0) + 1);
    }

    expect(blocks).toHaveLength(50);
    expect(counts.get("frontmatter")).toBe(1);
    expect(counts.get("heading")).toBe(14);
    expect(counts.get("paragraph")).toBe(18);
    expect(counts.get("image")).toBe(1);
    expect(counts.get("list")).toBe(6);
    expect(counts.get("code")).toBe(8);
    expect(counts.get("table")).toBe(2);
  });

  it("keeps every sourceRange consistent with an offset-based slice of the document", async () => {
    const text = readFixture("kubernetes-course.md");
    const blocks = await parseMarkdown(text);
    expectOffsetsMatchSource(text, blocks);
  });

  it("puts the frontmatter first, as its own block, never merged with the heading", async () => {
    const text = readFixture("kubernetes-course.md");
    const blocks = await parseMarkdown(text);
    expect(blocks[0]?.type).toBe("frontmatter");
    expect(blocks[0]?.text).toContain('title: "Cours Kubernetes — Les fondamentaux"');
    expect(blocks[1]?.type).toBe("heading");
  });

  it("gives every heading its own block (never merged into surrounding paragraphs)", async () => {
    const text = readFixture("kubernetes-course.md");
    const blocks = await parseMarkdown(text);
    const headings = blocks.filter((block) => block.type === "heading");
    expect(headings.every((heading) => heading.text.length > 0)).toBe(true);
    expect(headings.map((heading) => heading.depth)).toEqual([1, 2, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  });

  it("captures the fenced code language and raw content", async () => {
    const text = readFixture("kubernetes-course.md");
    const blocks = await parseMarkdown(text);
    const codeBlocks = blocks.filter((block) => block.type === "code");
    expect(codeBlocks.map((block) => block.lang)).toEqual([
      "yaml",
      "bash",
      "yaml",
      "bash",
      "yaml",
      "bash",
      "yaml",
      "bash"
    ]);
    expect(codeBlocks[0]?.text).toContain("kind: Pod");
  });

  it("turns a table into structured headers/rows for the summarize policy", async () => {
    const text = readFixture("kubernetes-course.md");
    const blocks = await parseMarkdown(text);
    const [probesTable] = blocks.filter((block) => block.type === "table");
    expect(probesTable?.table).toEqual({
      headers: ["Sonde", "Rôle", "Effet en cas d'échec"],
      rows: [
        ["liveness", "vérifie que le conteneur est vivant", "redémarrage du conteneur"],
        ["readiness", "vérifie que le conteneur peut servir", "retrait du service (endpoints)"],
        ["startup", "protège les démarrages lents", "délai supplémentaire accordé"]
      ]
    });
  });

  it("keeps list items nested as children, not flattened into the list's own text", async () => {
    const text = readFixture("kubernetes-course.md");
    const blocks = await parseMarkdown(text);
    const [controlPlaneList] = blocks.filter((block) => block.type === "list");
    expect(controlPlaneList?.children).toHaveLength(4);
    expect(controlPlaneList?.children?.every((child) => child.type === "listItem")).toBe(true);
    expect(controlPlaneList?.text).toContain("kube-apiserver");
  });

  it("extracts a standalone image line as an `image` block with alt text and url", async () => {
    const text = readFixture("kubernetes-course.md");
    const blocks = await parseMarkdown(text);
    const [image] = blocks.filter((block) => block.type === "image");
    expect(image?.text).toBe("Architecture Kubernetes");
    expect(image?.url).toBe("https://kubernetes.io/images/docs/components-of-kubernetes.svg");
  });

  it("renders a link as its label only, dropping the URL, in paragraph text", async () => {
    const text = readFixture("kubernetes-course.md");
    const blocks = await parseMarkdown(text);
    const linkParagraph = blocks.find(
      (block) => block.type === "paragraph" && block.text.includes("documentation officielle")
    );
    expect(linkParagraph?.text).toBe("Voir la documentation officielle : kubernetes.io.");
  });

  it("keeps inline code backticks in the semi-plain block text", async () => {
    const text = readFixture("kubernetes-course.md");
    const blocks = await parseMarkdown(text);
    const [controlPlaneList] = blocks.filter((block) => block.type === "list");
    expect(controlPlaneList?.children?.[0]?.text).toContain("`kube-apiserver`");
  });
});

describe("parseMarkdown — pathological.md", () => {
  it("skips no real content: heading, four paragraphs, one list, one closing paragraph", async () => {
    const text = readFixture("pathological.md");
    const blocks = await parseMarkdown(text);
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "list",
      "paragraph"
    ]);
  });

  it("has no frontmatter and no code block in this fixture", async () => {
    const text = readFixture("pathological.md");
    const blocks = await parseMarkdown(text);
    expect(blocks.some((block) => block.type === "frontmatter")).toBe(false);
    expect(blocks.some((block) => block.type === "code")).toBe(false);
  });

  it("preserves an inline code span inside a list item without truncation", async () => {
    const text = readFixture("pathological.md");
    const blocks = await parseMarkdown(text);
    const [list] = blocks.filter((block) => block.type === "list");
    const lastItem = list?.children?.[list.children.length - 1];
    expect(lastItem?.text).toContain("`code inline`");
  });

  it("has exact source ranges on this pathological fixture too: text.slice(startOffset, endOffset) === rawSource", async () => {
    const text = readFixture("pathological.md");
    const blocks = await parseMarkdown(text);
    expectOffsetsMatchSource(text, blocks);
  });
});

describe("parseMarkdown — additional block kinds not covered by the story fixtures", () => {
  it("recognises a blockquote as its own block, with its paragraph content as a child", async () => {
    const text = "> Une citation importante.\n> Sur deux lignes.";
    const blocks = await parseMarkdown(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("blockquote");
    expect(blocks[0]?.children).toHaveLength(1);
    expect(blocks[0]?.children?.[0]?.type).toBe("paragraph");
    expect(blocks[0]?.text).toContain("Une citation importante.");
    expectOffsetsMatchSource(text, blocks);
  });

  it("silently ignores markdown node kinds it does not model (e.g. a reference-style link definition)", async () => {
    const text = "Un paragraphe.\n\n[ref]: https://example.com \"Titre\"";
    const blocks = await parseMarkdown(text);
    expect(blocks.map((block) => block.type)).toEqual(["paragraph"]);
  });
});
