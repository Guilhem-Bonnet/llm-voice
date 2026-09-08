/**
 * Small helpers shared by every `NarratorProvider` implementation in this
 * folder (`OllamaNarrator`, `OpenAICompatibleNarrator`, `NoNarrator`,
 * `parseNarration`). See ADR-005's "mode dégradé obligatoire": `transform`
 * never rejects, it resolves with `degraded: true` and a faithful (1:1,
 * un-rewritten) fallback built from `faithfulSegment` below.
 */

import type { NarrationDegradedReason, NarrationResult, NarrationSegment } from "../core/narration.js";
import type { SourceSegment } from "../core/source.js";

/** Verbatim reading of one source segment, used by every fallback path. */
export function faithfulSegment(segment: SourceSegment): NarrationSegment {
  return {
    id: `faithful-${segment.id}`,
    spokenText: segment.spokenText ?? segment.rawText,
    sourceSegmentIds: [segment.id],
    sourceRanges: segment.sourceRange ? [segment.sourceRange] : []
  };
}

/** The `NarrationResult` shape every degraded path returns: fully faithful,
 *  `degraded: true`, tagged with why. */
export function fallbackResult(
  group: readonly SourceSegment[],
  reason: NarrationDegradedReason
): NarrationResult {
  return { segments: group.map(faithfulSegment), degraded: true, degradedReason: reason };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Indirection so a later re-check of `signal.aborted` (after an `await`,
 *  where it may have flipped from `false` to `true`) is not narrowed away by
 *  an earlier `signal?.aborted === true` guard in the same function. */
export function wasAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

/** `DOMException`/`Error` raised by an aborted `fetch`, both Node's native
 *  `AbortController` and undici use `name === "AbortError"`. */
export function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export interface TimeoutHandle {
  controller: AbortController;
  /** Clears the timer and detaches the listener; call in a `finally`. */
  cleanup: () => void;
}

/**
 * Combines a caller-supplied `AbortSignal` with an internal timeout into one
 * `AbortController`. After a rejection, the call site tells cancellation
 * apart from timeout by checking whether the *caller's* signal is the one
 * that fired (`signal?.aborted === true` ⇒ "cancelled", otherwise "timeout").
 */
export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): TimeoutHandle {
  const controller = new AbortController();
  if (signal?.aborted === true) {
    controller.abort();
  }
  const onAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as unknown as { unref: () => void }).unref();
  }
  return {
    controller,
    cleanup: (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };
}
