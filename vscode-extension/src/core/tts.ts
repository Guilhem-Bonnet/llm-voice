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
  /** Path of a short sample, relative to the extension's `media/` folder. */
  preview?: string;
  /** Where the voice comes from, when a catalogue has read its licence. */
  licence?: VoiceLicence;
}

export interface VoiceLicence {
  dataset: string;
  spdx: string;
  sourceUrl: string;
  attributionRequired: boolean;
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

/**
 * What an engine can carry of a reading direction (ADR-015 §5.2). Read by the
 * translator (`src/direction/translator`), never by an id or `instanceof`:
 * a parameter that is not declared here is ignored and traced.
 *
 * `parameter` names a key of `TtsRequest.parameters`, except `"speed"` which
 * is the top-level `TtsRequest.speed` field.
 */
export interface DirectionCapabilities {
  /** Carries the intensity: parameter name and engine calibration (measured on the bench). */
  readonly intensity?: { parameter: string; neutral: number; safeMax: number };
  /** Carries the stability of the performance (e.g. `cfg_weight`), same principle. */
  readonly stability?: { parameter: string; neutral: number; min: number; max: number };
  /** Carries the tempo; absent = tempo ignored and traced. */
  readonly tempo?: { parameter: string; min: number; max: number };
  /** Accepts a natural-language playing note (instruction-following engine, ADR-015 annex A). */
  readonly instructions: boolean;
  /** Non-verbal tags the engine renders; `[]` = ignored. */
  readonly nonverbal: readonly string[];
  /** Runs on the GPU (drives the game-mode fallback, ADR-015 §8). */
  readonly usesGpu: boolean;
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
  /** ADR-015: optional and additive; absent = "voice and pauses only". */
  direction?: DirectionCapabilities;
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
  /** Only when the engine applies the speed: the audio differs (ADR-017 §1.5). */
  speed?: number;
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
  /**
   * What the audio cache should identify this engine by when `id` is not enough:
   * one instance that may speak through different engines over time
   * (`SystemTtsProvider`, ADR-017 "Ce qui reste ouvert" 1). Defaults to `id`.
   */
  cacheIdentity?(signal?: AbortSignal): Promise<string>;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  getCapabilities(signal?: AbortSignal): Promise<TtsCapabilities>;
  listVoices?(signal?: AbortSignal): Promise<Voice[]>;
  synthesize(request: TtsRequest, signal?: AbortSignal): Promise<AudioResult>;
  synthesizeStream?(
    request: TtsRequest,
    signal?: AbortSignal
  ): AsyncIterable<AudioFrame>;
}
