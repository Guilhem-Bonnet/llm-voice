/**
 * Shared `SourceDocument.metadata` key carrying the sub-range of the full
 * document a capture actually targets (CdC §10, ADR-002).
 *
 * `SourceDocument.rawText` is always the *full* document text for the three
 * editor-backed sources (`MarkdownDocumentSource`, `TextSelectionSource`):
 * parsing/segmenting the whole document keeps every `SourceRange` in the
 * document's own line/column coordinates, which is what `HighlightController`
 * needs (ADR-002 — the highlight never depends on a re-derived offset). The
 * Pipeline then filters segments down to `captureRange` for anything short of
 * the "document complet" scope, instead of slicing text before parsing.
 */

import type { SourceRange } from "../core/source.js";

export const CAPTURE_RANGE_METADATA_KEY = "captureRange";
/** Several passages of a multi-selection: wins over `captureRange` when present. */
export const CAPTURE_RANGES_METADATA_KEY = "captureRanges";

/** The sub-ranges a capture targets: `undefined` means the whole document. */
export function readCaptureRanges(metadata: Record<string, unknown> | undefined): readonly SourceRange[] | undefined {
  const many = metadata?.[CAPTURE_RANGES_METADATA_KEY];
  if (Array.isArray(many)) {
    const ranges = many.filter(isSourceRange);
    if (ranges.length > 0) {
      return ranges;
    }
  }
  const single = readCaptureRange(metadata);
  return single === undefined ? undefined : [single];
}

/** Reads `metadata.captureRange` back off a `SourceDocument`, if present. */
export function readCaptureRange(metadata: Record<string, unknown> | undefined): SourceRange | undefined {
  const value = metadata?.[CAPTURE_RANGE_METADATA_KEY];
  return isSourceRange(value) ? value : undefined;
}

function isSourceRange(value: unknown): value is SourceRange {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const range = value as Partial<SourceRange>;
  return (
    typeof range.startLine === "number" &&
    typeof range.startColumn === "number" &&
    typeof range.endLine === "number" &&
    typeof range.endColumn === "number"
  );
}
