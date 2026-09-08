import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaybackState } from "../../../src/core/index.js";
import {
  InMemoryAudioCache,
  PlaybackController,
  type ChunkChange,
  type PlaybackErrorInfo,
  type PlaybackProgress
} from "../../../src/playback/index.js";
import { FakeAudioSink } from "../../fakes/FakeAudioSink.js";
import { FakeTtsProvider } from "../../fakes/FakeTtsProvider.js";
import { RecordingTtsProvider, makeProfile, makeSegments } from "./helpers.js";

/** 3 words * 1000 ms/word = 3000 ms per chunk, i.e. 12 sink ticks of 250 ms. */
const CHUNK_MS = 3000;

interface Harness {
  controller: PlaybackController;
  sink: FakeAudioSink;
  tts: RecordingTtsProvider;
  states: PlaybackState[];
  chunkChanges: ChunkChange[];
  progress: PlaybackProgress[];
  errors: PlaybackErrorInfo[];
  start(segmentCount: number, sealed?: boolean): Promise<void>;
}

function harness(
  options: {
    ttsLatencyMs?: number;
    failEveryNth?: number;
    failTexts?: readonly string[];
    onChunkError?: () => "skip" | "stop";
    prefetchChunks?: number;
  } = {}
): Harness {
  const sink = new FakeAudioSink({ tickMs: 250 });
  const tts = new RecordingTtsProvider(
    new FakeTtsProvider({
      msPerWord: 1000,
      ...(options.ttsLatencyMs !== undefined ? { latencyMs: options.ttsLatencyMs } : {}),
      ...(options.failEveryNth !== undefined ? { failEveryNth: options.failEveryNth } : {})
    }),
    options.failTexts ?? []
  );
  const controller = new PlaybackController({
    cache: new InMemoryAudioCache(),
    ...(options.onChunkError !== undefined ? { onChunkError: options.onChunkError } : {}),
    ...(options.prefetchChunks !== undefined
      ? { prefetchChunks: options.prefetchChunks }
      : {})
  });

  const states: PlaybackState[] = [];
  const chunkChanges: ChunkChange[] = [];
  const progress: PlaybackProgress[] = [];
  const errors: PlaybackErrorInfo[] = [];
  controller.onStateChange((change) => states.push(change.state));
  controller.onChunkChange((change) => chunkChanges.push(change));
  controller.onProgress((value) => progress.push(value));
  controller.onError((info) => errors.push(info));

  return {
    controller,
    sink,
    tts,
    states,
    chunkChanges,
    progress,
    errors,
    async start(segmentCount: number, sealed = true): Promise<void> {
      const started = controller.start({
        segments: makeSegments(segmentCount),
        profile: makeProfile(),
        tts,
        sink,
        sealed
      });
      await vi.advanceTimersByTimeAsync(50);
      await started;
    }
  };
}

