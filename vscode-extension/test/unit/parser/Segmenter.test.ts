import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../../src/parser/MarkdownParser.js";
import { segment } from "../../../src/parser/Segmenter.js";
import type { MarkdownPolicy, SegmentationPolicy } from "../../../src/parser/types.js";

function readFixture(name: string): string {
  return readFileSync(resolve(__dirname, `../../fixtures/markdown/${name}`), "utf8");
}

const READ_ALL_MARKDOWN_POLICY: MarkdownPolicy = {
  headings: "read",
  links: "labelOnly",
  images: "altText",
  code: "skip",
  tables: "summarize",
  frontmatter: "skip"
};

interface PolicyOverrides {
  mode?: SegmentationPolicy["mode"];
  maxSentencesPerChunk?: number;
  markdown?: Partial<MarkdownPolicy>;
  lang?: string;
}

function policy(overrides: PolicyOverrides = {}): SegmentationPolicy {
  return {
    mode: overrides.mode ?? "sentence",
    maxSentencesPerChunk: overrides.maxSentencesPerChunk ?? 3,
    lang: overrides.lang ?? "fr",
    markdown: { ...READ_ALL_MARKDOWN_POLICY, ...overrides.markdown }
  };
}

describe("segment — ids and skip policies (kubernetes-course.md)", () => {
  it("assigns stable, sequential seg-<index> ids", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy());
    expect(segments.slice(0, 4).map((s) => s.id)).toEqual(["seg-0", "seg-1", "seg-2", "seg-3"]);
    expect(new Set(segments.map((s) => s.id)).size).toBe(segments.length);
  });

  it("never emits a segment for frontmatter when the policy skips it", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy());
    expect(segments.some((s) => s.rawText.includes('title: "Cours Kubernetes'))).toBe(false);
  });

  it("never emits a segment for a thematicBreak or an html block", async () => {
    const blocks = await parseMarkdown("Texte.\n\n---\n\n<div>raw html</div>\n\nAutre texte.");
    const segments = segment(blocks, policy());
    expect(segments.map((s) => s.rawText)).toEqual(["Texte.", "Autre texte."]);
  });

  it("emits no code segment when the policy skips code", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy({ markdown: { code: "skip" } }));
    expect(segments.filter((s) => s.type === "code")).toHaveLength(0);
  });

  it("emits an empty spokenText code segment when the policy is 'explain' (left to the narrator)", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy({ markdown: { code: "explain" } }));
    const codeSegments = segments.filter((s) => s.type === "code");
    expect(codeSegments).toHaveLength(8);
    expect(codeSegments.every((s) => s.spokenText === "")).toBe(true);
    expect(codeSegments.every((s) => s.rawText.length > 0)).toBe(true);
  });

  it("emits an empty spokenText code segment when the policy is 'summarize' too", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy({ markdown: { code: "summarize" } }));
    expect(segments.filter((s) => s.type === "code").every((s) => s.spokenText === "")).toBe(true);
  });

  it("produces a non-empty, normalized spokenText for code when the policy is 'read'", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy({ markdown: { code: "read" } }));
    const codeSegments = segments.filter((s) => s.type === "code");
    expect(codeSegments).toHaveLength(8);
    expect(codeSegments.every((s) => (s.spokenText ?? "").length > 0)).toBe(true);
  });

  it("summarizes a table into a single 'Tableau de N lignes et M colonnes' sentence", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy());
    const tableSegments = segments.filter((s) => /^Tableau de \d+ lignes et \d+ colonnes/.test(s.spokenText ?? ""));
    expect(tableSegments).toHaveLength(2);
    expect(tableSegments[0]?.spokenText).toBe(
      "Tableau de 3 lignes et 3 colonnes : en-têtes Sonde, Rôle, Effet en cas d'échec."
    );
    expect(tableSegments[0]?.type).toBe("other");
  });

  it("emits no table segment when the policy skips tables", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy({ markdown: { tables: "skip" } }));
    expect(segments.some((s) => /Tableau de/.test(s.spokenText ?? ""))).toBe(false);
  });

  it("keeps a whole list as one 'list' segment, never sub-segmented by sentence", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy());
    const listSegments = segments.filter((s) => s.type === "list");
    expect(listSegments).toHaveLength(6);
    expect(listSegments[0]?.rawText).toContain("kube-apiserver");
  });

  it("gives every heading its own 'heading' segment, distinct from surrounding sentences", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy());
    const headingSegments = segments.filter((s) => s.type === "heading");
    expect(headingSegments).toHaveLength(14);
  });

  it("emits no heading segment when the policy skips headings", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy({ markdown: { headings: "skip" } }));
    expect(segments.filter((s) => s.type === "heading")).toHaveLength(0);
  });

  it("reads the frontmatter as an 'other' segment when the policy is not 'skip'", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy({ markdown: { frontmatter: "read" } }));
    const frontmatterSegments = segments.filter((s) => s.rawText.includes('title: "Cours Kubernetes'));
    expect(frontmatterSegments).toHaveLength(1);
    expect(frontmatterSegments[0]?.type).toBe("other");
  });

  it("emits no segment for a standalone image when the policy skips images", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy({ markdown: { images: "skip" } }));
    expect(segments.some((s) => s.rawText === "Architecture Kubernetes")).toBe(false);
  });

  it("emits an 'other' segment with the alt text when the policy reads images", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy());
    const imageSegment = segments.find((s) => s.rawText === "Architecture Kubernetes");
    expect(imageSegment?.type).toBe("other");
    expect(imageSegment?.spokenText).toBe("Architecture Kubernetes");
  });
});

