/**
 * Fake AudioSink v2 (src/playback/AudioSink.ts; ADR-012 §3).
 *
 * Simulates a native gapless engine with a plain interval, so a whole reading
 * session can be driven deterministically under `vi.useFakeTimers()`:
 *
 *  - position is **absolute** and derived from elapsed (fake) time, like a
 *    sample counter: every `tickMs` a `timeupdate` carries it, and `pause()`
 *    emits one last `timeupdate` with the exact position resume starts from;
 *  - `ended` is emitted once the position reaches the chunk duration, i.e.
 *    once every "sample" was rendered — the drain-aware `ended` of v2;
 *  - a chunk given to `enqueue()` takes over in the same tick, with the time
 *    left over from its predecessor (no gap), and is announced by `started`;
 *  - with nothing enqueued, `ended` is followed by `underrun` while the sink
 *    keeps its "play" intent: a chunk enqueued then starts at once.
 *
 * It journals every command it receives and every event it emits in
 * `timeline`, which is how the unit suite proves that two ready chunks are
 * chained with no `ended`→`load` round trip, that `pause` never reloads, that
 * `stop` unloads, and that two chunks are never playing at the same time.
 */
import type {
  AudioSink,
  AudioSinkChunk,
  AudioSinkEvent,
  AudioSinkEventMap,
  AudioSinkListener,
  Unsubscribe
} from "../../src/playback/index.js";

export interface FakeAudioSinkOptions {
  /** Progress tick, mirroring the 250 ms throttle of D4. */
  tickMs?: number;
  /** Duration assumed when a chunk carries no `durationMs` (cache hits). */
  defaultDurationMs?: number;
}

interface LoadedChunk {
  chunkId: string;
  durationMs: number;
}

type ListenerSets = {
  [E in AudioSinkEvent]: Set<AudioSinkListener<E>>;
};

export class FakeAudioSink implements AudioSink {
  readonly gapless = true;
  /** Every `load()` received, in order. */
  readonly loads: AudioSinkChunk[] = [];
  /** Every `enqueue()` received, in order. */
  readonly enqueues: AudioSinkChunk[] = [];
  /** Every chunk handed over, by `load()` or `enqueue()`, in order. */
  readonly received: AudioSinkChunk[] = [];
  /** Journal of commands: `play`, `pause`, `stop`, `seek:<ms>`, `clearQueue`. */
  readonly commands: string[] = [];
  /**
   * Commands and events interleaved, in order: `load:<id>`, `enqueue:<id>`,
   * the `commands` entries, and `started:<id>`, `ended:<id>`,
   * `underrun:<id>`, `error:<id>` (never `timeupdate`, too chatty).
   */
  readonly timeline: string[] = [];

  private readonly tickMs: number;
  private readonly defaultDurationMs: number;
  private readonly listeners: ListenerSets = {
    timeupdate: new Set(),
    started: new Set(),
    ended: new Set(),
    underrun: new Set(),
    error: new Set()
  };

