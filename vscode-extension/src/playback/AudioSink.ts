/**
 * `AudioSink` v2: the playback surface, abstracted away from any engine.
 *
 * ADR-001 put a single passive `<audio>` element in a Webview View and kept
 * the state machine in the Extension Host; ADR-012 moves playback to a native
 * Core but keeps that split. This interface is the engine seen from the host:
 * commands become methods, reports become events. Nothing here knows about
 * VS Code, so `PlaybackController` can be driven by `FakeAudioSink` under
 * fake timers.
 *
 * v1 created a gap by construction: `load()` replaced whatever was loaded and
 * the next chunk could only be loaded after `ended`, i.e. one `ended`→`load`
 * round trip between two chunks that were both ready. v2 (ADR-012 §3, carte
 * `GAO-contrat-audi-001`) adds:
 *
 *  - **preloading**: `enqueue()` hands the next chunk over while the current
 *    one is still playing; the sink chains it sample-exactly and reports the
 *    hand-over with `started`;
 *  - **absolute position**: `timeupdate.positionMs` is the position inside the
 *    chunk derived from what the device actually rendered (samples played /
 *    sample rate), never a wall-clock estimate or a delta;
 *  - **underrun**: the sink says when it is playing but has nothing to render;
 *  - **drain-aware `ended`**: emitted only once the last sample of the chunk
 *    left the device, never when the decoder merely reached the end of the
 *    file (spike `GAO-spike-moteur-001`, CL-004: both prototypes returned
 *    before the device buffer drained and cut the last word).
 *
 * Engines that cannot honour every guarantee (the webview `<audio>` fallback)
 * are wrapped by `SequencedAudioSink`, which implements this contract on top
 * of `LegacyAudioSink` and declares `gapless: false`.
 */

import type { AudioFormat } from "../core/tts.js";
import type { Unsubscribe } from "./emitter.js";

/** Payload of a `load` / `enqueue` command (ADR-001 D4, ADR-012 §4). */
export interface AudioSinkChunk {
  chunkId: string;
  /**
   * Absolute file path of the cached audio (`DiskAudioCache`). A webview sink
   * converts it with `asWebviewUri`; the native Core refuses any path outside
   * its declared cache folder (ADR-012 §4).
   */
  src: string;
  /** Known duration, when synthesis reported one; the sink is authoritative. */
  durationMs?: number;
  format?: AudioFormat;
}

/** Events the sink reports back (ADR-012 §4: the same vocabulary on the wire). */
export interface AudioSinkEventMap {
  /**
   * Progress tick (250 ms in the real engines, D4). `positionMs` is the
   * absolute position inside `chunkId`, computed from rendered samples. It is
   * monotone non-decreasing for one chunk between two `seek()`/`load()`, and
   * `pause()` emits one last tick carrying the exact position playback will
   * resume from.
   */
  timeupdate: { chunkId: string; positionMs: number };
  /**
   * `chunkId` produced its first audible sample: after `play()` following a
   * `load()`, or when a chunk given to `enqueue()` takes over from the one
   * that just ended. For an enqueued chunk it always directly follows the
   * predecessor's `ended`, with no gap in between.
   */
  started: { chunkId: string };
  /**
   * `chunkId` played to its end **and the device drained it**: its last sample
   * was rendered, so nothing of it can still be cut.
   */
  ended: { chunkId: string };
  /**
   * The sink is playing but has nothing to render: `chunkId` ended with no
   * chunk enqueued after it (`positionMs` = its duration), or its data did not
   * arrive fast enough mid-chunk. The sink stays in "play" intent: a chunk
   * enqueued afterwards starts at once, a `load()` + `play()` works as usual.
   */
  underrun: { chunkId: string; positionMs: number };
  /**
   * The chunk could not be decoded or played. An enqueued chunk that fails is
   * dropped from the queue; it never produces `started`.
   */
  error: { chunkId: string; message: string };
}

/** Name of an `AudioSink` event. */
export type AudioSinkEvent = keyof AudioSinkEventMap;

/** Handler of one `AudioSink` event. */
export type AudioSinkListener<E extends AudioSinkEvent> = (
  payload: AudioSinkEventMap[E]
) => void;

/**
 * Passive audio surface. Implementations never fetch, never synthesise and
 * never decide what plays next: they play what they are told, in the order
 * they are told, and report what happens.
 */
export interface AudioSink {
  /**
   * `true` when an enqueued chunk follows its predecessor with no audible gap
   * (native engine). `false` for engines emulating `enqueue()` with a reload
   * (webview fallback): same events, but the hand-over is not sample-exact.
   */
  readonly gapless: boolean;
  /**
   * Fallback watchdog (repris de la PR #64, GAO-diagnostic-s-001): when set,
   * `PlaybackController` expects a `timeupdate` for the playing chunk within
   * this many milliseconds of `play()` (first chunk, resume, hand-over); none
   * means the engine never really started, and it is reported as a playback
   * `error` instead of a highlight running over silence. Only the webview
   * engine declares it — its `<audio>` element can fail without a word.
   */
  readonly noProgressTimeoutMs?: number;
  /**
   * Loads a chunk, replacing whatever was loaded **and everything enqueued**,
   * paused at 0 ms.
   */
  load(chunk: AudioSinkChunk): Promise<void>;
  /**
   * Appends a chunk after the current one (and after anything already
   * enqueued). It starts, with `started`, right after the predecessor's
   * `ended`, with no command from the host in between. Enqueued in a sink
   * starved by an `underrun` while playing, it starts at once. Resolves when
   * the sink accepted the chunk; decoding failures surface as `error`.
   */
  enqueue(chunk: AudioSinkChunk): Promise<void>;
  /**
   * Drops every enqueued chunk; the current one keeps playing. Used when the
   * host changes its mind about what follows (`next()` / `previous()` while
   * the preloaded chunk is no longer the right one).
   */
  clearQueue(): void;
  play(): void;
  /** Pauses; the position is kept exactly (see `timeupdate`). */
  pause(): void;
  /** Stops, unloads and drops the enqueued chunks; `play()` is then a no-op. */
  stop(): void;
  /** Seeks inside the current chunk; enqueued chunks are kept. */
  seek(positionMs: number): void;
  on<E extends AudioSinkEvent>(
    event: E,
    handler: AudioSinkListener<E>
  ): Unsubscribe;
}

/** v1 events (ADR-001 D4), still spoken by the webview player. */
export type LegacyAudioSinkEventMap = Pick<
  AudioSinkEventMap,
  "timeupdate" | "ended" | "error"
>;

/** Name of a `LegacyAudioSink` event. */
export type LegacyAudioSinkEvent = keyof LegacyAudioSinkEventMap;

/**
 * `AudioSink` v1: one chunk at a time, no preloading, `ended` as reported by
 * the engine. Kept for the webview fallback (`WebviewAudioSink`), which
 * `SequencedAudioSink` lifts to v2.
 */
export interface LegacyAudioSink {
  /** Loads a chunk, replacing whatever was loaded before, paused at 0 ms. */
  load(chunk: AudioSinkChunk): Promise<void>;
  play(): void;
  pause(): void;
  /** Stops and unloads; a later `play()` is a no-op until the next `load()`. */
  stop(): void;
  seek(positionMs: number): void;
  on<E extends LegacyAudioSinkEvent>(
    event: E,
    handler: (payload: LegacyAudioSinkEventMap[E]) => void
  ): Unsubscribe;
}
