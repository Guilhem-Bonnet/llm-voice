/**
 * `PerformanceStats` (S6.2): the in-memory session counters behind `LLM
 * Voice: Show Performance Report` and the debug-level instrumentation logs
 * (CdC §63's "la lecture doit commencer dès que le premier chunk est
 * disponible" — this is what makes that measurable instead of anecdotal).
 *
 * Deliberately free of any `vscode` import (same discipline as
 * `src/playback/AudioQueue.ts`): `Pipeline` is the only caller, and it is
 * what turns a `snapshot()` into a Quick Pick / a `Logger.debug` line. Only
 * ever holds numbers and counts — never `spokenText` or audio (CdC §81).
 */

import type { ChunkTimingEvent } from "./AudioQueue.js";

/** What `LLM Voice: Show Performance Report` reads (S6.2). */
export interface PerformanceSnapshot {
  /** Time-to-first-audio of the current session, ms — `undefined` before the first chunk starts playing. */
  ttfaMs?: number;
  /** Chunks that reached `ready` or `error` so far this session. */
  chunkCount: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  /** Mean `synthesisMs` over every cache-miss chunk; `undefined` when every chunk so far was a cache hit. */
  avgSynthesisMs?: number;
  /** `AudioQueue.chunks.length` as of the last timing event. */
  lastQueueSize?: number;
}

export class PerformanceStats {
  private ttfaMs: number | undefined;
  private chunkCount = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private errors = 0;
  private synthesisTotalMs = 0;
  private synthesisSamples = 0;
  private lastQueueSize: number | undefined;

  /** Starts a fresh session's counters (called by `Pipeline` at every `start()`). */
  reset(): void {
    this.ttfaMs = undefined;
    this.chunkCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.errors = 0;
    this.synthesisTotalMs = 0;
    this.synthesisSamples = 0;
    this.lastQueueSize = undefined;
  }

  /** Records the current session's time-to-first-audio, once. */
  recordTtfa(ms: number): void {
    this.ttfaMs = ms;
  }

  /** Folds one `AudioQueue.onChunkTiming` sample into the running counters. */
  recordChunk(event: ChunkTimingEvent): void {
    this.chunkCount += 1;
    this.lastQueueSize = event.queueSize;
    if (!event.ready) {
      this.errors += 1;
      return;
    }
    if (event.cacheHit) {
      this.cacheHits += 1;
      return;
    }
    this.cacheMisses += 1;
    if (event.synthesisMs !== undefined) {
      this.synthesisTotalMs += event.synthesisMs;
      this.synthesisSamples += 1;
    }
  }

  snapshot(): PerformanceSnapshot {
    return {
      ...(this.ttfaMs !== undefined ? { ttfaMs: this.ttfaMs } : {}),
      chunkCount: this.chunkCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      errors: this.errors,
      ...(this.synthesisSamples > 0
        ? { avgSynthesisMs: Math.round(this.synthesisTotalMs / this.synthesisSamples) }
        : {}),
      ...(this.lastQueueSize !== undefined ? { lastQueueSize: this.lastQueueSize } : {})
    };
  }
}
