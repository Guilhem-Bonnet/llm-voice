/**
 * `SourceBlock[]` → `SourceSegment[]` (CdC §13-14, §33, ADR-006).
 *
 * Purely synchronous: it only depends on `SentenceSplitter` (dependency-free)
 * and `SpokenTextNormalizer` (regex-only), never on the ESM-only Markdown
 * dependencies loaded by `MarkdownParser`.
 */

import type { SourceRange, SourceSegment, SourceSegmentType } from "../core/source.js";
import { splitSentences, type SentenceWithOffset } from "./SentenceSplitter.js";
import { normalize } from "./SpokenTextNormalizer.js";
import type { SegmentationPolicy, SourceBlock, TableContent } from "./types.js";

/** Advances a `{line, column}` position (0-indexed) by walking `text` up to `upTo`. */
function advancePosition(
  base: { line: number; column: number },
  text: string,
  upTo: number
): { line: number; column: number } {
  let line = base.line;
  let column = base.column;
  for (let index = 0; index < upTo && index < text.length; index++) {
    if (text[index] === "\n") {
      line++;
      column = 0;
    } else {
      column++;
    }
  }
  return { line, column };
}

/**
 * Locates `needle` inside `block.rawSource` and converts the match to an
 * absolute `SourceRange`. Falls back to the whole block range when the
 * search fails (ADR-006: markdown syntax dropped from `block.text`, e.g. a
 * link's URL, can make the search miss).
 */
function locateRange(block: SourceBlock, needle: string): SourceRange {
  const index = block.rawSource.indexOf(needle);
  if (index === -1) {
    return block.sourceRange;
  }
  const start = advancePosition(
    { line: block.sourceRange.startLine, column: block.sourceRange.startColumn },
    block.rawSource,
    index
  );
  const end = advancePosition(start, block.rawSource.slice(index), needle.length);
  return { startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column };
}

function unionRange(a: SourceRange, b: SourceRange): SourceRange {
  const startsBefore =
    a.startLine < b.startLine || (a.startLine === b.startLine && a.startColumn <= b.startColumn);
  const endsAfter = a.endLine > b.endLine || (a.endLine === b.endLine && a.endColumn >= b.endColumn);
  return {
    startLine: startsBefore ? a.startLine : b.startLine,
    startColumn: startsBefore ? a.startColumn : b.startColumn,
    endLine: endsAfter ? a.endLine : b.endLine,
    endColumn: endsAfter ? a.endColumn : b.endColumn
  };
}

function summarizeTable(table: TableContent): string {
  const rowCount = table.rows.length;
  const columnCount = table.headers.length;
  const headers = table.headers.join(", ");
  return `Tableau de ${rowCount} lignes et ${columnCount} colonnes : en-têtes ${headers}.`;
}

function readTable(table: TableContent): string {
  const rows = table.rows.map((row) => row.join(", ")).join(". ");
  return `${table.headers.join(", ")}. ${rows}`;
}

class IdGenerator {
  private counter = 0;
  next(): string {
    const id = `seg-${this.counter}`;
    this.counter++;
    return id;
  }
}

/** Mutable, single-document state threaded through `segmentBlock`/`segmentSentences` (S6.2). */
interface SegmenterState {
  /** True once the document has produced its first segment(s) — the short-first-chunk window has closed. */
  firstConsumed: boolean;
}