describe("PlaybackController — state machine (CdC §34)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts idle", () => {
    expect(new PlaybackController().getState()).toBe("idle");
  });

  it("walks idle → preparing → playing on start", async () => {
    const h = harness();
    await h.start(2);
    expect(h.states).toEqual(["preparing", "playing"]);
    expect(h.controller.getState()).toBe("playing");
  });

  const transitions: Array<{
    name: string;
    from: PlaybackState;
    act: (h: Harness) => Promise<void> | void;
    to: PlaybackState;
  }> = [
    {
      name: "playing → paused on pause",
      from: "playing",
      act: (h) => h.controller.pause(),
      to: "paused"
    },
    {
      name: "paused → playing on resume",
      from: "playing",
      act: (h) => {
        h.controller.pause();
        h.controller.resume();
      },
      to: "playing"
    },
    {
      name: "playing → stopped on stop",
      from: "playing",
      act: (h) => h.controller.stop(),
      to: "stopped"
    },
    {
      name: "paused → stopped on stop",
      from: "playing",
      act: (h) => {
        h.controller.pause();
        h.controller.stop();
      },
      to: "stopped"
    },
    {
      name: "playing → completed when the last chunk ends",
      from: "playing",
      act: async () => {
        await vi.advanceTimersByTimeAsync(CHUNK_MS * 3);
      },
      to: "completed"
    },
    {
      name: "playing → completed on next() from the last chunk",
      from: "playing",
      act: async (h) => {
        await h.controller.next();
        await h.controller.next();
        await h.controller.next();
      },
      to: "completed"
    }
  ];

  for (const transition of transitions) {
    it(transition.name, async () => {
      const h = harness();
      await h.start(3);
      expect(h.controller.getState()).toBe(transition.from);
      await transition.act(h);
      expect(h.controller.getState()).toBe(transition.to);
    });
  }

  it("ignores pause and resume outside their source state", async () => {
    const h = harness();
    await h.start(2);
    h.controller.resume(); // already playing
    expect(h.controller.getState()).toBe("playing");
    h.controller.pause();
    h.controller.pause(); // already paused
    expect(h.controller.getState()).toBe("paused");
  });

  it("ignores every control before a session exists", async () => {
    const controller = new PlaybackController();
    controller.pause();
    controller.resume();
    controller.stop();
    await controller.next();
    await controller.previous();
    controller.appendSegments(makeSegments(1));
    controller.sealSegments();
    expect(controller.getState()).toBe("idle");
    expect(controller.getChunks()).toEqual([]);
  });

  it("completes immediately on an empty sealed session", async () => {
    const h = harness();
    await h.start(0);
    expect(h.controller.getState()).toBe("completed");
  });
});

describe("PlaybackController — playback flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads and plays chunks strictly in order, one at a time (ADR-001)", async () => {
    const h = harness();
    await h.start(3);
    await vi.advanceTimersByTimeAsync(CHUNK_MS * 3);

    expect(h.sink.loads.map((load) => load.chunkId)).toEqual([
      "session-1:0",
      "session-1:1",
      "session-1:2"
    ]);
    // One `play` per chunk: two chunks are never playing at the same time.
    expect(h.sink.commands.filter((command) => command === "play")).toHaveLength(3);
    expect(h.chunkChanges.map((change) => change.index)).toEqual([0, 1, 2]);
    expect(h.controller.getState()).toBe("completed");
  });

  it("emits the source ranges of the chunk being played, for the highlight", async () => {
    const h = harness();
    await h.start(2);
    expect(h.chunkChanges[0]?.sourceRanges).toEqual([
      { startLine: 0, startColumn: 0, endLine: 0, endColumn: 10 }
    ]);
  });

  it("reports progress with index, total and duration", async () => {
    const h = harness();
    await h.start(2);
    await vi.advanceTimersByTimeAsync(500);

    expect(h.progress[0]).toEqual({
      positionMs: 250,
      durationMs: CHUNK_MS,
      index: 0,
      total: 2
    });
  });

  it("prefetches exactly two chunks ahead while the first one plays (CdC §32)", async () => {
    const h = harness({ ttsLatencyMs: 5 });
    await h.start(6);
    await vi.advanceTimersByTimeAsync(100);

    const statuses = h.controller.getChunks().map((chunk) => chunk.status);
    expect(statuses[0]).toBe("playing");
    expect(statuses.slice(1, 3)).toEqual(["ready", "ready"]);
    expect(statuses.slice(3)).toEqual(["pending", "pending", "pending"]);
  });

  it("never issues two concurrent syntheses (CdC §65)", async () => {
    const h = harness({ ttsLatencyMs: 20 });
    await h.start(6);
    await vi.advanceTimersByTimeAsync(CHUNK_MS * 6);
    expect(h.tts.maxConcurrent).toBe(1);
  });
});