describe("segment — sentence mode vs block mode", () => {
  it("in sentence mode, splits a multi-sentence paragraph into several 'sentence' segments", async () => {
    const blocks = await parseMarkdown("Premiere phrase. Deuxieme phrase. Troisieme phrase.");
    const segments = segment(blocks, policy({ mode: "sentence", maxSentencesPerChunk: 1 }));
    expect(segments.map((s) => s.type)).toEqual(["sentence", "sentence", "sentence"]);
    expect(segments.map((s) => s.rawText)).toEqual(["Premiere phrase.", "Deuxieme phrase.", "Troisieme phrase."]);
  });

  it("in sentence mode, groups up to maxSentencesPerChunk sentences per segment", async () => {
    const blocks = await parseMarkdown("Un. Deux. Trois. Quatre.");
    const segments = segment(blocks, policy({ mode: "sentence", maxSentencesPerChunk: 2 }));
    expect(segments.map((s) => s.rawText)).toEqual(["Un. Deux.", "Trois. Quatre."]);
  });

  it("in block mode, a whole paragraph becomes a single 'paragraph' segment", async () => {
    const blocks = await parseMarkdown(readFixture("kubernetes-course.md"));
    const segments = segment(blocks, policy({ mode: "block" }));
    const paragraphBlockCount = blocks.filter((b) => b.type === "paragraph").length;
    expect(segments.filter((s) => s.type === "paragraph")).toHaveLength(paragraphBlockCount);
    expect(segments.some((s) => s.type === "sentence")).toBe(false);
  });

  it("never crosses a block boundary when grouping sentences into a chunk", async () => {
    const blocks = await parseMarkdown("Phrase A1. Phrase A2.\n\nPhrase B1. Phrase B2.");
    const segments = segment(blocks, policy({ mode: "sentence", maxSentencesPerChunk: 3 }));
    expect(segments.map((s) => s.rawText)).toEqual(["Phrase A1. Phrase A2.", "Phrase B1. Phrase B2."]);
  });
});

describe("segment — sourceRange mapping (ADR-006)", () => {
  it("locates a plain sentence's exact sourceRange inside its paragraph", async () => {
    const text = "Premiere phrase. Deuxieme phrase.";
    const blocks = await parseMarkdown(text);
    const segments = segment(blocks, policy({ mode: "sentence", maxSentencesPerChunk: 1 }));
    const second = segments[1];
    expect(second?.sourceRange).toEqual({ startLine: 0, startColumn: 17, endLine: 0, endColumn: 33 });
    expect(text.slice(second!.sourceRange!.startColumn, second!.sourceRange!.endColumn)).toBe("Deuxieme phrase.");
  });

  it("falls back to the whole paragraph's range when a sentence cannot be located verbatim in the source", async () => {
    const text = "Voir la documentation officielle : [kubernetes.io](https://kubernetes.io/fr/docs/home/).";
    const blocks = await parseMarkdown(text);
    const segments = segment(blocks, policy({ mode: "sentence", maxSentencesPerChunk: 1 }));
    expect(segments).toHaveLength(1);
    expect(segments[0]?.sourceRange).toEqual(blocks[0]?.sourceRange);
  });
});
