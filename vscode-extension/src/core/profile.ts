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

/** Which TTS engine a profile talks to, and how (D9). */
export interface TtsBinding {
  providerId: string;
  /** Base URL of the speech endpoint; loopback keeps the profile local. */
  baseUrl: string;
  model?: string;
  voice?: string;
  format?: string;
  /** Key name in `SecretStorage`; the secret itself is never in the profile. */
  apiKeyRef?: string;
  parameters?: Record<string, unknown>;
}

/** Optional narrator binding; absent means faithful reading only. */
export interface NarratorBinding {
  providerId: string;
  baseUrl: string;
  model: string;
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
}

/** The `profiles.json` document, versioned for future migrations. */
export interface ProfileCollection {
  schemaVersion: 1;
  defaultProfileId: string;
  profiles: VoiceProfile[];
}
