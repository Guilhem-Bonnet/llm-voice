/**
 * Playback state and the Webview player protocol.
 * See ADR-001 and decision D4; the Extension Host owns the state machine,
 * the Webview is a passive single-`<audio>` player.
 */

import type { WaitView } from "../playback/waitEstimate.js";
import type { TtsHoldReason } from "./tts.js";
import type { NarrationSegment } from "./narration.js";
import type { SourceDocument, SourceRange, StageState } from "./source.js";
import type { AudioFormat } from "./tts.js";

/** Lifecycle of a single audio chunk in the synthesis queue (CdC §30). */
export type AudioChunkStatus =
  | "pending"
  | "generating"
  | "ready"
  | "playing"
  | "played"
  | "error";

/**
 * The voice of one passage (ADR-018 §4.1). `speakerId` says who speaks: it never enters a
 * request or a cache key, and it is never logged with a name. No `voice`: the voice of the
 * session, which is how a narrator's passage keeps today's key.
 */
export interface ChunkVoice {
  readonly speakerId: string;
  readonly voice?: string;
  readonly model?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** Shown, not played yet: like `speakerId`, it enters neither a request nor a cache key. */
  readonly stage?: readonly StageState[];
}

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
  /** Set when the engine refused for a reason only the user can lift (`TtsHoldError`). */
  holdReason?: TtsHoldReason;
  /** Who speaks, and with which voice, when a reading has several (ADR-018). */
  cast?: ChunkVoice;
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
  /**
   * Human-facing TTS provider label (`friendlyTtsProviderLabel`), e.g.
   * "Chatterbox (qualité maximale)" — audit 2026-11-05 P1: the only
   * persistent, always-visible confirmation that a voice choice took
   * effect.
   */
  voice: string;
  title: string;
  state: PlaybackState;
  /** The wait before the sound, while there is one. */
  wait?: WaitView;
  /** Passages already generated past the one being read; absent outside a reading. */
  ahead?: number;
  /** "Lecture de : …, lignes 42-58", when the section is known. */
  reading?: string;
  /** Why the reading stopped, with what can be done about it. */
  notice?: PlayerNotice;
  /** "Juliette · voix Camille", in a reading with several voices (ADR-018 §4.3). */
  speaker?: string;
  /** While a reply with a fenced block is read: whether its code is said. */
  responseCode?: ResponseCodeChipView;
}

/** The chip "Code : ignoré / lu". */
export interface ResponseCodeChipView {
  text: string;
  pressed: boolean;
  /** Present when the choice waits for the next reading. */
  note?: string;
}

/** What the panel shows when the engine holds back (mode jeu, memory). */
export interface PlayerNotice {
  title: string;
  body: string;
}

/** The open document, as the player shows it. Never its content. */
export interface PlayerDocumentView {
  fileName: string;
  /** Non-empty selected passages, after merging. */
  passages: number;
  /** "Passages : lignes 12-18, 40-44 et 90.", from two passages up. */
  passagesText?: string;
  /** What was recognised of a script in it; a proposal, which never starts a reading. */
  script?: PlayerScriptView;
}

/** The "Document ouvert" line about several voices (ADR-018 §6). No name, only a count. */
export interface PlayerScriptView {
  text: string;
  /** Shows the buttons; absent when there is nothing to activate. */
  roles: number;
  enabled: boolean;
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
  | "speakCurrentDocument"
  // The "Document ouvert" block. Each one is a click: nothing here starts by itself.
  | "speakSelection"
  | "speakFromCursor"
  | "speakClipboard"
  // The notice shown when the engine holds back.
  | "retryHold"
  | "readWithSystemVoice"
  // The script line of the "Document ouvert" block: a setting and a list, never a reading.
  | "toggleCast"
  // The chip of a reply being read: a setting, never a reading.
  | "toggleResponseCode"
  | "chooseCastVoices";

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
  | { type: "state"; state: PlayerStateView }
  | { type: "document"; document: PlayerDocumentView | null };

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