describe("PlaybackController — pause, stop, next, previous", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pause keeps the index, the position and the prefetched chunks (CdC §35)", async () => {
    const h = harness();
    await h.start(4);
    await vi.advanceTimersByTimeAsync(750);

    const prefetched = h.controller
      .getChunks()
      .map((chunk) => chunk.status)
      .join(",");
    h.controller.pause();
    await vi.advanceTimersByTimeAsync(5000);

    expect(h.controller.getPositionMs()).toBe(750);
    expect(h.controller.getCurrentIndex()).toBe(0);
    expect(h.sink.positionMsNow).toBe(750);
    expect(h.controller.getChunks().map((chunk) => chunk.status).join(",")).toBe(
      prefetched
    );
    expect(h.sink.loads).toHaveLength(1);
  });

  it("resume continues the same chunk from where it stopped", async () => {
    const h = harness();
    await h.start(2);
    await vi.advanceTimersByTimeAsync(750);
    h.controller.pause();
    h.controller.resume();
    await vi.advanceTimersByTimeAsync(250);

    expect(h.controller.getPositionMs()).toBe(1000);
    expect(h.sink.loads).toHaveLength(1);
    expect(h.controller.getCurrentIndex()).toBe(0);
  });

  it("stop rewinds, aborts the pending synthesis and keeps the cache (CdC §36, §62)", async () => {
    const h = harness({ ttsLatencyMs: 100 });
    const started = h.controller.start({
      segments: makeSegments(5),
      profile: makeProfile(),
      tts: h.tts,
      sink: h.sink
    });
    await vi.advanceTimersByTimeAsync(150);
    await started;
    expect(h.controller.getState()).toBe("playing");

    h.controller.stop();

    expect(h.tts.signals[0]?.aborted).toBe(false);
    expect(h.tts.signals.some((signal) => signal?.aborted === true)).toBe(true);
    expect(h.controller.getCurrentIndex()).toBe(0);
    expect(h.controller.getPositionMs()).toBe(0);
    expect(h.sink.currentChunkId).toBeUndefined();

    // Nothing restarts on its own after a Stop.
    const callsAtStop = h.tts.callCount;
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.tts.callCount).toBe(callsAtStop);
  });

  it("next skips to the following chunk without waiting for the end", async () => {
    const h = harness();
    await h.start(3);
    await vi.advanceTimersByTimeAsync(500);
    await h.controller.next();

    expect(h.controller.getCurrentIndex()).toBe(1);
    expect(h.controller.getPositionMs()).toBe(0);
    expect(h.sink.currentChunkId).toBe("session-1:1");
    expect(h.controller.getState()).toBe("playing");
  });

  it("previous goes back one chunk within the first two seconds", async () => {
    const h = harness();
    await h.start(3);
    await h.controller.next();
    await vi.advanceTimersByTimeAsync(750);
    expect(h.controller.getCurrentIndex()).toBe(1);

    await h.controller.previous();

    expect(h.controller.getCurrentIndex()).toBe(0);
    expect(h.sink.currentChunkId).toBe("session-1:0");
  });

  it("previous restarts the current chunk past two seconds", async () => {
    const h = harness();
    await h.start(3);
    await h.controller.next();
    await vi.advanceTimersByTimeAsync(2250);
    expect(h.controller.getPositionMs()).toBe(2250);

    await h.controller.previous();

    expect(h.controller.getCurrentIndex()).toBe(1);
    expect(h.controller.getPositionMs()).toBe(0);
  });

  it("previous on the very first chunk restarts it rather than underflowing", async () => {
    const h = harness();
    await h.start(2);
    await vi.advanceTimersByTimeAsync(500);
    await h.controller.previous();

    expect(h.controller.getCurrentIndex()).toBe(0);
    expect(h.controller.getPositionMs()).toBe(0);
    expect(h.sink.loads).toHaveLength(2);
  });

  it("ignores an `ended` reported for a chunk that is no longer current", async () => {
    const h = harness();
    await h.start(3);
    await h.controller.next();
    const indexBefore = h.controller.getCurrentIndex();

    // A late `ended` from chunk 0, after the player already moved on.
    h.sink.emitEnded("session-1:0");
    await vi.advanceTimersByTimeAsync(0);

    expect(h.controller.getCurrentIndex()).toBe(indexBefore);
  });
});