  private current: LoadedChunk | undefined;
  private readonly pending: LoadedChunk[] = [];
  private positionMs = 0;
  /** "Play" intent, kept through an `underrun`. */
  private playing = false;
  private startedCurrent = false;
  /** The current chunk ended with nothing enqueued while playing. */
  private starved = false;
  private lastTickAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: FakeAudioSinkOptions = {}) {
    this.tickMs = options.tickMs ?? 250;
    this.defaultDurationMs = options.defaultDurationMs ?? 1000;
  }

  async load(chunk: AudioSinkChunk): Promise<void> {
    this.clearTimer();
    this.loads.push(chunk);
    this.received.push(chunk);
    this.timeline.push(`load:${chunk.chunkId}`);
    this.pending.length = 0;
    this.becomeCurrent(this.toLoaded(chunk));
    this.playing = false;
  }

  async enqueue(chunk: AudioSinkChunk): Promise<void> {
    this.enqueues.push(chunk);
    this.received.push(chunk);
    this.timeline.push(`enqueue:${chunk.chunkId}`);
    const loaded = this.toLoaded(chunk);
    if (this.current === undefined || this.starved) {
      const resume = this.starved && this.playing;
      this.becomeCurrent(loaded);
      if (resume) {
        this.startCurrent();
      }
      return;
    }
    this.pending.push(loaded);
  }

  clearQueue(): void {
    this.record("clearQueue");
    this.pending.length = 0;
  }

  play(): void {
    this.record("play");
    if (this.current === undefined || (this.playing && !this.starved)) {
      return;
    }
    this.playing = true;
    if (this.starved) {
      return;
    }
    this.startCurrent();
  }

  pause(): void {
    this.record("pause");
    if (this.timer !== undefined) {
      this.advance(Date.now() - this.lastTickAt, false);
    }
    this.playing = false;
    this.clearTimer();
    if (this.current !== undefined && this.startedCurrent && !this.starved) {
      this.emit("timeupdate", {
        chunkId: this.current.chunkId,
        positionMs: this.positionMs
      });
    }
  }

  stop(): void {
    this.record("stop");
    this.playing = false;
    this.clearTimer();
    this.positionMs = 0;
    this.current = undefined;
    this.pending.length = 0;
    this.startedCurrent = false;
    this.starved = false;
  }

  seek(positionMs: number): void {
    this.record(`seek:${positionMs}`);
    this.positionMs = positionMs;
    this.lastTickAt = Date.now();
    if (this.current !== undefined) {
      this.emit("timeupdate", { chunkId: this.current.chunkId, positionMs });
    }
  }

  on<E extends AudioSinkEvent>(event: E, handler: AudioSinkListener<E>): Unsubscribe {
    const set = this.listeners[event] as Set<AudioSinkListener<E>>;
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  // ------------------------------------------------------------ test hooks

  /** Id of the chunk currently loaded, or `undefined` after `stop()`. */
  get currentChunkId(): string | undefined {
    return this.current?.chunkId;
  }

  /** Ids of the chunks enqueued after the current one. */
  get pendingChunkIds(): string[] {
    return this.pending.map((chunk) => chunk.chunkId);
  }

  get positionMsNow(): number {
    return this.positionMs;
  }

  get isPlaying(): boolean {
    return this.playing && !this.starved;
  }

  get isStarved(): boolean {
    return this.starved;
  }

  /**
   * Reports `ended` for `chunkId`. For the current chunk this is the real end
   * (drain, then hand-over to the next enqueued chunk or `underrun`); for any
   * other id it replays a stale `ended`, as a slow engine would after a jump.
   */
  emitEnded(chunkId: string): void {
    if (this.current !== undefined && this.current.chunkId === chunkId) {
      this.positionMs = this.current.durationMs;
      this.finishCurrent(0);
      return;
    }
    this.emit("ended", { chunkId });
  }

  /** Simulates a decode or media failure on the loaded chunk. */
  failCurrent(message = "fake sink failure"): void {
    if (this.current === undefined) {
      return;
    }
    const chunkId = this.current.chunkId;
    this.playing = false;
    this.clearTimer();
    this.emit("error", { chunkId, message });
  }

  /** Simulates a decode failure of the first enqueued chunk; it is dropped. */
  failEnqueued(message = "fake enqueue failure"): void {
    const failed = this.pending.shift();
    if (failed !== undefined) {
      this.emit("error", { chunkId: failed.chunkId, message });
    }
  }

  // -------------------------------------------------------------- internals

  private toLoaded(chunk: AudioSinkChunk): LoadedChunk {
    return {
      chunkId: chunk.chunkId,
      durationMs: chunk.durationMs ?? this.defaultDurationMs
    };
  }

  private becomeCurrent(chunk: LoadedChunk): void {
    this.current = chunk;
    this.positionMs = 0;
    this.startedCurrent = false;
    this.starved = false;
  }

  private startCurrent(): void {
    if (this.current === undefined) {
      return;
    }
    this.lastTickAt = Date.now();
    if (this.timer === undefined) {
      this.timer = setInterval(() => this.tick(), this.tickMs);
    }
    if (!this.startedCurrent) {
      this.startedCurrent = true;
      this.emit("started", { chunkId: this.current.chunkId });
    }
  }

  private tick(): void {
    if (this.current === undefined || !this.playing || this.starved) {
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastTickAt;
    this.lastTickAt = now;
    this.advance(elapsed, true);
  }

  /** Moves the "sample counter" by `elapsedMs`, chaining enqueued chunks. */
  private advance(elapsedMs: number, report: boolean): void {
    const current = this.current;
    if (current === undefined || this.starved) {
      return;
    }
    const reached = this.positionMs + elapsedMs;
    this.positionMs = Math.min(reached, current.durationMs);
    if (report) {
      this.emit("timeupdate", { chunkId: current.chunkId, positionMs: this.positionMs });
    }
    if (reached >= current.durationMs) {
      this.finishCurrent(reached - current.durationMs);
    }
  }

  /** Every sample of the current chunk was rendered: drain, then hand over. */
  private finishCurrent(leftoverMs: number): void {
    const ended = this.current;
    if (ended === undefined) {
      return;
    }
    this.emit("ended", { chunkId: ended.chunkId });
    if (this.current !== ended || !this.playing) {
      // A listener stopped, paused or reloaded during `ended`.
      return;
    }
    const next = this.pending.shift();
    if (next === undefined) {
      this.starved = true;
      this.clearTimer();
      this.emit("underrun", { chunkId: ended.chunkId, positionMs: ended.durationMs });
      return;
    }
    this.becomeCurrent(next);
    this.startedCurrent = true;
    this.emit("started", { chunkId: next.chunkId });
    if (leftoverMs > 0 && this.current === next) {
      this.advance(leftoverMs, false);
    }
  }

  private record(command: string): void {
    this.commands.push(command);
    this.timeline.push(command);
  }

  private emit<E extends AudioSinkEvent>(event: E, payload: AudioSinkEventMap[E]): void {
    if (event !== "timeupdate") {
      this.timeline.push(`${event}:${payload.chunkId}`);
    }
    const set = this.listeners[event] as Set<AudioSinkListener<E>>;
    for (const handler of [...set]) {
      handler(payload);
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
