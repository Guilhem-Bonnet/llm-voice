/**
 * Text-to-speech provider contract, capabilities and audio cache material.
 * See ADR-005 and decision D2 (chunk-level progressive playback in 0.1).
 */

import type { ProviderHealth } from "./health.js";

/** Container formats the player can load in a Webview `<audio>` element. */
export type AudioFormat = "wav" | "mp3" | "ogg" | "flac" | "pcm";

/** A voice offered by a TTS provider. */
export interface Voice {
  id: string;
  label: string;
  language?: string;
  gender?: string;
  preview?: string;
}

/** Declared shape of a provider-specific tuning parameter, used to build UI. */
export interface TtsParameterDescriptor {
  name: string;
  label: string;
  type: "number" | "string" | "boolean" | "enum";
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  description?: string;
}

/** Everything the player needs to know about a provider without guessing (ADR-005). */
export interface TtsCapabilities {
  /** True only if `synthesizeStream` is implemented and usable. */
  streaming: boolean;
  voices: readonly Voice[];
  parameters: readonly TtsParameterDescriptor[];
  formats: readonly AudioFormat[];
  languages: readonly string[];
  maxTextLength?: number;
}

/** One synthesis request for a single chunk of spoken text (CdC §23). */
export interface TtsRequest {
  text: string;
  language?: string;
  voice?: string;
  model?: string;
  /** Playback speed applied by the engine, not by the player. */
  speed?: number;
  format?: AudioFormat;
  parameters?: Readonly<Record<string, unknown>>;
}

/** Completed synthesis: an audio payload plus what is known about it. */
export interface AudioResult {
  format: AudioFormat;
  data: Uint8Array;
  durationMs?: number;
  sampleRate?: number;
  channels?: number;
}

/** One slice of a streamed synthesis, for the 0.2 Web Audio player (D2). */
export interface AudioFrame {
  chunkId: string;
  /** Zero-based, strictly increasing within a single stream. */
  sequence: number;
  format: AudioFormat;
  sampleRate: number;
  channels: number;
  data: Uint8Array;
  /** True on the last frame of the stream, which may carry no data. */
  isFinal: boolean;
}

/** Exact material hashed into the audio cache key (CdC §37). */
export interface AudioCacheKeyMaterial {
  providerId: string;
  model?: string;
  voice?: string;
  parameters?: Readonly<Record<string, unknown>>;
  spokenText: string;
}

/** Sidecar metadata stored next to a cached audio file (ADR-004). */
export interface AudioCacheEntry {
  key: string;
  format: AudioFormat;
  bytes: number;
  durationMs?: number;
  providerId: string;
  createdAt: number;
  lastAccessAt: number;
}

/** Replaceable speech engine: local, enterprise or cloud behind one contract (D9). */
export interface TtsProvider {
  readonly id: string;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  getCapabilities(signal?: AbortSignal): Promise<TtsCapabilities>;
  listVoices?(signal?: AbortSignal): Promise<Voice[]>;
  synthesize(request: TtsRequest, signal?: AbortSignal): Promise<AudioResult>;
  synthesizeStream?(
    request: TtsRequest,
    signal?: AbortSignal
  ): AsyncIterable<AudioFrame>;
}