describe("PlaybackController — failures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips a chunk that failed synthesis after its retries (default policy)", async () => {
    // Chunk 1 fails every attempt: first try plus two retries, then `error`.
    const h = harness({ failTexts: ["Phrase numero 1."] });
    const started = h.controller.start({
      segments: makeSegments(3),
      profile: makeProfile(),
      tts: h.tts,
      sink: h.sink
    });
    await vi.advanceTimersByTimeAsync(0);
    await started;
    await vi.advanceTimersByTimeAsync(CHUNK_MS * 3);

    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]?.origin).toBe("synthesis");
    expect(h.errors[0]?.index).toBe(1);
    // Three attempts on chunk 1: the initial one plus two retries.
    expect(h.tts.texts.filter((text) => text === "Phrase numero 1.")).toHaveLength(3);
    expect(h.controller.getState()).toBe("completed");
    // Chunk 1 was skipped: only chunks 0 and 2 ever reached the sink.
    expect(h.sink.loads.map((load) => load.chunkId)).toEqual([
      "session-1:0",
      "session-1:2"
    ]);
  });

  it("moves to `error` when the injected policy answers `stop`", async () => {
    const h = harness({ failEveryNth: 1, onChunkError: () => "stop" });
    const started = h.controller.start({
      segments: makeSegments(2),
      profile: makeProfile(),
      tts: h.tts,
      sink: h.sink
    });
    await vi.advanceTimersByTimeAsync(0);
    await started;

    expect(h.controller.getState()).toBe("error");
    expect(h.errors).toHaveLength(1);
    expect(h.sink.loads).toHaveLength(0);
  });

  it("skips a chunk the sink could not play", async () => {
    const h = harness();
    await h.start(3);
    h.sink.failCurrent("decode error");
    await vi.advanceTimersByTimeAsync(0);

    expect(h.errors[0]?.origin).toBe("playback");
    expect(h.errors[0]?.message).toBe("decode error");
    expect(h.controller.getCurrentIndex()).toBe(1);
  });

  it("completes when the last chunk is the one that fails", async () => {
    const h = harness();
    await h.start(1);
    h.sink.failCurrent();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.controller.getState()).toBe("completed");
  });
});

describe("PlaybackController — lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispose during playback stops the sink and silences every event", async () => {
    const h = harness();
    await h.start(3);
    const statesBefore = h.states.length;
    const progressBefore = h.progress.length;

    h.controller.dispose();
    h.controller.dispose(); // idempotent

    expect(h.sink.commands.at(-1)).toBe("stop");
    expect(h.sink.isPlaying).toBe(false);

    await vi.advanceTimersByTimeAsync(CHUNK_MS * 3);
    expect(h.states).toHaveLength(statesBefore);
    expect(h.progress).toHaveLength(progressBefore);
  });

  it("refuses to start once disposed", async () => {
    const h = harness();
    h.controller.dispose();
    await expect(
      h.controller.start({
        segments: makeSegments(1),
        profile: makeProfile(),
        tts: h.tts,
        sink: h.sink
      })
    ).rejects.toThrow(/disposed/);
  });

  it("a second start tears the previous session down before playing", async () => {
    const h = harness();
    await h.start(3);
    await vi.advanceTimersByTimeAsync(500);

    const secondSink = new FakeAudioSink({ tickMs: 250 });
    await h.controller.start({
      segments: makeSegments(2),
      profile: makeProfile(),
      tts: h.tts,
      sink: secondSink
    });

    expect(h.sink.commands.at(-1)).toBe("stop");
    expect(h.sink.isPlaying).toBe(false);
    expect(secondSink.isPlaying).toBe(true);
    expect(h.controller.getChunks()).toHaveLength(2);
  });

  it("unsubscribing a listener stops delivery", async () => {
    const h = harness();
    const seen: number[] = [];
    const off = h.controller.onChunkChange((change) => seen.push(change.index));
    await h.start(2);
    off();
    await vi.advanceTimersByTimeAsync(CHUNK_MS * 2);

    expect(seen).toEqual([0]);
  });
});

