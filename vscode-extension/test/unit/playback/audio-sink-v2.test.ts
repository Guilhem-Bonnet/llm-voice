/**
 * `AudioSink` v2 (ADR-012 §3, carte GAO-contrat-audi-001): preloading,
 * absolute position, `underrun`, drain-aware `ended`.
 *
 * The controller half runs `PlaybackController` against `FakeAudioSink`, which
 * models a gapless native engine; the adapter half checks that
 * `SequencedAudioSink` gives the webview fallback the same event sequence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Emitter,
  InMemoryAudioCache,
  PlaybackController,
  SequencedAudioSink,
  type AudioSinkChunk,
  type AudioSinkEvent,
  type ChunkChange,
  type LegacyAudioSink,
  type LegacyAudioSinkEvent,
  type LegacyAudioSinkEventMap,
  type PlaybackProgress,
  type PlaybackUnderrun,
  type Unsubscribe
} from "../../../src/playback/index.js";
import { FakeAudioSink } from "../../fakes/FakeAudioSink.js";
import { FakeTtsProvider } from "../../fakes/FakeTtsProvider.js";
import { RecordingTtsProvider, makeProfile, makeSegments } from "./helpers.js";

/** 3 words * 1000 ms/word = 3000 ms per chunk. */
const CHUNK_MS = 3000;
const id = (index: number): string => `session-1:${index}`;

function harness(options: { ttsLatencyMs?: number } = {}) {
  const sink = new FakeAudioSink({ tickMs: 250 });
  const tts = new RecordingTtsProvider(
    new FakeTtsProvider({
      msPerWord: 1000,
      ...(options.ttsLatencyMs !== undefined ? { latencyMs: options.ttsLatencyMs } : {})
    }),
    []
  );
  const controller = new PlaybackController({
    cache: new InMemoryAudioCache(),
    retryBackoffMs: [0, 0],
    retryJitterMs: 0
  });
  const progress: PlaybackProgress[] = [];
  const chunkChanges: ChunkChange[] = [];
  const underruns: PlaybackUnderrun[] = [];
  controller.onProgress((value) => progress.push(value));
  controller.onChunkChange((change) => chunkChanges.push(change));
  controller.onUnderrun((value) => underruns.push(value));
  return {
    sink,
    tts,
    controller,
    progress,
    chunkChanges,
    underruns,
    /** Starts a session; resolves once chunk 0 plays (50 ms of fake time). */
    async start(count: number, sealed = true): Promise<void> {
      const started = controller.start({
        segments: makeSegments(count),
        profile: makeProfile(),
        tts,
        sink,
        sealed
      });
      await vi.advanceTimersByTimeAsync(50);
      await started;
    },
    /** Same, for a slow TTS: waits `ms` before resolving. */
    async startSlow(count: number, ms: number): Promise<void> {
      const started = controller.start({
        segments: makeSegments(count),
        profile: makeProfile(),
        tts,
        sink
      });
      await vi.advanceTimersByTimeAsync(ms);
      await started;
    }
  };
}

/** Positions must never go backwards, except when moving to a later chunk. */
function expectMonotone(progress: readonly PlaybackProgress[]): void {
  for (let i = 1; i < progress.length; i++) {
    const before = progress[i - 1];
    const after = progress[i];
    if (before === undefined || after === undefined) {
      continue;
    }
    expect(after.index).toBeGreaterThanOrEqual(before.index);
    if (after.index === before.index) {
      expect(after.positionMs).toBeGreaterThanOrEqual(before.positionMs);
    }
  }
}