function buildSegment(
  id: string,
  type: SourceSegmentType,
  sourceRange: SourceRange,
  rawText: string,
  spokenText: string
): SourceSegment {
  return { id, sourceRange, type, rawText, spokenText };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) {
    return items.length > 0 ? [items.slice()] : [];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Groups `sentences` into chunks of `policy.maxSentencesPerChunk`, except the
 * very first group of the whole document (`!state.firstConsumed`), which is
 * capped at `policy.firstChunkSentences` when that is smaller (CdC §63,
 * S6.2's "premier chunk court"). A no-op — same grouping as before — once
 * this document has already produced its first chunk, or when the policy
 * does not set `firstChunkSentences`, or when it is not actually smaller.
 */
function groupSentences(
  sentences: readonly SentenceWithOffset[],
  policy: SegmentationPolicy,
  state: SegmenterState
): SentenceWithOffset[][] {
  const first = policy.firstChunkSentences;
  if (state.firstConsumed || first === undefined || first >= policy.maxSentencesPerChunk || first < 1) {
    return chunk(sentences, policy.maxSentencesPerChunk);
  }
  if (first >= sentences.length) {
    // The whole first block already fits under the short-first-chunk cap:
    // nothing to split off, fall through to the normal grouping.
    return chunk(sentences, policy.maxSentencesPerChunk);
  }
  return [sentences.slice(0, first), ...chunk(sentences.slice(first), policy.maxSentencesPerChunk)];
}

function segmentSentences(
  block: SourceBlock,
  policy: SegmentationPolicy,
  ids: IdGenerator,
  state: SegmenterState
): SourceSegment[] {
  const sentences = splitSentences(block.text, policy.lang);
  if (sentences.length === 0) {
    return [];
  }
  const groups = groupSentences(sentences, policy, state);
  return groups.map((group) => {
    const rawText = group.map((sentence) => sentence.text).join(" ");
    const range = group
      .map((sentence) => locateRange(block, sentence.text))
      .reduce((acc, range) => (acc ? unionRange(acc, range) : range));
    return buildSegment(ids.next(), "sentence", range, rawText, normalize(rawText, policy.lang));
  });
}

function segmentBlock(
  block: SourceBlock,
  policy: SegmentationPolicy,
  ids: IdGenerator,
  state: SegmenterState
): SourceSegment[] {
  const { markdown } = policy;

  switch (block.type) {
    case "frontmatter":
      if (markdown.frontmatter === "skip") {
        return [];
      }
      return [buildSegment(ids.next(), "other", block.sourceRange, block.text, normalize(block.text, policy.lang))];

    case "thematicBreak":
    case "html":
    case "listItem":
      return [];

    case "heading": {
      if (markdown.headings === "skip") {
        return [];
      }
      return [
        buildSegment(ids.next(), "heading", block.sourceRange, block.text, normalize(block.text, policy.lang))
      ];
    }

    case "code": {
      if (markdown.code === "skip") {
        return [];
      }
      const spokenText =
        markdown.code === "explain" || markdown.code === "summarize" ? "" : normalize(block.text, policy.lang);
      return [buildSegment(ids.next(), "code", block.sourceRange, block.text, spokenText)];
    }

    case "table": {
      if (markdown.tables === "skip" || !block.table) {
        return [];
      }
      const spokenText =
        markdown.tables === "summarize" ? summarizeTable(block.table) : normalize(readTable(block.table), policy.lang);
      return [buildSegment(ids.next(), "other", block.sourceRange, block.text, spokenText)];
    }

    case "list":
      return [buildSegment(ids.next(), "list", block.sourceRange, block.text, normalize(block.text, policy.lang))];

    case "image": {
      if (markdown.images === "skip") {
        return [];
      }
      return [buildSegment(ids.next(), "other", block.sourceRange, block.text, normalize(block.text, policy.lang))];
    }

    case "paragraph":
    case "blockquote": {
      if (policy.mode === "block") {
        return [
          buildSegment(ids.next(), "paragraph", block.sourceRange, block.text, normalize(block.text, policy.lang))
        ];
      }
      return segmentSentences(block, policy, ids, state);
    }
  }
}

/**
 * Splits parsed `blocks` into `SourceSegment`s according to `policy` (CdC
 * §14, §33). `policy.firstChunkSentences` (S6.2) shrinks only the very first
 * sentence-mode group across the whole `blocks` array — `state` here is what
 * tracks "has the document produced its first chunk yet" across block
 * boundaries.
 */
export function segment(blocks: readonly SourceBlock[], policy: SegmentationPolicy): SourceSegment[] {
  const ids = new IdGenerator();
  const state: SegmenterState = { firstConsumed: false };
  const segments: SourceSegment[] = [];
  for (const block of blocks) {
    const produced = segmentBlock(block, policy, ids, state);
    if (produced.length > 0) {
      state.firstConsumed = true;
    }
    segments.push(...produced);
  }
  return segments;
}
