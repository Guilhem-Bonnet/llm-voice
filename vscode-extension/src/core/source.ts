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

/** Smallest readable unit of a document, anchored to its origin (CdC §14). */
export interface SourceSegment {
  id: string;
  sourceUri?: string;
  sourceRange?: SourceRange;
  type: SourceSegmentType;
  rawText: string;
  /** Normalised text actually handed to the narrator or the TTS engine. */
  spokenText?: string;
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
  cursor?: SourcePosition;
  /** Identifier of the inbox message to read, for `inbox-message` scope. */
  inboxMessageId?: string;
}

/** Pluggable text origin: Markdown file, selection, clipboard, inbox (CdC §10). */
export interface SourceAdapter {
  readonly id: string;
  readonly sourceType: SourceType;
  canCapture(context: CaptureContext): boolean;
  capture(context: CaptureContext, signal?: AbortSignal): Promise<SourceDocument>;
}
