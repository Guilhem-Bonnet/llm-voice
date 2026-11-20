/**
 * `SequencedAudioSink`: lifts a v1 `LegacyAudioSink` to the `AudioSink` v2
 * contract (ADR-012 §3, carte `GAO-contrat-audi-001`).
 *
 * The webview `<audio>` element (`WebviewAudioSink`) plays one source at a
 * time and has no notion of a queue. This adapter keeps the queue on the host
 * side: when the engine reports `ended` for the current chunk, it re-emits
 * `ended`, then loads and plays the next enqueued chunk itself and emits
 * `started`. `PlaybackController` therefore sees exactly the same event
 * sequence as with a native gapless engine and never does the
 * `ended`→`load` round trip — but the hand-over still costs one reload inside
 * the engine, so this sink declares `gapless: false`.
 *
 * What it cannot add: a drain-aware `ended` or a sample-exact position. It
 * relays what the engine reports (for `<audio>`, `ended` fires once the media
 * element finished, `timeupdate` is the element's `currentTime`).
 */

import type {
  AudioSink,
  AudioSinkChunk,
  AudioSinkEvent,
  AudioSinkEventMap,
  AudioSinkListener,
  LegacyAudioSink
} from "./AudioSink.js";
import { Emitter, type Unsubscribe } from "./emitter.js";

type Intent = "idle" | "paused" | "playing";

export class SequencedAudioSink implements AudioSink {
  readonly gapless = false;

  private readonly emitters: { [E in AudioSinkEvent]: Emitter<AudioSinkEventMap[E]> } = {
    timeupdate: new Emitter(),
    started: new Emitter(),
    ended: new Emitter(),
    underrun: new Emitter(),
    error: new Emitter()
  };

  private current: AudioSinkChunk | undefined;
  private readonly pending: AudioSinkChunk[] = [];
  private intent: Intent = "idle";
  private startedCurrent = false;
  /** Set when the current chunk ended with nothing queued while playing. */
  private starved = false;
  private lastPositionMs = 0;

  constructor(private readonly inner: LegacyAudioSink) {
    inner.on("timeupdate", (payload) => {
      if (payload.chunkId === this.current?.chunkId) {
        this.lastPositionMs = payload.positionMs;
      }
      this.emitters.timeupdate.emit(payload);
    });
    inner.on("ended", (payload) => {
      this.handleInnerEnded(payload.chunkId);
    });
    inner.on("error", (payload) => {
      this.emitters.error.emit(payload);
    });
  }

  async load(chunk: AudioSinkChunk): Promise<void> {
    this.pending.length = 0;
    this.becomeCurrent(chunk);
    this.intent = "paused";
    await this.inner.load(chunk);
  }

  async enqueue(chunk: AudioSinkChunk): Promise<void> {
    if (this.current === undefined || this.starved) {
      const resume = this.starved && this.intent === "playing";
      this.becomeCurrent(chunk);
      await this.inner.load(chunk);
      if (resume && this.current === chunk) {
        this.startCurrent();
      }
      return;
    }
    this.pending.push(chunk);
  }

  clearQueue(): void {
    this.pending.length = 0;
  }

  play(): void {
    if (this.current === undefined) {
      return;
    }
    this.intent = "playing";
    if (this.starved) {
      return;
    }
    this.startCurrent();
  }

  pause(): void {
    if (this.intent === "playing") {
      this.intent = "paused";
    }
    this.inner.pause();
    if (this.current !== undefined && this.startedCurrent) {
      // Best effort: the last position the engine reported.
      this.emitters.timeupdate.emit({
        chunkId: this.current.chunkId,
        positionMs: this.lastPositionMs
      });
    }
  }

  stop(): void {
    this.pending.length = 0;
    this.current = undefined;
    this.intent = "idle";
    this.startedCurrent = false;
    this.starved = false;
    this.lastPositionMs = 0;
    this.inner.stop();
  }

  seek(positionMs: number): void {
    this.lastPositionMs = positionMs;
    this.inner.seek(positionMs);
  }

  on<E extends AudioSinkEvent>(event: E, handler: AudioSinkListener<E>): Unsubscribe {
    return (this.emitters[event] as Emitter<AudioSinkEventMap[E]>).on(handler);
  }

  // --------------------------------------------------------------- internals

  private becomeCurrent(chunk: AudioSinkChunk): void {
    this.current = chunk;
    this.startedCurrent = false;
    this.starved = false;
    this.lastPositionMs = 0;
  }

  private startCurrent(): void {
    if (this.current === undefined) {
      return;
    }
    this.inner.play();
    if (!this.startedCurrent) {
      this.startedCurrent = true;
      this.emitters.started.emit({ chunkId: this.current.chunkId });
    }
  }

  private handleInnerEnded(chunkId: string): void {
    const ended = this.current;
    if (ended === undefined || ended.chunkId !== chunkId) {
      // Stale report from a chunk already replaced: relay it untouched, the
      // controller ignores `ended` for anything but its current chunk.
      this.emitters.ended.emit({ chunkId });
      return;
    }
    this.emitters.ended.emit({ chunkId });
    if (this.current !== ended || this.intent !== "playing") {
      // A handler stopped, paused or reloaded during `ended`.
      return;
    }
    const next = this.pending.shift();
    if (next === undefined) {
      this.starved = true;
      this.emitters.underrun.emit({
        chunkId,
        positionMs: ended.durationMs ?? this.lastPositionMs
      });
      return;
    }
    this.becomeCurrent(next);
    void this.inner.load(next).then(() => {
      if (this.current === next && this.intent === "playing") {
        this.startCurrent();
      }
    });
  }
}