describe("PlaybackController — progressive narration (CdC §63)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parks in `preparing` at the end of an unsealed session, then resumes", async () => {
    const h = harness();
    await h.start(1, false);
    expect(h.controller.getState()).toBe("playing");

    await vi.advanceTimersByTimeAsync(CHUNK_MS);
    expect(h.controller.getState()).toBe("preparing");

    h.controller.appendSegments(makeSegments(1, "late"));
    await vi.advanceTimersByTimeAsync(0);

    expect(h.controller.getState()).toBe("playing");
    expect(h.controller.getCurrentIndex()).toBe(1);
    expect(h.controller.getChunks()).toHaveLength(2);
  });

  it("completes when narration seals the session while it is parked", async () => {
    const h = harness();
    await h.start(1, false);
    await vi.advanceTimersByTimeAsync(CHUNK_MS);
    expect(h.controller.getState()).toBe("preparing");

    h.controller.sealSegments();
    expect(h.controller.getState()).toBe("completed");
  });

  it("ignores an empty append and keeps playing", async () => {
    const h = harness();
    await h.start(2, false);
    h.controller.appendSegments([]);
    expect(h.controller.getChunks()).toHaveLength(2);
    expect(h.controller.getState()).toBe("playing");
  });
});

describe("PlaybackController — configuration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes the queue tunables it was constructed with", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ msPerWord: 1000 }));
    const sink = new FakeAudioSink({ tickMs: 250 });
    const controller = new PlaybackController({
      cache: new InMemoryAudioCache(),
      maxConcurrentTtsJobs: 1,
      prefetchChunks: 1,
      maxRetries: 0,
      previousThresholdMs: 500
    });

    await controller.start({
      segments: makeSegments(4),
      profile: makeProfile(),
      tts,
      sink
    });
    await vi.advanceTimersByTimeAsync(0);

    // prefetchChunks: 1 means the window is the current chunk plus one.
    const statuses = controller.getChunks().map((chunk) => chunk.status);
    expect(statuses).toEqual(["playing", "ready", "pending", "pending"]);

    // previousThresholdMs: 500 moves the rewind boundary.
    await controller.next();
    await vi.advanceTimersByTimeAsync(750);
    await controller.previous();
    expect(controller.getCurrentIndex()).toBe(1);
    controller.dispose();
  });

  it("works with a profile that declares no model, voice or parameters", async () => {
    const tts = new RecordingTtsProvider(new FakeTtsProvider({ msPerWord: 1000 }));
    const sink = new FakeAudioSink({ tickMs: 250 });
    const controller = new PlaybackController({ cache: new InMemoryAudioCache() });
    const bare = makeProfile({
      tts: { providerId: "fake-tts", baseUrl: "http://127.0.0.1:8004" }
    });

    await controller.start({ segments: makeSegments(1), profile: bare, tts, sink });

    expect(controller.getState()).toBe("playing");
    expect(tts.texts).toEqual(["Phrase numero 0."]);
    controller.dispose();
  });

  it("parks an empty unsealed session instead of completing it", async () => {
    const h = harness();
    await h.start(0, false);
    expect(h.controller.getState()).toBe("preparing");

    h.controller.appendSegments(makeSegments(1, "late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.controller.getState()).toBe("playing");
  });

  it("stays silent when disposed while a chunk is still being synthesised", async () => {
    const h = harness({ ttsLatencyMs: 100 });
    const started = h.controller.start({
      segments: makeSegments(2),
      profile: makeProfile(),
      tts: h.tts,
      sink: h.sink
    });
    h.controller.dispose();
    await vi.advanceTimersByTimeAsync(300);
    await started;

    expect(h.sink.isPlaying).toBe(false);
    expect(h.sink.loads).toHaveLength(0);
  });
});
