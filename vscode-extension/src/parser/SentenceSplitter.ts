/**
 * FR/EN-aware sentence splitting with offsets (ADR-006).
 *
 * The story asked us to try the npm package `sentence-splitter` first and
 * only fall back to a hand-written splitter if its French quality is not
 * good enough. It was evaluated against this story's pathological fixture
 * (`test/fixtures/markdown/pathological.md`): it mis-splits
 * "... les cas comme M. et Mme. qui ne terminent pas une phrase." into two
 * sentences right after "M." because it has no configurable French
 * abbreviation list. That is exactly the case ADR-006 calls out, so this
 * module never depends on it: it is a plain, dependency-free algorithm and
 * `segment()` stays fully synchronous (see `MarkdownParser.ts` for the
 * contrasting case where an ESM-only dependency was unavoidable).
 */

/** A sentence and its offsets (0-indexed, half-open) inside the input text. */
export interface SentenceWithOffset {
  text: string;
  start: number;
  end: number;
}

const FRENCH_ABBREVIATIONS = [
  "m",
  "mm",
  "mme",
  "mlle",
  "dr",
  "pr",
  "st",
  "ste",
  "etc",
  "ex",
  "cf",
  "vs",
  "p",
  "n"
];

const ENGLISH_ABBREVIATIONS = ["mr", "mrs", "ms", "dr", "prof", "eg", "ie", "vs", "etc", "jr", "sr"];

const ABBREVIATIONS = new Set([...FRENCH_ABBREVIATIONS, ...ENGLISH_ABBREVIATIONS]);

/** A `[start, end)` character range that must never be treated as a sentence terminator. */
interface ProtectedSpan {
  start: number;
  end: number;
}

const INLINE_CODE_RE = /`[^`\n]+`/g;
const URL_RE = /https?:\/\/[^\s)]+/g;
const DECIMAL_RE = /\d+\.\d+/g;
const TERMINATOR_RE = /[.!?]+/g;
const MIN_FRAGMENT_LENGTH = 15;

function findProtectedSpans(text: string): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];
  for (const re of [INLINE_CODE_RE, URL_RE, DECIMAL_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return spans;
}

function isInsideProtectedSpan(index: number, spans: readonly ProtectedSpan[]): boolean {
  return spans.some((span) => index >= span.start && index < span.end);
}

function isLowerCaseOrDigit(char: string): boolean {
  return /[\p{Ll}0-9]/u.test(char);
}

function precedingWord(text: string, upTo: number): string {
  const match = /[\p{L}]+$/u.exec(text.slice(0, upTo));
  return match ? match[0].toLowerCase() : "";
}

/** Finds every genuine sentence-terminating punctuation run in `text`, as an offset right after it. */
function findCutPoints(text: string, spans: readonly ProtectedSpan[]): number[] {
  const cuts: number[] = [];
  TERMINATOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TERMINATOR_RE.exec(text))) {
    const punctStart = match.index;
    const punctEnd = punctStart + match[0].length;
    if (isInsideProtectedSpan(punctStart, spans)) {
      continue;
    }
    let next = punctEnd;
    while (next < text.length && /\s/.test(text[next] ?? "")) {
      next++;
    }
    if (next >= text.length) {
      cuts.push(punctEnd);
      continue;
    }
    const nextChar = text[next] ?? "";
    if (isLowerCaseOrDigit(nextChar)) {
      continue;
    }
    if (ABBREVIATIONS.has(precedingWord(text, punctStart))) {
      continue;
    }
    cuts.push(punctEnd);
  }
  return cuts;
}

function trimSpan(text: string, start: number, end: number): { start: number; end: number } | null {
  let trimmedStart = start;
  while (trimmedStart < end && /\s/.test(text[trimmedStart] ?? "")) {
    trimmedStart++;
  }
  let trimmedEnd = end;
  while (trimmedEnd > trimmedStart && /\s/.test(text[trimmedEnd - 1] ?? "")) {
    trimmedEnd--;
  }
  return trimmedEnd > trimmedStart ? { start: trimmedStart, end: trimmedEnd } : null;
}

/**
 * Merges a short, unterminated trailing fragment into the previous sentence
 * (ADR-006: "fusionner les fragments < ~15 caractères"). This is
 * deliberately narrow: it only ever touches `hasTrailingTerminator: false`,
 * i.e. a leftover clause with no `.`/`!`/`?` of its own, because a *properly
 * punctuated* short sentence ("Bonjour.", "Merci !") is a legitimate
 * sentence on its own and must stay a separate `SourceSegment` for
 * highlight precision (CdC §15.1) — merging on length alone would silently
 * collapse ordinary short dialogue-like sentences into their neighbour.
 */
function mergeTrailingFragment(
  sentences: SentenceWithOffset[],
  hasTrailingTerminator: boolean
): SentenceWithOffset[] {
  if (hasTrailingTerminator || sentences.length <= 1) {
    return sentences;
  }
  const last = sentences[sentences.length - 1];
  if (!last || last.text.length >= MIN_FRAGMENT_LENGTH) {
    return sentences;
  }
  // `sentences.length > 1` (checked above) guarantees `merged` is non-empty.
  const merged = sentences.slice(0, -1);
  const previous = merged[merged.length - 1] as SentenceWithOffset;
  merged[merged.length - 1] = { start: previous.start, end: last.end, text: `${previous.text} ${last.text}` };
  return merged;
}

/**
 * Splits `text` into sentences, each keeping its `[start, end)` offset in
 * `text` so callers can recompute a `sourceRange`. `lang` is accepted for
 * API symmetry with `SpokenTextNormalizer` but the abbreviation list is
 * language-agnostic (both FR and EN lists are always active) since a
 * document can freely mix languages in code samples, product names, etc.
 */
export function splitSentences(text: string, _lang?: string): SentenceWithOffset[] {
  if (text.trim().length === 0) {
    return [];
  }
  const spans = findProtectedSpans(text);
  const cutPoints = findCutPoints(text, spans);

  const rawSpans: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const cut of cutPoints) {
    rawSpans.push({ start: cursor, end: cut });
    cursor = cut;
  }
  const hasTrailingTerminator = cursor >= text.length;
  if (cursor < text.length) {
    rawSpans.push({ start: cursor, end: text.length });
  }

  const sentences: SentenceWithOffset[] = [];
  for (const span of rawSpans) {
    const trimmed = trimSpan(text, span.start, span.end);
    if (trimmed) {
      sentences.push({ text: text.slice(trimmed.start, trimmed.end), start: trimmed.start, end: trimmed.end });
    }
  }

  return mergeTrailingFragment(sentences, hasTrailingTerminator);
}
