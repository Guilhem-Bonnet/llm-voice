/**
 * `AudioSink`: the playback surface, abstracted away from the Webview.
 *
 * ADR-001 puts a single passive `<audio>` element in a Webview View and keeps
 * the state machine in the Extension Host. This interface is exactly that
 * Webview seen from the host side: the D4 messages `load` / `play` / `pause` /
 * `stop` / `seek` become methods, and `timeupdate` / `ended` / `error` become
 * events. Nothing here knows about VS Code, so `PlaybackController` can be
 * driven by `FakeAudioSink` under fake timers.
 */

import type { AudioFormat } from "../core/tts.js";
import type { Unsubscribe } from "./emitter.js";

/** Payload of a `load` command (ADR-001, Extension → Webview). */
export interface AudioSinkChunk {
  chunkId: string;
  /** Location the sink can read; `webview.asWebviewUri(...)` in production. */
  src: string;
  /** Known duration, when synthesis reported one; the sink is authoritative. */
  durationMs?: number;
  format?: AudioFormat;
}

/** Events the sink reports back, mirroring the Webview → Extension messages. */
export interface AudioSinkEventMap {
  /** Throttled progress tick (250 ms in the real player, D4). */
  timeupdate: { chunkId: string; positionMs: number };
  /** The loaded chunk reached its end without error. */
  ended: { chunkId: string };
  /** The loaded chunk could not be decoded or played. */
  error: { chunkId: string; message: string };
}

/** Name of an `AudioSink` event. */
export type AudioSinkEvent = keyof AudioSinkEventMap;

/** Handler of one `AudioSink` event. */
export type AudioSinkListener<E extends AudioSinkEvent> = (
  payload: AudioSinkEventMap[E]
) => void;

/**
 * Passive audio surface. Implementations never queue, never fetch and never
 * decide what plays next: they load what they are told and report what happens.
 */
export interface AudioSink {
  /** Loads a chunk, replacing whatever was loaded before, paused at 0 ms. */
  load(chunk: AudioSinkChunk): Promise<void>;
  play(): void;
  pause(): void;
  /** Stops and unloads; a later `play()` is a no-op until the next `load()`. */
  stop(): void;
  seek(positionMs: number): void;
  on<E extends AudioSinkEvent>(
    event: E,
    handler: AudioSinkListener<E>
  ): Unsubscribe;
}
