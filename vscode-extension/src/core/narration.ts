/**
 * Narration contract: optional LLM rewriting of source text before synthesis.
 * See ADR-005; narration failure must never prevent playback (degraded mode).
 */

import type { ProviderHealth } from "./health.js";
import type { SourceRange, SourceSegment } from "./source.js";

/** Whether the text is read verbatim or rewritten by a narrator (CdC §4). */
export type NarrationMode = "faithful" | "narrated";

/** A unit of spoken text, possibly rewritten, still anchored to its source (CdC §61). */
export interface NarrationSegment {
  id: string;
  spokenText: string;
  /** May hold several ids: N source segments can collapse into one narration. */
  sourceSegmentIds: readonly string[];
  sourceRanges: readonly SourceRange[];
  metadata?: Record<string, unknown>;
}

/** Name of the JSON contract the narrator model is asked to produce. */
export type NarrationOutputContract = "narration-segments";

/** One narration call over an already segmented document (CdC §20). */
export interface NarrationRequest {
  segments: readonly SourceSegment[];
  profileId: string;
  language: string;
  mode: NarrationMode;
  /** Free-form style directive taken from the profile, if any. */
  style?: string;
  outputContract: NarrationOutputContract;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

/** Why narration fell back to faithful reading instead of failing hard. */
export type NarrationDegradedReason =
  | "provider-unavailable"
  | "invalid-structured-output"
  | "timeout"
  | "cancelled"
  | "budget-exceeded";

/** Narration outcome; `degraded` is surfaced to the user, never hidden. */
export interface NarrationResult {
  segments: readonly NarrationSegment[];
  degraded: boolean;
  degradedReason?: NarrationDegradedReason;
}

/** Whether the narrator enforces schema-conformant output (CdC §21-22). */
export interface NarratorCapabilities {
  /** True when the provider can be asked for a JSON-Schema-conformant reply
   *  (Ollama's `format`, OpenAI's `response_format: json_schema`); `false`
   *  narrators are still asked for JSON via the prompt, just without a
   *  server-enforced guarantee. */
  structuredOutput: boolean;
}

/** Optional local LLM that rewrites source text; never a cloud voice (D8). */
export interface NarratorProvider {
  readonly id: string;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  /** Optional: mirrors `TtsProvider.getCapabilities`, absent means "assume
   *  no structured-output guarantee". */
  getCapabilities?(signal?: AbortSignal): Promise<NarratorCapabilities>;
  /** Must resolve with `degraded: true` rather than reject on provider failure. */
  transform(
    request: NarrationRequest,
    signal?: AbortSignal
  ): Promise<NarrationResult>;
}
