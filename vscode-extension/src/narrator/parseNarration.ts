/**
 * Pure parsing/validation of a narrator model's structured-output reply
 * (CdC §21). Never throws: any failure degrades to a faithful mapping for
 * the segments it could not account for, and `parseNarration` itself never
 * touches the network — both `OllamaNarrator` and `OpenAICompatibleNarrator`
 * hand it the raw `message.content` string they received.
 *
 * `sourceIds` in the model's reply are the positional `BLOCK_xxx` labels
 * built by `buildBlockPrompt` for the group being narrated, not the real
 * `SourceSegment.id` (segment ids are free-form and need not look like
 * `BLOCK_001` — see `src/core/source.ts`). `blockLabel`/`buildBlockPrompt`
 * are the single source of truth for that positional mapping so the prompt
 * builders and the parser never drift apart.
 */

import { z } from "zod";

import type { NarrationDegradedReason, NarrationResult, NarrationSegment } from "../core/narration.js";
import type { SourceRange, SourceSegment } from "../core/source.js";
import { faithfulSegment } from "./shared.js";

/** `BLOCK_001`, `BLOCK_002`, ... — 1-based, 3-digit, matching CdC §21's example. */
export function blockLabel(index: number): string {
  return `BLOCK_${String(index + 1).padStart(3, "0")}`;
}

/** `BLOCK_001\n<text>\n\nBLOCK_002\n<text>` sent as the user message. */
export function buildBlockPrompt(group: readonly SourceSegment[]): string {
  return group.map((segment, index) => `${blockLabel(index)}\n${segment.spokenText ?? segment.rawText}`).join("\n\n");
}

const RawNarrationSegmentSchema = z.object({
  sourceIds: z.array(z.string().min(1)).min(1),
  spokenText: z.string().min(1)
});

const RawNarrationSchema = z.object({
  segments: z.array(RawNarrationSegmentSchema)
});

export interface ParseNarrationInput {
  /** Raw model output: `message.content` (Ollama) or `choices[0].message.content` (OpenAI-compatible). */
  raw: string;
  /** The exact group handed to the narrator; `blockLabel(i)` ⇔ `group[i]`. */
  group: readonly SourceSegment[];
}

export interface ParseNarrationOutcome {
  result: NarrationResult;
  /** Human-readable, non-fatal issues: unknown ids, uncovered blocks, etc. */
  warnings: readonly string[];
}

function stripTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, "$1");
}

/** Every substring worth trying to `JSON.parse`, most-specific first: the
 *  fenced ```json block if any, the {...} span if the reply wraps JSON in
 *  prose, then the raw text itself. */
function candidateStrings(raw: string): string[] {
  const trimmed = raw.trim();
  const candidates: string[] = [];
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1] !== undefined) {
    candidates.push(fenceMatch[1].trim());
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }
  candidates.push(trimmed);
  return [...new Set(candidates)];
}

function tryParseJson(raw: string): unknown {
  for (const candidate of candidateStrings(raw)) {
    for (const text of [candidate, stripTrailingCommas(candidate)]) {
      try {
        return JSON.parse(text);
      } catch {
        // try the next candidate/repair
      }
    }
  }
  return undefined;
}

function fullFallback(
  group: readonly SourceSegment[],
  reason: NarrationDegradedReason,
  warnings: string[]
): ParseNarrationOutcome {
  return {
    result: { segments: group.map(faithfulSegment), degraded: true, degradedReason: reason },
    warnings
  };
}

/**
 * Validates and repairs a narrator reply against the `narration-segments`
 * contract (CdC §20-21):
 * - unparsable/schema-invalid JSON (even after fence-stripping and
 *   trailing-comma repair) → `degraded: true`, full faithful fallback;
 * - a segment whose every `sourceIds` entry is unknown is dropped (warning),
 *   its blocks fall through to the "uncovered" case below;
 * - a source block covered by no returned segment gets its own faithful
 *   segment appended (warning), without marking the whole group degraded;
 * - only when *nothing* usable comes out of the reply does this function
 *   report `degraded: true`.
 */
export function parseNarration(input: ParseNarrationInput): ParseNarrationOutcome {
  const { raw, group } = input;

  const parsedJson = tryParseJson(raw);
  if (parsedJson === undefined) {
    return fullFallback(group, "invalid-structured-output", ["narrator output is not valid JSON"]);
  }

  const validated = RawNarrationSchema.safeParse(parsedJson);
  if (!validated.success) {
    return fullFallback(group, "invalid-structured-output", [
      "narrator output does not match the narration-segments contract"
    ]);
  }

  const labelToSegment = new Map(group.map((segment, index) => [blockLabel(index), segment]));
  const covered = new Set<string>();
  const segments: NarrationSegment[] = [];
  const warnings: string[] = [];

  validated.data.segments.forEach((rawSegment, index) => {
    const known = rawSegment.sourceIds.filter((id) => labelToSegment.has(id));
    const unknown = rawSegment.sourceIds.filter((id) => !labelToSegment.has(id));
    unknown.forEach((id) => warnings.push(`unknown sourceId ${id} ignored`));

    if (known.length === 0) {
      warnings.push(`narration segment ${index} dropped: no known sourceId`);
      return;
    }

    const realIds = known.map((label) => labelToSegment.get(label)!.id);
    const ranges: SourceRange[] = known
      .map((label) => labelToSegment.get(label)!.sourceRange)
      .filter((range): range is SourceRange => range !== undefined);
    realIds.forEach((id) => covered.add(id));

    segments.push({
      id: `narrated-${index}`,
      spokenText: rawSegment.spokenText.trim(),
      sourceSegmentIds: realIds,
      sourceRanges: ranges
    });
  });

  if (segments.length === 0) {
    return fullFallback(group, "invalid-structured-output", [...warnings, "no usable narration segment"]);
  }

  for (const segment of group) {
    if (!covered.has(segment.id)) {
      warnings.push(`block ${segment.id} not covered by narration, using faithful reading`);
      segments.push(faithfulSegment(segment));
    }
  }

  return { result: { segments, degraded: false }, warnings };
}
