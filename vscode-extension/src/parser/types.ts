/**
 * Shared types for the Markdown parsing/segmentation pipeline (ADR-006).
 * Free of any `vscode` import, like `src/core`, so it can be unit tested in
 * plain Node.
 */

import type { SourceRange } from "../core/source.js";

/** Structural node kinds the parser recognises (CdC §12). */
export type SourceBlockType =
  | "heading"
  | "paragraph"
  | "list"
  | "listItem"
  | "blockquote"
  | "code"
  | "table"
  | "thematicBreak"
  | "html"
  | "image"
  | "frontmatter";

/** Plain-text table content, used to build the `summarize` sentence. */
export interface TableContent {
  headers: string[];
  rows: string[][];
}

/**
 * One structural unit produced by `parseMarkdown`, anchored to the source
 * document by both a line/column `sourceRange` and absolute character
 * offsets (needed by the `Segmenter` to relocate sentence sub-ranges, see
 * ADR-006 "Mapping paragraphe → phrase").
 */
export interface SourceBlock {
  type: SourceBlockType;
  sourceRange: SourceRange;
  startOffset: number;
  endOffset: number;
  /**
   * Semi-plain rendering of the block: links become their label, images
   * become their alt text, inline code keeps its backtick markers so
   * `SpokenTextNormalizer` can turn it into "code : x" later on.
   */
  text: string;
  /** Verbatim slice of the original document for this block (markdown syntax kept). */
  rawSource: string;
  /** Heading level, 1-6. */
  depth?: number;
  /** Fenced code language, when declared. */
  lang?: string;
  /** URL of a standalone image block. */
  url?: string;
  /** Structured content of a table block, used by the `summarize` policy. */
  table?: TableContent;
  /** Nested blocks: `list` → `listItem[]`, `blockquote` → its content blocks. */
  children?: SourceBlock[];
}

/** Reading mode for fenced code blocks (CdC §13). */
export type CodePolicy = "skip" | "read" | "explain" | "summarize";

/** Reading mode for GFM tables (CdC §13). */
export type TablePolicy = "skip" | "read" | "summarize";

/** Markdown-specific reading policy, one instance per voice profile (CdC §13). */
export interface MarkdownPolicy {
  headings: "read" | "skip";
  links: "labelOnly";
  images: "altText" | "skip";
  code: CodePolicy;
  tables: TablePolicy;
  frontmatter: "skip" | "read";
}

/**
 * Segmentation policy. `mode`/`maxSentencesPerChunk`/`markdown` are the
 * contract required by the story; `lang` is a deliberate addition (BCP-47
 * tag, mirrors `VoiceProfile.language`) since both sentence splitting and
 * spoken-text normalisation are language-aware (ADR-006).
 *
 * `firstChunkSentences` (S6.2, CdC §63 "la lecture démarre dès le premier
 * chunk"): when set and smaller than `maxSentencesPerChunk`, the very first
 * sentence-mode chunk of the *whole document* is capped at this many
 * sentences instead of `maxSentencesPerChunk`, so TTFA is bounded by a short
 * chunk while later chunks keep the larger size for prosody. Only the first
 * opportunity to group sentences (across every block) is affected; every
 * later group — including the rest of that same block — uses
 * `maxSentencesPerChunk` unchanged. `undefined`/`>= maxSentencesPerChunk` is
 * a no-op (`llmVoice.audio.firstChunkSentences`, `Pipeline.segmentationPolicyFor`).
 */
export interface SegmentationPolicy {
  mode: "sentence" | "block";
  maxSentencesPerChunk: number;
  markdown: MarkdownPolicy;
  lang: string;
  firstChunkSentences?: number;
}
