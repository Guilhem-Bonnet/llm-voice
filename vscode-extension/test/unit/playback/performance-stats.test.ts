import { describe, expect, it } from "vitest";
import { PerformanceStats } from "../../../src/playback/PerformanceStats.js";
import type { ChunkTimingEvent } from "../../../src/playback/AudioQueue.js";

function timing(overrides: Partial<ChunkTimingEvent> = {}): ChunkTimingEvent {
  return { index: 0, cacheHit: false, ready: true, queueSize: 1, ...overrides };
}

describe("PerformanceStats (S6.2, LLM Voice: Show Performance Report)", () => {
  it("starts with an empty snapshot", () => {
    const stats = new PerformanceStats();
    expect(stats.snapshot()).toEqual({ chunkCount: 0, cacheHits: 0, cacheMisses: 0, errors: 0 });
  });

  it("records ttfaMs once set", () => {
    const stats = new PerformanceStats();
    stats.recordTtfa(1234);
    expect(stats.snapshot().ttfaMs).toBe(1234);
  });

  it("counts cache hits, misses and errors separately", () => {
    const stats = new PerformanceStats();
    stats.recordChunk(timing({ index: 0, cacheHit: true }));
    stats.recordChunk(timing({ index: 1, cacheHit: false, synthesisMs: 100 }));
    stats.recordChunk(timing({ index: 2, ready: false }));

    const snap = stats.snapshot();
    expect(snap.chunkCount).toBe(3);
    expect(snap.cacheHits).toBe(1);
    expect(snap.cacheMisses).toBe(1);
    expect(snap.errors).toBe(1);
  });

  it("averages synthesisMs over cache misses only", () => {
    const stats = new PerformanceStats();
    stats.recordChunk(timing({ cacheHit: true }));
    stats.recordChunk(timing({ cacheHit: false, synthesisMs: 100 }));
    stats.recordChunk(timing({ cacheHit: false, synthesisMs: 300 }));

    expect(stats.snapshot().avgSynthesisMs).toBe(200);
  });

  it("leaves avgSynthesisMs undefined when every chunk so far was a cache hit", () => {
    const stats = new PerformanceStats();
    stats.recordChunk(timing({ cacheHit: true }));
    expect(stats.snapshot().avgSynthesisMs).toBeUndefined();
  });

  it("tracks the queue size of the last event", () => {
    const stats = new PerformanceStats();
    stats.recordChunk(timing({ queueSize: 5 }));
    stats.recordChunk(timing({ queueSize: 3 }));
    expect(stats.snapshot().lastQueueSize).toBe(3);
  });

  it("reset() clears every counter, including ttfaMs", () => {
    const stats = new PerformanceStats();
    stats.recordTtfa(500);
    stats.recordChunk(timing({ cacheHit: true }));
    stats.reset();
    expect(stats.snapshot()).toEqual({ chunkCount: 0, cacheHits: 0, cacheMisses: 0, errors: 0 });
  });
});
