import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioChunk, TtsProvider, TtsRequest } from "../../../src/core/index.js";
import {
  AudioQueue,
  InMemoryAudioCache,
  computeBackoffDelay,
  computeCacheKey
} from "../../../src/playback/index.js";
import { FakeTtsProvider } from "../../fakes/FakeTtsProvider.js";
import { RecordingTtsProvider } from "./helpers.js";

describe("computeBackoffDelay (ADR-005's reported-to-phase-4 backoff)", () => {
  it("uses backoffMs[attempt - 1], clamped to the last configured step", () => {
    expect(computeBackoffDelay(1, [100, 400])).toBe(100);
    expect(computeBackoffDelay(2, [100, 400])).toBe(400);
    expect(computeBackoffDelay(3, [100, 400])).toBe(400); // clamps past the last step
  });

  it("returns 0 when no backoff steps are configured", () => {
    expect(computeBackoffDelay(1, [])).toBe(0);
  });

  it("adds up to jitterMs of extra delay, using the injected RNG", () => {
    expect(computeBackoffDelay(1, [100], 50, () => 0)).toBe(100);
    expect(computeBackoffDelay(1, [100], 50, () => 0.999999)).toBe(149);
  });

  it("adds no jitter when jitterMs is 0, regardless of the RNG", () => {
    expect(computeBackoffDelay(1, [100], 0, () => 0.9)).toBe(100);
  });
});

function chunks(count: number, text = (i: number) => `Texte ${i}.`): AudioChunk[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    sessionId: "s",
    spokenText: text(index),
    sourceRanges: [],
    status: "pending" as const
  }));
}

