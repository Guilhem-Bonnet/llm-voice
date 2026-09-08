/**
 * Voice profile: the single object a user selects to decide how a document is
 * read. See ADR-004 (`profiles.json` storage) and ADR-005 (provider binding).
 */

import type { NarrationMode } from "./narration.js";

/** Chunk granularity: one to three sentences, or one logical block (CdC §33). */
export type ChunkUnit = "sentence" | "block";

/** How the document is cut before synthesis (CdC §33). */
export interface ChunkingOptions {
  unit: ChunkUnit;
  /** Upper bound of sentences per chunk in `sentence` mode. */
  maxSentences: number;
  /** How many chunks are synthesised ahead of playback (CdC §32). */
  prefetchChunks: number;
}

/** Player defaults applied when a session starts. */
export interface PlaybackDefaults {
  rate: number;
  volume: number;
}

/**
 * Which TTS engine a profile talks to, and how (D9).
 *
 * `providerId`/`baseUrl` are optional here: when a profile omits either, the
 * Pipeline falls back to `llmVoice.tts.provider`/`llmVoice.tts.baseUrl` (the
 * setting is the default, a profile that sets its own value overrides it —
 * `resolveTtsConfig`, `src/pipeline/resolveProviderConfig.ts`). The four
 * shipped default profiles still set both explicitly.
 */
export interface TtsBinding {
  providerId?: string;
  /** Base URL of the speech endpoint; loopback keeps the profile local. */
  baseUrl?: string;
  model?: string;
  voice?: string;
  format?: string;
  /** Key name in `SecretStorage`; the secret itself is never in the profile. */
  apiKeyRef?: string;
  parameters?: Record<string, unknown>;
  /**
   * Local filesystem path to a reference sample for voice cloning (CdC §55,
   * `ChatterboxProvider` only). Relative paths are resolved against the
   * extension root (`Pipeline.ttsFor`, `docs/providers.md` "Voice cloning").
   * Optional and backward-compatible: an existing `profiles.json` with no
   * `referenceAudio` still validates and keeps using `voice_mode: "predefined"`.
   */
  referenceAudio?: string;
}

/**
 * Optional narrator binding; absent means faithful reading only.
 *
 * Same fallback as `TtsBinding` above: an omitted `providerId`/`baseUrl`/
 * `model` resolves against `llmVoice.narrator.*` (`resolveNarratorConfig`).
 */
export interface NarratorBinding {
  providerId?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  apiKeyRef?: string;
}

/** A named, user-editable reading configuration (CdC §18). */
export interface VoiceProfile {
  id: string;
  label: string;
  mode: NarrationMode;
  /** BCP-47 language tag used for segmentation and synthesis. */
  language: string;
  tts: TtsBinding;
  narrator?: NarratorBinding;
  chunking: ChunkingOptions;
  playback: PlaybackDefaults;
  description?: string;
  /**
   * Free-form narration prompt (CdC §19, e.g. "Professeur technique").
   * Forwarded verbatim as `NarrationRequest.style`; unused when `mode` is
   * `"faithful"` or no narrator is bound. Optional and additive: existing
   * profiles without it keep validating and behaving exactly as before.
   */
  style?: string;
}

/** The `profiles.json` document, versioned for future migrations. */
export interface ProfileCollection {
  schemaVersion: 1;
  defaultProfileId: string;
  profiles: VoiceProfile[];
}
