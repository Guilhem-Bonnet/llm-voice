/**
 * Source-side contracts: where spoken text comes from, and how it maps back to
 * the document it was captured from. See ADR-002 and ADR-005.
 *
 * This module is intentionally free of any `vscode` import so it can be unit
 * tested in plain Node.
 */

/** Zero-based caret position inside a text document. */
export interface SourcePosition {
  line: number;
  column: number;
}

/** Half-open range inside a text document, used to anchor highlights. */
export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** Kind of origin a captured document came from (CdC §60). */
export type SourceType =
  | "markdown"
  | "text"
  | "clipboard"
  | "claude-code"
  | "copilot"
  | "external";

/** Structural role of a segment, used to decide reading policy (CdC §12). */
export type SourceSegmentType =
  | "heading"
  | "sentence"
  | "paragraph"
  | "code"
  | "list"
  | "other";

/** A whole body of text captured at one point in time (CdC §60). */
export interface SourceDocument {
  id: string;
  sourceType: SourceType;
  title?: string;
  uri?: string;
  rawText: string;
  languageId?: string;
  metadata?: Record<string, unknown>;
  /** Epoch milliseconds at which the snapshot was taken. */
  capturedAt: number;
}

/**
 * How a character says a passage (ADR-018, note of 2026-11-06). Known and never said: no engine
 * plays it yet. `quote` is the indication as written, for a later score to start from.
 */
export interface StageState {
  readonly label: string;
  readonly kind: "manner" | "sound";
  readonly quote: string;
}

/** Smallest readable unit of a document, anchored to its origin (CdC §14). */
export interface SourceSegment {
  id: string;
  sourceUri?: string;
  sourceRange?: SourceRange;
  type: SourceSegmentType;
  rawText: string;
  /** Normalised text actually handed to the narrator or the TTS engine. */
  spokenText?: string;
  /** Role that speaks this segment (ADR-018 §1); absent = the narrator. */
  speakerId?: string;
  /** The state of that role here; comes with the text, never with a name in a log. */
  stage?: readonly StageState[];
}

/** What part of the environment a capture request targets. */
export type CaptureScope =
  | "document"
  | "selection"
  | "from-cursor"
  | "section"
  | "clipboard"
  | "inbox-message";

/** Neutral description of a capture request, free of any editor API type. */
export interface CaptureContext {
  scope: CaptureScope;
  uri?: string;
  languageId?: string;
  /** Full document text when the caller already holds it. */
  text?: string;
  selection?: SourceRange;
  /** Several selected passages, sorted and merged (`normalizeSelections`); `selection` is then the first. */
  selections?: readonly SourceRange[];
  cursor?: SourcePosition;
  /** Identifier of the inbox message to read, for `inbox-message` scope. */
  inboxMessageId?: string;
}

function comparePositions(aLine: number, aColumn: number, bLine: number, bColumn: number): number {
  return aLine !== bLine ? aLine - bLine : aColumn - bColumn;
}

/** The passages of a multi-selection: non-empty, in document order, overlapping ones merged. */
export function normalizeSelections(ranges: readonly SourceRange[]): SourceRange[] {
  const sorted = ranges
    .filter((range) => range.startLine !== range.endLine || range.startColumn !== range.endColumn)
    .slice()
    .sort((a, b) => comparePositions(a.startLine, a.startColumn, b.startLine, b.startColumn));
  const merged: SourceRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && comparePositions(range.startLine, range.startColumn, last.endLine, last.endColumn) <= 0) {
      if (comparePositions(range.endLine, range.endColumn, last.endLine, last.endColumn) > 0) {
        last.endLine = range.endLine;
        last.endColumn = range.endColumn;
      }
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** "lignes 12-18, 40-44 et 90" (1-based). A selection ending at column 0 stops on the line before. */
export function describePassageLines(ranges: readonly SourceRange[]): string {
  const parts = ranges.map((range) => {
    const first = range.startLine + 1;
    const last = range.endColumn === 0 && range.endLine > range.startLine ? range.endLine : range.endLine + 1;
    return first === last ? `${first}` : `${first}-${last}`;
  });
  const head = parts.slice(0, -1).join(", ");
  const list = head.length > 0 ? `${head} et ${parts.at(-1) ?? ""}` : (parts[0] ?? "");
  return `${ranges.length > 1 || list.includes("-") ? "lignes" : "ligne"} ${list}`;
}

/** Pluggable text origin: Markdown file, selection, clipboard, inbox (CdC §10). */
export interface SourceAdapter {
  readonly id: string;
  readonly sourceType: SourceType;
  canCapture(context: CaptureContext): boolean;
  capture(context: CaptureContext, signal?: AbortSignal): Promise<SourceDocument>;
}