describe("AudioQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("synthesises the cursor chunk and exactly `prefetchChunks` ahead (CdC §32)", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ latencyMs: 10 }));
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache() });
    queue.reset(chunks(6));

    queue.setCursor(0);
    await vi.advanceTimersByTimeAsync(200);

    const statuses = queue.chunks.map((chunk) => chunk.status);
    expect(statuses.slice(0, 3)).toEqual(["ready", "ready", "ready"]);
    expect(statuses.slice(3)).toEqual(["pending", "pending", "pending"]);
    expect(tts.callCount).toBe(3);
  });

  it("never runs two syntheses at once (maxConcurrentTtsJobs = 1, CdC §65)", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ latencyMs: 25 }));
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache() });
    queue.reset(chunks(8));

    queue.setCursor(0);
    await vi.advanceTimersByTimeAsync(500);
    queue.setCursor(3);
    await vi.advanceTimersByTimeAsync(500);

    expect(tts.maxConcurrent).toBe(1);
    expect(queue.inFlight).toBe(0);
  });

  it("honours a raised concurrency budget while still bounding it", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ latencyMs: 25 }));
    const queue = new AudioQueue(
      { tts, cache: new InMemoryAudioCache() },
      { maxConcurrentTtsJobs: 2, prefetchChunks: 3 }
    );
    queue.reset(chunks(6));

    queue.setCursor(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(tts.maxConcurrent).toBe(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(tts.maxConcurrent).toBe(2);
  });

  it("serves a cache hit without calling the provider (CdC §37)", async () => {
    const cache = new InMemoryAudioCache();
    const key = computeCacheKey({
      providerId: "fake-tts",
      model: "m",
      voice: "v",
      parameters: {},
      spokenText: "Texte 1."
    });
    await cache.put(key, new Uint8Array([1, 2, 3, 4]));

    const tts = new RecordingTtsProvider(new FakeTtsProvider());
    const queue = new AudioQueue({
      tts,
      cache,
      binding: { model: "m", voice: "v", parameters: {} }
    });
    queue.reset(chunks(2));

    const first = await queue.waitFor(0);
    const second = await queue.waitFor(1);

    expect(second.status).toBe("ready");
    expect(second.audioUri).toBe(`memory://audio/${key}`);
    expect(first.status).toBe("ready");
    // Only chunk 0 was actually synthesised; chunk 1 came from the cache.
    expect(tts.texts).toEqual(["Texte 0."]);
  });

  it("reuses the audio of an identical spoken text across chunks", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider());
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache() });
    queue.reset(chunks(3, () => "Toujours la meme phrase."));

    await queue.waitFor(0);
    await queue.waitFor(1);
    await queue.waitFor(2);

    expect(tts.callCount).toBe(1);
    const uris = new Set(queue.chunks.map((chunk) => chunk.audioUri));
    expect(uris.size).toBe(1);
  });

  it("retries twice then marks the chunk as error", async () => {
    // failEveryNth: 1 makes every call fail.
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ failEveryNth: 1 }));
    // retryBackoffMs: 0 (D2 report note): keeps this test about retry *count*,
    // not the backoff schedule — that is `computeBackoffDelay`'s own suite.
    const queue = new AudioQueue(
      { tts, cache: new InMemoryAudioCache() },
      { retryBackoffMs: [0, 0], retryJitterMs: 0 }
    );
    queue.reset(chunks(1));

    const resultPromise = queue.waitFor(0);
    await vi.advanceTimersByTimeAsync(0);
    const chunk = await resultPromise;

    expect(chunk.status).toBe("error");
    expect(chunk.error).toContain("simulated failure");
    expect(tts.callCount).toBe(3); // first attempt + 2 retries
  });

  it("succeeds on a retry when the failure is transient", async () => {
    // failEveryNth: 2 fails the 2nd call only; chunk 0 succeeds first try,
    // chunk 1 fails once then succeeds.
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ failEveryNth: 2 }));
    const queue = new AudioQueue(
      { tts, cache: new InMemoryAudioCache() },
      { retryBackoffMs: [0, 0], retryJitterMs: 0 }
    );
    queue.reset(chunks(2));

    const firstPromise = queue.waitFor(0);
    await vi.advanceTimersByTimeAsync(0);
    expect((await firstPromise).status).toBe("ready");

    const secondPromise = queue.waitFor(1);
    await vi.advanceTimersByTimeAsync(0);
    expect((await secondPromise).status).toBe("ready");
    expect(tts.callCount).toBe(3);
  });

  it("aborts in-flight and pending jobs on cancelAll (CdC §62)", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ latencyMs: 50 }));
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache() });
    queue.reset(chunks(5));

    queue.setCursor(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(queue.inFlight).toBe(1);

    queue.cancelAll();
    await vi.advanceTimersByTimeAsync(200);

    expect(tts.signals.every((signal) => signal?.aborted === true)).toBe(true);
    expect(queue.inFlight).toBe(0);
    // A cancelled job is not a failed job: the chunk stays synthesisable.
    expect(queue.chunks.every((chunk) => chunk.status === "pending")).toBe(true);
    // And the queue does not restart itself behind the user's back.
    expect(tts.callCount).toBe(1);
  });

  it("resumes synthesis after a cancel when the cursor moves again", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ latencyMs: 20 }));
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache() });
    queue.reset(chunks(3));
    queue.setCursor(0);
    await vi.advanceTimersByTimeAsync(5);
    queue.cancelAll();
    await vi.advanceTimersByTimeAsync(50);

    queue.setCursor(0);
    await vi.advanceTimersByTimeAsync(200);

    expect(queue.chunks.every((chunk) => chunk.status === "ready")).toBe(true);
  });

  it("settles pending waiters when the queue is cancelled", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ latencyMs: 50 }));
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache() });
    queue.reset(chunks(2));

    const waiting = queue.waitFor(0);
    await vi.advanceTimersByTimeAsync(5);
    queue.cancelAll();

    const chunk = await waiting;
    expect(chunk.status).not.toBe("ready");
  });

  it("resolves immediately for a chunk the player already owns", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider());
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache() });
    queue.reset(chunks(1));
    const ready = await queue.waitFor(0);
    ready.status = "playing";

    await expect(queue.waitFor(0)).resolves.toBe(ready);
    expect(tts.callCount).toBe(1);
  });

  it("rejects a wait on an index that does not exist", async () => {
    const queue = new AudioQueue({
      tts: new FakeTtsProvider(),
      cache: new InMemoryAudioCache()
    });
    queue.reset(chunks(1));
    await expect(queue.waitFor(7)).rejects.toBeInstanceOf(RangeError);
  });

  it("appends chunks produced later and keeps synthesising", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider());
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache() });
    queue.reset(chunks(1));
    await queue.waitFor(0);

    queue.append(chunks(2).map((chunk, index) => ({ ...chunk, id: `later-${index}` })));
    await queue.waitFor(2);

    expect(queue.chunks).toHaveLength(3);
    expect(queue.chunks[2]?.status).toBe("ready");
  });

  it("forwards the whole binding to the synthesis request", async () => {
    const seen: TtsRequest[] = [];
    const recorder: TtsProvider = {
      id: "fake-tts",
      async health() {
        return { providerId: "fake-tts", status: "ok" as const, checkedAt: 0 };
      },
      async getCapabilities() {
        return {
          streaming: false,
          voices: [],
          parameters: [],
          formats: ["wav" as const],
          languages: ["fr"]
        };
      },
      async synthesize(request: TtsRequest) {
        seen.push(request);
        return { format: "wav" as const, data: new Uint8Array([1]), durationMs: 100 };
      }
    };
    const queue = new AudioQueue({
      tts: recorder,
      cache: new InMemoryAudioCache(),
      binding: {
        providerId: "custom",
        model: "m",
        voice: "v",
        language: "fr",
        speed: 1.25,
        format: "mp3",
        parameters: { pitch: 2 }
      }
    });
    queue.reset(chunks(1));
    await queue.waitFor(0);

    expect(seen[0]).toEqual({
      text: "Texte 0.",
      language: "fr",
      voice: "v",
      model: "m",
      speed: 1.25,
      format: "mp3",
      parameters: { pitch: 2 }
    });
  });

  it("discards the audio of a provider that resolved after a cancellation", async () => {
    // A provider that ignores its AbortSignal is the realistic bad citizen:
    // the queue must still not publish audio the user cancelled.
    const signalDeaf = {
      id: "deaf",
      async health() {
        return { providerId: "deaf", status: "ok" as const, checkedAt: 0 };
      },
      async getCapabilities() {
        return {
          streaming: false,
          voices: [],
          parameters: [],
          formats: ["wav" as const],
          languages: ["fr"]
        };
      },
      synthesize: () =>
        new Promise<{ format: "wav"; data: Uint8Array }>((resolve) => {
          setTimeout(() => resolve({ format: "wav", data: new Uint8Array([1]) }), 40);
        })
    };
    const queue = new AudioQueue({ tts: signalDeaf, cache: new InMemoryAudioCache() });
    queue.reset(chunks(1));

    queue.setCursor(0);
    await vi.advanceTimersByTimeAsync(10);
    queue.cancelAll();
    await vi.advanceTimersByTimeAsync(100);

    expect(queue.chunks[0]?.status).toBe("pending");
    expect(queue.chunks[0]?.audioUri).toBeUndefined();
  });

  it("ignores an empty append and refuses work once disposed", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider());
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache() });
    queue.reset(chunks(2));
    queue.append([]);
    expect(queue.chunks).toHaveLength(2);

    queue.dispose();
    queue.dispose(); // idempotent
    queue.append(chunks(1));
    queue.setCursor(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(tts.callCount).toBe(0);
  });

  it("waits the configured backoff (100 ms, then 400 ms) between retries", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ failEveryNth: 1 }));
    const queue = new AudioQueue(
      { tts, cache: new InMemoryAudioCache() },
      { retryBackoffMs: [100, 400], retryJitterMs: 0 }
    );
    queue.reset(chunks(1));

    const resultPromise = queue.waitFor(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(tts.callCount).toBe(1); // first attempt, failed — now waiting 100 ms

    await vi.advanceTimersByTimeAsync(99);
    expect(tts.callCount).toBe(1); // still backing off
    await vi.advanceTimersByTimeAsync(1);
    expect(tts.callCount).toBe(2); // retry 1 fired, failed — now waiting 400 ms

    await vi.advanceTimersByTimeAsync(399);
    expect(tts.callCount).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tts.callCount).toBe(3); // retry 2 fired, failed — maxRetries exhausted

    const chunk = await resultPromise;
    expect(chunk.status).toBe("error");
  });

  it("pins the chunk in playback and the prefetched window; unpins once the cursor moves past them", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ latencyMs: 10 }));
    const cache = new InMemoryAudioCache();
    const queue = new AudioQueue({ tts, cache }, { prefetchChunks: 1 });
    queue.reset(chunks(4));

    queue.setCursor(0);
    await vi.advanceTimersByTimeAsync(50);

    const keyFor = (index: number) =>
      computeCacheKey({ providerId: tts.id, spokenText: `Texte ${index}.` });
    expect(cache.isPinned(keyFor(0))).toBe(true);
    expect(cache.isPinned(keyFor(1))).toBe(true);
    expect(cache.isPinned(keyFor(2))).toBe(false);

    queue.setCursor(2);
    await vi.advanceTimersByTimeAsync(50);

    // The cursor moved past chunk 0 and 1: their keys are unpinned, the new
    // window (2, 3) is pinned instead.
    expect(cache.isPinned(keyFor(0))).toBe(false);
    expect(cache.isPinned(keyFor(1))).toBe(false);
    expect(cache.isPinned(keyFor(2))).toBe(true);
    expect(cache.isPinned(keyFor(3))).toBe(true);
  });

  it("unpins every remaining key on reset() and dispose()", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ latencyMs: 10 }));
    const cache = new InMemoryAudioCache();
    const queue = new AudioQueue({ tts, cache });
    queue.reset(chunks(2));
    queue.setCursor(0);
    await vi.advanceTimersByTimeAsync(50);

    const key = computeCacheKey({ providerId: tts.id, spokenText: "Texte 0." });
    expect(cache.isPinned(key)).toBe(true);

    queue.dispose();
    expect(cache.isPinned(key)).toBe(false);
  });
});
