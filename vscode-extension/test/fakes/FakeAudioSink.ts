/**
 * Fake AudioSink (ADR-001 protocol D4; src/playback/AudioSink.ts).
 *
 * Simulates the Webview `<audio>` element with a plain interval, so a whole
 * reading session can be driven deterministically under `vi.useFakeTimers()`:
 * every `tickMs` the position advances and a `timeupdate` is emitted, and when
 * the position reaches the chunk duration the sink emits `ended` exactly once
 * and stops itself — the same sequence the real player produces.
 *
 * It also journals every command it receives, which is how the unit suite
 * proves that `pause` never reloads, that `stop` unloads, and that two chunks
 * are never playing at the same time.
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
  /** Duration assumed when `load()` gets no `durationMs` (cache hits). */
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
  /** Every `load()` received, in order. */
  readonly loads: AudioSinkChunk[] = [];
  /** Journal of commands: `play`, `pause`, `stop`, `seek:<ms>`. */
  readonly commands: string[] = [];

  private readonly tickMs: number;
  private readonly defaultDurationMs: number;
  private readonly listeners: ListenerSets = {
    timeupdate: new Set(),
    ended: new Set(),
    error: new Set()
  };

  private loaded: LoadedChunk | undefined;
  private positionMs = 0;
  private playing = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: FakeAudioSinkOptions = {}) {
    this.tickMs = options.tickMs ?? 250;
    this.defaultDurationMs = options.defaultDurationMs ?? 1000;
  }

  async load(chunk: AudioSinkChunk): Promise<void> {
    this.clearTimer();
    this.loads.push(chunk);
    this.loaded = {
      chunkId: chunk.chunkId,
      durationMs: chunk.durationMs ?? this.defaultDurationMs
    };
    this.positionMs = 0;
    this.playing = false;
  }

  play(): void {
    this.commands.push("play");
    if (this.loaded === undefined || this.playing) {
      return;
    }
    this.playing = true;
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  pause(): void {
    this.commands.push("pause");
    this.playing = false;
    this.clearTimer();
  }

  stop(): void {
    this.commands.push("stop");
    this.playing = false;
    this.clearTimer();
    this.positionMs = 0;
    this.loaded = undefined;
  }

  seek(positionMs: number): void {
    this.commands.push(`seek:${positionMs}`);
    this.positionMs = positionMs;
    if (this.loaded !== undefined) {
      this.emit("timeupdate", { chunkId: this.loaded.chunkId, positionMs });
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
    return this.loaded?.chunkId;
  }

  get positionMsNow(): number {
    return this.positionMs;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Replays a stale `ended`, as a slow Webview would after a `next()`. */
  emitEnded(chunkId: string): void {
    this.emit("ended", { chunkId });
  }

  /** Simulates a decode or media failure on the loaded chunk. */
  failCurrent(message = "fake sink failure"): void {
    if (this.loaded === undefined) {
      return;
    }
    const chunkId = this.loaded.chunkId;
    this.playing = false;
    this.clearTimer();
    this.emit("error", { chunkId, message });
  }

  // -------------------------------------------------------------- internals

  private tick(): void {
    if (this.loaded === undefined || !this.playing) {
      return;
    }
    const { chunkId, durationMs } = this.loaded;
    this.positionMs = Math.min(this.positionMs + this.tickMs, durationMs);
    this.emit("timeupdate", { chunkId, positionMs: this.positionMs });
    if (this.positionMs >= durationMs) {
      this.playing = false;
      this.clearTimer();
      this.emit("ended", { chunkId });
    }
  }

  private emit<E extends AudioSinkEvent>(event: E, payload: AudioSinkEventMap[E]): void {
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
