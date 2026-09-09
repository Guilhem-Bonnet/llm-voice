/**
 * Playback state and the Webview player protocol.
 * See ADR-001 and decision D4; the Extension Host owns the state machine,
 * the Webview is a passive single-`<audio>` player.
 */

import type { NarrationSegment } from "./narration.js";
import type { SourceDocument, SourceRange } from "./source.js";
import type { AudioFormat } from "./tts.js";

/** Lifecycle of a single audio chunk in the synthesis queue (CdC §30). */
export type AudioChunkStatus =
  | "pending"
  | "generating"
  | "ready"
  | "playing"
  | "played"
  | "error";

/** One synthesised unit of audio and the source it highlights (CdC §30). */
export interface AudioChunk {
  id: string;
  sessionId: string;
  spokenText: string;
  sourceRanges: readonly SourceRange[];
  /** Absolute path or URI of the cached audio file; absent until ready. */
  audioUri?: string;
  format?: AudioFormat;
  durationMs?: number;
  status: AudioChunkStatus;
  error?: string;
}

/**
 * States of the player state machine (CdC §34), plus `stale` from D6 and
 * `buffering` (ADR-005's reported-to-phase-4 gap): the machine was already
 * `playing` a chunk, that chunk ended, and the next one is not `ready` yet —
 * distinct from `preparing`, which is the very first chunk of a session.
 */
export type PlaybackState =
  | "idle"
  | "preparing"
  | "playing"
  | "buffering"
  | "paused"
  | "stopped"
  | "completed"
  | "stale"
  | "error";

/** Everything one reading session holds (CdC §31). */
export interface PlaybackSession {
  id: string;
  profileId: string;
  source: SourceDocument;
  segments: readonly NarrationSegment[];
  chunks: readonly AudioChunk[];
  currentChunkIndex: number;
  state: PlaybackState;
  /** Intra-chunk resume position, fed by the throttled `timeupdate` event. */
  positionMs?: number;
  startedAt?: number;
}

/** Snapshot pushed to the Webview so it can render the mini-player (D12). */
export interface PlayerStateView {
  session: string;
  index: number;
  total: number;
  profile: string;
  title: string;
  state: PlaybackState;
}

/** Buttons the Webview can report; the Extension Host decides what they mean. */
export type PlayerUserAction =
  | "play"
  | "pause"
  | "stop"
  | "next"
  | "prev"
  | "selectProfile"
  // S7.2: the empty-player welcome buttons (ADR-011's "never shown empty"
  // link becomes two real actions instead of a dead end).
  | "setupVoice"
  | "speakCurrentDocument";

/** Commands sent Extension Host → Webview (D4). */
export type ExtensionToWebviewMessage =
  | {
      type: "load";
      chunkId: string;
      /** Result of `webview.asWebviewUri` on a file inside the audio cache. */
      src: string;
      durationMs?: number;
      autoplay: boolean;
    }
  | { type: "play" }
  | { type: "pause" }
  | { type: "stop" }
  | { type: "seek"; positionMs: number }
  | { type: "setRate"; value: number }
  | { type: "setVolume"; value: number }
  | { type: "state"; state: PlayerStateView };

/** Events sent Webview → Extension Host (D4). */
export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "timeupdate"; chunkId: string; positionMs: number }
  | { type: "ended"; chunkId: string }
  | { type: "error"; chunkId: string; message: string }
  | { type: "userAction"; action: PlayerUserAction };

/** Either direction of the player protocol. */
export type PlayerMessage = ExtensionToWebviewMessage | WebviewToExtensionMessage;

/** Throttling interval for `timeupdate`, in milliseconds (D4). */
export type TimeUpdateThrottleMs = 250;