describe("PlaybackController × AudioSink v2 — preloading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("chains two ready chunks with no ended→load round trip", async () => {
    const h = harness();
    await h.start(3);
    await vi.advanceTimersByTimeAsync(CHUNK_MS * 3);

    const timeline = h.sink.timeline;
    expect(h.controller.getState()).toBe("completed");
    expect(timeline.filter((entry) => entry.startsWith("load:"))).toEqual([`load:${id(0)}`]);
    for (const index of [0, 1]) {
      const ended = timeline.indexOf(`ended:${id(index)}`);
      // The successor was enqueued while its predecessor was still playing…
      expect(timeline.indexOf(`enqueue:${id(index + 1)}`)).toBeLessThan(ended);
      // …and started right after it ended: no command in between.
      expect(timeline[ended + 1]).toBe(`started:${id(index + 1)}`);
    }
    expect(h.chunkChanges.map((change) => change.index)).toEqual([0, 1, 2]);
    expect(h.controller.getChunks().map((chunk) => chunk.status)).toEqual([
      "played",
      "played",
      "played"
    ]);
  });

  it("hands over in the very tick the previous chunk ends (no gap in sink time)", async () => {
    const h = harness();
    await h.start(2); // playback began at t = 0; now t = 50
    await vi.advanceTimersByTimeAsync(CHUNK_MS - 50 - 1);
    expect(h.controller.getCurrentIndex()).toBe(0);

    await vi.advanceTimersByTimeAsync(1); // t = 3000: chunk 0 drained
    expect(h.controller.getCurrentIndex()).toBe(1);
    expect(h.controller.getState()).toBe("playing");
    expect(h.sink.currentChunkId).toBe(id(1));
    expect(h.sink.isStarved).toBe(false);
  });

  it("reports a monotone absolute position, across chunks and a pause", async () => {
    const h = harness();
    await h.start(3);
    await vi.advanceTimersByTimeAsync(1100);
    h.controller.pause();
    await vi.advanceTimersByTimeAsync(2000);
    h.controller.resume();
    await vi.advanceTimersByTimeAsync(CHUNK_MS * 3);

    expect(h.progress.length).toBeGreaterThan(20);
    expectMonotone(h.progress);
    expect(new Set(h.progress.map((value) => value.index))).toEqual(new Set([0, 1, 2]));
    // The last report of each chunk is its full duration: nothing was cut.
    for (const index of [0, 1, 2]) {
      const last = h.progress.filter((value) => value.index === index).at(-1);
      expect(last?.positionMs).toBe(CHUNK_MS);
    }
  });

  it("pause and resume keep the exact position, without reload or seek", async () => {
    const h = harness();
    await h.start(3);
    await vi.advanceTimersByTimeAsync(1234); // t = 1284, between two ticks

    h.controller.pause();
    expect(h.controller.getPositionMs()).toBe(1284);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.controller.getPositionMs()).toBe(1284);
    expect(h.sink.positionMsNow).toBe(1284);

    h.controller.resume();
    await vi.advanceTimersByTimeAsync(250);
    expect(h.controller.getPositionMs()).toBe(1534);
    expect(h.sink.loads).toHaveLength(1);
    expect(h.sink.commands.some((command) => command.startsWith("seek:"))).toBe(false);
  });

  it("pausing while the successor is enqueued keeps it: resume still chains without load", async () => {
    const h = harness();
    await h.start(2);
    await vi.advanceTimersByTimeAsync(CHUNK_MS - 300);
    expect(h.sink.pendingChunkIds).toEqual([id(1)]);

    h.controller.pause();
    await vi.advanceTimersByTimeAsync(5000);
    h.controller.resume();
    await vi.advanceTimersByTimeAsync(500);

    expect(h.controller.getCurrentIndex()).toBe(1);
    expect(h.sink.loads).toHaveLength(1);
  });

  it("signals an underrun when the next chunk is not ready, then falls back to load", async () => {
    // Synthesis (4000 ms/chunk) outlasts playback (3000 ms/chunk).
    const h = harness({ ttsLatencyMs: 4000 });
    await h.startSlow(3, 4000); // chunk 0 plays from t = 4000
    await vi.advanceTimersByTimeAsync(CHUNK_MS); // t = 7000: chunk 0 ends, chunk 1 generating

    expect(h.controller.getState()).toBe("buffering");
    expect(h.underruns).toEqual([{ index: 1, chunkId: id(0), positionMs: CHUNK_MS }]);
    expect(h.sink.timeline).toContain(`underrun:${id(0)}`);
    expect(h.sink.isStarved).toBe(true);

    await vi.advanceTimersByTimeAsync(1000); // t = 8000: chunk 1 ready
    expect(h.controller.getState()).toBe("playing");
    expect(h.controller.getCurrentIndex()).toBe(1);
    const timeline = h.sink.timeline;
    expect(timeline.indexOf(`load:${id(1)}`)).toBeGreaterThan(
      timeline.indexOf(`underrun:${id(0)}`)
    );
  });

  it("does not report an underrun at the end of a sealed session", async () => {
    const h = harness();
    await h.start(2);
    await vi.advanceTimersByTimeAsync(CHUNK_MS * 3);
    expect(h.controller.getState()).toBe("completed");
    expect(h.underruns).toEqual([]);
    expect(h.sink.timeline.some((entry) => entry.startsWith("underrun:"))).toBe(false);
  });

  it("preloads a segment appended while the last known chunk plays (CdC §63)", async () => {
    const h = harness();
    await h.start(1, false);
    h.controller.appendSegments(makeSegments(1, "late"));
    await vi.advanceTimersByTimeAsync(100);
    expect(h.sink.pendingChunkIds).toEqual([id(1)]);

    await vi.advanceTimersByTimeAsync(CHUNK_MS);
    expect(h.controller.getCurrentIndex()).toBe(1);
    expect(h.sink.loads).toHaveLength(1);
  });

  it("drops the preloaded chunk on next(): the sink queue is cleared, the target loaded", async () => {
    const h = harness();
    await h.start(4);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.sink.pendingChunkIds).toEqual([id(1)]);

    await h.controller.next();
    const timeline = h.sink.timeline;
    expect(timeline.indexOf("clearQueue")).toBeLessThan(timeline.indexOf(`load:${id(1)}`));
    expect(h.controller.getCurrentIndex()).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    // The new current chunk gets its own successor preloaded.
    expect(h.sink.pendingChunkIds).toEqual([id(2)]);
  });

  it("stop drops the preloaded chunk with the rest", async () => {
    const h = harness();
    await h.start(3);
    await vi.advanceTimersByTimeAsync(100);
    h.controller.stop();
    expect(h.sink.pendingChunkIds).toEqual([]);
    expect(h.sink.currentChunkId).toBeUndefined();
  });

  it("retries through load() a preloaded chunk the sink refused before its turn", async () => {
    const h = harness();
    await h.start(2);
    await vi.advanceTimersByTimeAsync(100);
    h.sink.failEnqueued("decode error");
    await vi.advanceTimersByTimeAsync(CHUNK_MS);

    expect(h.controller.getCurrentIndex()).toBe(1);
    expect(h.controller.getState()).toBe("playing");
    expect(h.sink.loads.map((load) => load.chunkId)).toEqual([id(0), id(1)]);
  });
});

