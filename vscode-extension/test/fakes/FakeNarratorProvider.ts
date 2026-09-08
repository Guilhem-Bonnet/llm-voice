/**
 * Fake NarratorProvider (cahier-des-charges.md §20, §61, §78).
 *
 * By default maps each input segment 1:1, prefixing the spoken text with
 * "[narrated] " so tests can assert the narration step actually ran.
 * With `merge: true` it produces a single N:1 segment, exercising the
 * "N SourceSegments → 1 NarrationSegment" relation from §61.
 */
import { delay, throwIfAborted } from "./contracts.js";
import type { NarrationRequest, NarrationSegment, NarratorProvider, ProviderHealth } from "./contracts.js";

export interface FakeNarratorProviderOptions {
  /** Merge all input segments into a single NarrationSegment (N:1). */
  merge?: boolean;
  /** On the very first call, throw a SyntaxError simulating an invalid
   *  structured-output JSON response from the narrator LLM. Subsequent
   *  calls behave normally. */
  invalidJsonOnce?: boolean;
  /** Artificial latency (ms) applied before each response, abortable. */
  latencyMs?: number;
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
    return { ok: true };
  }

  async transform(request: NarrationRequest, signal?: AbortSignal): Promise<NarrationSegment[]> {
    throwIfAborted(signal);
    this.requests.push(request);

    await delay(this.latencyMs, signal);
    throwIfAborted(signal);

    if (this.invalidJsonPending) {
      this.invalidJsonPending = false;
      throw new SyntaxError("FakeNarratorProvider: simulated invalid JSON structured output");
    }

    if (this.merge) {
      return [this.mergeSegments(request)];
    }

    return request.segments.map((segment) => ({
      id: `narrated-${segment.id}`,
      spokenText: `[narrated] ${segment.text}`,
      sourceSegmentIds: [segment.id],
      sourceRanges: []
    }));
  }

  private mergeSegments(request: NarrationRequest): NarrationSegment {
    const joinedText = request.segments.map((segment) => segment.text).join(" ");
    return {
      id: "narrated-merged",
      spokenText: `[narrated] ${joinedText}`,
      sourceSegmentIds: request.segments.map((segment) => segment.id),
      sourceRanges: []
    };
  }

  reset(): void {
    this.requests.length = 0;
  }
}
