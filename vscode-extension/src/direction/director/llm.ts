/**
 * The seam between the direction roles and a language model (ADR-015 §2,
 * roles 1 and 3). `Analyst` and `StageDirector` only know this interface: a
 * concrete client (Ollama through `EgressGuard`, ADR-010) or `FakeDirectionLlm`
 * plugs in behind it. No `vscode`, no `fetch`: a concrete client owns the
 * network and must go through the `EgressGuardHandle`.
 *
 * Contract of an implementation:
 * - it returns the model's structured answer, already parsed from JSON but
 *   **not validated** (the controller and the analyst schema do that);
 * - it rejects with `DirectionLlmError` (or any error, classified by
 *   `classifyLlmFailure`) when it cannot answer; it must honour `signal`;
 * - it builds its own prompts, from the structured request below. Prompts are
 *   versioned in the repository and carry no prosody rule (ADR-015 §2, "Aucune
 *   règle de style"); `promptVersion` is part of the partition cache key.
 *
 * `Analyst` and `StageDirector` never reject: they turn every failure into a
 * degraded result (ADR-015 §2, "Repli (jamais bloquant)").
 */

import type { Bible, BibleAnalysis, Cue } from "../../core/direction.js";
import { EgressDeniedError } from "../../net/EgressGuard.js";
import { isAbortLike, wasAborted, withTimeout } from "../../narrator/shared.js";
import type { Resend } from "../controller/index.js";

/**
 * Why a reading (or a part of it) fell back to the neutral partition. The
 * first five are those of `NarrationDegradedReason`; `egress-denied`, `late`
 * and `gpu-yield` are the additions of ADR-015 §2; `resend-budget-exhausted`
 * is the controller's own verdict (`invalid-structured-output` stays for a
 * model that answered something that is not JSON at all).
 */
export type DirectionDegradedReason =
  | "provider-unavailable"
  | "invalid-structured-output"
  | "timeout"
  | "cancelled"
  | "egress-denied"
  | "late"
  | "gpu-yield"
  | "resend-budget-exhausted";

export class DirectionLlmError extends Error {
  constructor(
    readonly reason: DirectionDegradedReason,
    message?: string
  ) {
    super(message ?? reason);
    this.name = "DirectionLlmError";
  }
}

/** A block of the document as the model sees it. */
export interface LlmBlock {
  readonly id: string;
  readonly text: string;
}

export interface AnalysisLlmRequest {
  readonly documentKey: string;
  /** 0-based chapter of a text too long for one call; the bible carries what earlier chapters established. */
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly blocks: readonly LlmBlock[];
  /** Effective bible (ADR-015 §4). */
  readonly bible: Bible;
}

export interface DirectionLlmRequest {
  readonly documentKey: string;
  /** 0 for the first call of a window, then 1..maxResends (controller re-prompts). */
  readonly attempt: number;
  /** What the previous answer got wrong; empty on the first call. */
  readonly resend: readonly Resend[];
  readonly analysis?: BibleAnalysis;
  readonly bible: Bible;
  /** The K segments to direct, in reading order. */
  readonly window: readonly LlmBlock[];
  /** The W segments before the window (already read or directed), for continuity. */
  readonly previous: readonly LlmBlock[];
  /** Cues already directed for `previous`, when known. */
  readonly previousCues: readonly Cue[];
  /** The L segments after the window, read-only context. */
  readonly following: readonly LlmBlock[];
}

export interface DirectionLlm {
  readonly id: string;
  /** Part of the partition cache key (ADR-015 §8). */
  readonly model: string;
  /** Part of the partition cache key; bump it when a prompt changes. */
  readonly promptVersion: string;
  /** Analysis of one chapter: `{ analysis?, characters? }` (see `RawAnalysisSchema`). */
  analyze(request: AnalysisLlmRequest, signal?: AbortSignal): Promise<unknown>;
  /** One window: `{ cues, facts? }` (see `RawDirectionOutputSchema` and `StageDirector`). */
  direct(request: DirectionLlmRequest, signal?: AbortSignal): Promise<unknown>;
}

/** Maps any thrown value to the degraded reason it stands for. `signal` is the caller's, to tell a cancel from a timeout. */
export function classifyLlmFailure(error: unknown, signal?: AbortSignal): DirectionDegradedReason {
  if (error instanceof DirectionLlmError) {
    return error.reason;
  }
  if (error instanceof EgressDeniedError) {
    return "egress-denied";
  }
  if (isAbortLike(error)) {
    return wasAborted(signal) ? "cancelled" : "timeout";
  }
  return "provider-unavailable";
}

/**
 * Runs `call` under a deadline that does not depend on the model client
 * cooperating: the returned promise settles at `timeoutMs` (rejecting with
 * `DirectionLlmError("timeout")`) or when `signal` aborts (`"cancelled"`), even
 * if `call` never settles. `call` receives the signal to abort the request.
 */
export async function callWithDeadline<T>(
  call: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  if (wasAborted(signal)) {
    throw new DirectionLlmError("cancelled");
  }
  const timeout = withTimeout(signal, timeoutMs);
  const inner = timeout.controller.signal;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new DirectionLlmError(wasAborted(signal) ? "cancelled" : "timeout"));
    inner.addEventListener("abort", onAbort, { once: true });
  });
  // The race abandons `call` when it loses: a late rejection must not surface as unhandled.
  const running = call(inner);
  running.catch(() => undefined);
  try {
    return await Promise.race([running, aborted]);
  } catch (error) {
    throw error instanceof DirectionLlmError ? error : new DirectionLlmError(classifyLlmFailure(error, signal));
  } finally {
    if (onAbort !== undefined) {
      inner.removeEventListener("abort", onAbort);
    }
    timeout.cleanup();
  }
}