/** Minimal v1 engine: one source at a time, events driven by the test. */
class FakeLegacySink implements LegacyAudioSink {
  readonly journal: string[] = [];
  private readonly emitters: {
    [E in LegacyAudioSinkEvent]: Emitter<LegacyAudioSinkEventMap[E]>;
  } = { timeupdate: new Emitter(), ended: new Emitter(), error: new Emitter() };

  async load(chunk: AudioSinkChunk): Promise<void> {
    this.journal.push(`load:${chunk.chunkId}`);
  }
  play(): void {
    this.journal.push("play");
  }
  pause(): void {
    this.journal.push("pause");
  }
  stop(): void {
    this.journal.push("stop");
  }
  seek(positionMs: number): void {
    this.journal.push(`seek:${positionMs}`);
  }
  on<E extends LegacyAudioSinkEvent>(
    event: E,
    handler: (payload: LegacyAudioSinkEventMap[E]) => void
  ): Unsubscribe {
    return (this.emitters[event] as Emitter<LegacyAudioSinkEventMap[E]>).on(handler);
  }
  fire<E extends LegacyAudioSinkEvent>(event: E, payload: LegacyAudioSinkEventMap[E]): void {
    (this.emitters[event] as Emitter<LegacyAudioSinkEventMap[E]>).emit(payload);
  }
}

