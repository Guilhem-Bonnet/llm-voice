/**
 * Voice profile: the single object a user selects to decide how a document is
 * read. See ADR-004 (`profiles.json` storage) and ADR-005 (provider binding).
 */

import type { NarrationMode } from "./narration.js";
import type { MarkdownPolicy } from "../parser/types.js";

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

/**
 * How the editor reflects playback progress while a profile is active
 * (CdC §49 "Highlight behavior", S8.2's profile editor).
 *
 *  - `"highlight-scroll"` (default when omitted): highlight the spoken
 *    segment and auto-scroll it into view (`HighlightController.show`'s
 *    `reveal = true`, the existing 0.1 behaviour).
 *  - `"highlight"`: highlight only, no auto-scroll — for reading alongside
 *    something else without the viewport jumping.
 *  - `"off"`: no editor decoration at all.
 */
export type SyncMode = "highlight-scroll" | "highlight" | "off";

/** Wraps `SyncMode` under `synchronization.mode` (CdC §18 names this block `synchronization`, not a bare `syncMode`). */
export interface SynchronizationSettings {
  mode: SyncMode;
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
  /**
   * Per-profile Markdown reading policy (CdC §13, §18, §49). Named
   * `markdown` — matching the cahier des charges §18 example verbatim —
   * not `markdownPolicy`. Optional and additive: an existing profile
   * without it keeps using `Pipeline`'s `DEFAULT_MARKDOWN_POLICY`
   * (`segmentationPolicyFor`), exactly like before this field existed.
   */
  markdown?: MarkdownPolicy;
  /**
   * Editor highlight/auto-scroll behaviour (CdC §18 `synchronization`,
   * §49). Optional, `mode` defaults to `"highlight-scroll"` when the whole
   * block is omitted.
   */
  synchronization?: SynchronizationSettings;
}

/**
 * The `profiles.json` document, versioned for future migrations.
 * `1` is the pre-"auto" shape (every non-system default profile explicitly
 * pinned `providerId: "chatterbox"`); `2` is current
 * (`src/profiles/migrations.ts`, `CURRENT_PROFILE_SCHEMA_VERSION`) — a
 * `profiles.json` still at `1` is migrated once, in place, the first time
 * `ProfileRepository.load()` reads it.
 */
export interface ProfileCollection {
  schemaVersion: 1 | 2;
  defaultProfileId: string;
  profiles: VoiceProfile[];
}
