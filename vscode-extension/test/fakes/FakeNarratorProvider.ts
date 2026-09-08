/**
 * Fake NarratorProvider (cahier-des-charges.md §20, §61, §78; src/core/narration.ts).
 *
 * By default maps each input segment 1:1, prefixing the spoken text with
 * "[narrated] " so tests can assert the narration step actually ran.
 * With `merge: true` it produces a single N:1 segment, exercising the
 * "N SourceSegments -> 1 NarrationSegment" relation from §61.
 *
 * Per ADR-005 / the `NarratorProvider.transform` contract, this fake never
 * rejects on a narration failure: an invalid structured-output response or
 * an aborted signal both resolve with `degraded: true` and a faithful
 * (un-rewritten) fallback, exactly like the real provider must. Only the
 * `mode dégradé obligatoire` path is exercised here — playback must never
 * be blocked by the narrator.
 */
import type {
  NarrationDegradedReason,
  NarrationRequest,
  NarrationResult,
  NarrationSegment,
  NarratorProvider,
  ProviderHealth
} from "../../src/core/index.js";
import { delay } from "./async-utils.js";

export interface FakeNarratorProviderOptions {
  /** Merge all input segments into a single NarrationSegment (N:1). */
  merge?: boolean;
  /** On the very first call, resolve with a degraded result simulating an
   *  invalid structured-output JSON response from the narrator LLM.
   *  Subsequent calls behave normally. */
  invalidJsonOnce?: boolean;
  /** Artificial latency (ms) applied before each response, abortable. */
  latencyMs?: number;
}

function textOf(segment: NarrationRequest["segments"][number]): string {
  return segment.spokenText ?? segment.rawText;
}

export class FakeNarratorProvider implements NarratorProvider {
  readonly id = "fake-narrator";

  /** Journal of every request received by transform(). */
  readonly requests: NarrationRequest[] = [];

  private readonly merge: boolean;
  private readonly latencyMs: number;
  private invalidJsonPending: boolean;

  constructor(options: FakeNarratorProviderOptions = {}) {
    this.merge = options.merge ?? false;
    this.latencyMs = options.latencyMs ?? 0;
    this.invalidJsonPending = options.invalidJsonOnce ?? false;
  }

  async health(): Promise<ProviderHealth> {
    return { providerId: this.id, status: "ok", checkedAt: Date.now() };
  }

  async transform(request: NarrationRequest, signal?: AbortSignal): Promise<NarrationResult> {
    this.requests.push(request);

    if (signal?.aborted) {
      return this.degraded(request, "cancelled");
    }

    try {
      await delay(this.latencyMs, signal);
    } catch {
      return this.degraded(request, "cancelled");
    }

    if (this.invalidJsonPending) {
      this.invalidJsonPending = false;
      return this.degraded(request, "invalid-structured-output");
    }

    if (this.merge) {
      return { segments: [this.mergeSegments(request)], degraded: false };
    }

    return { segments: this.narrateSegments(request), degraded: false };
  }

  private narrateSegments(request: NarrationRequest): NarrationSegment[] {
    return request.segments.map((segment) => ({
      id: `narrated-${segment.id}`,
      spokenText: `[narrated] ${textOf(segment)}`,
      sourceSegmentIds: [segment.id],
      sourceRanges: segment.sourceRange ? [segment.sourceRange] : []
    }));
  }

  private mergeSegments(request: NarrationRequest): NarrationSegment {
    const joinedText = request.segments.map((segment) => textOf(segment)).join(" ");
    return {
      id: "narrated-merged",
      spokenText: `[narrated] ${joinedText}`,
      sourceSegmentIds: request.segments.map((segment) => segment.id),
      sourceRanges: request.segments.flatMap((segment) => (segment.sourceRange ? [segment.sourceRange] : []))
    };
  }

  /** Faithful (un-rewritten) fallback, as the real contract requires on failure. */
  private degraded(request: NarrationRequest, reason: NarrationDegradedReason): NarrationResult {
    const segments: NarrationSegment[] = request.segments.map((segment) => ({
      id: `faithful-${segment.id}`,
      spokenText: textOf(segment),
      sourceSegmentIds: [segment.id],
      sourceRanges: segment.sourceRange ? [segment.sourceRange] : []
    }));
    return { segments, degraded: true, degradedReason: reason };
  }

  reset(): void {
    this.requests.length = 0;
  }
}