function adapter() {
  const inner = new FakeLegacySink();
  const sink = new SequencedAudioSink(inner);
  const events: string[] = [];
  for (const event of ["started", "ended", "underrun", "error"] as AudioSinkEvent[]) {
    sink.on(event, (payload) => events.push(`${event}:${payload.chunkId}`));
  }
  return { inner, sink, events };
}

const chunk = (chunkId: string, durationMs = 1000): AudioSinkChunk => ({
  chunkId,
  src: `/cache/${chunkId}.wav`,
  durationMs
});

describe("SequencedAudioSink — v2 over a v1 engine (webview fallback)", () => {
  it("declares itself not gapless", () => {
    expect(adapter().sink.gapless).toBe(false);
  });

  it("chains an enqueued chunk after `ended` by itself: ended, then started", async () => {
    const { inner, sink, events } = adapter();
    await sink.load(chunk("a"));
    sink.play();
    await sink.enqueue(chunk("b"));
    expect(inner.journal).toEqual(["load:a", "play"]);

    inner.fire("ended", { chunkId: "a" });
    await Promise.resolve();

    expect(events).toEqual(["started:a", "ended:a", "started:b"]);
    expect(inner.journal).toEqual(["load:a", "play", "load:b", "play"]);
  });

  it("reports an underrun when nothing is enqueued, then starts a late chunk at once", async () => {
    const { inner, sink, events } = adapter();
    await sink.load(chunk("a", 1200));
    sink.play();
    inner.fire("ended", { chunkId: "a" });
    expect(events).toEqual(["started:a", "ended:a", "underrun:a"]);

    await sink.enqueue(chunk("b"));
    expect(events.at(-1)).toBe("started:b");
    expect(inner.journal.slice(-2)).toEqual(["load:b", "play"]);
  });

  it("load(), stop() and clearQueue() drop the enqueued chunks", async () => {
    for (const drop of [
      (s: SequencedAudioSink) => s.load(chunk("c")),
      (s: SequencedAudioSink) => s.stop(),
      (s: SequencedAudioSink) => s.clearQueue()
    ]) {
      const { inner, sink, events } = adapter();
      await sink.load(chunk("a"));
      sink.play();
      await sink.enqueue(chunk("b"));
      await drop(sink);
      inner.fire("ended", { chunkId: "a" });
      await Promise.resolve();
      expect(events).not.toContain("started:b");
      expect(inner.journal).not.toContain("load:b");
    }
  });

  it("relays timeupdate and repeats the last position on pause", async () => {
    const { inner, sink } = adapter();
    const ticks: number[] = [];
    sink.on("timeupdate", (payload) => ticks.push(payload.positionMs));
    await sink.load(chunk("a"));
    sink.play();
    inner.fire("timeupdate", { chunkId: "a", positionMs: 500 });
    sink.pause();
    expect(ticks).toEqual([500, 500]);
  });

  it("lets PlaybackController chain ready chunks without calling load() again", async () => {
    vi.useFakeTimers();
    try {
      const inner = new FakeLegacySink();
      const sink = new SequencedAudioSink(inner);
      const load = vi.spyOn(sink, "load");
      const controller = new PlaybackController({ cache: new InMemoryAudioCache() });
      const started = controller.start({
        segments: makeSegments(2),
        profile: makeProfile(),
        tts: new FakeTtsProvider({ msPerWord: 1000 }),
        sink
      });
      await vi.advanceTimersByTimeAsync(50);
      await started;

      inner.fire("ended", { chunkId: id(0) });
      await vi.advanceTimersByTimeAsync(0);

      expect(controller.getCurrentIndex()).toBe(1);
      expect(load).toHaveBeenCalledTimes(1);
      expect(inner.journal.filter((entry) => entry.startsWith("load:"))).toEqual([
        `load:${id(0)}`,
        `load:${id(1)}`
      ]);
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
