/**
 * fix(review): `llmVoice.tts.baseUrl`/`llmVoice.tts.provider` (and the
 * `llmVoice.narrator.*` equivalents) were declared in `package.json#contributes.configuration`
 * but never read anywhere — every shipped profile hardcodes its own
 * `tts.baseUrl`/`tts.providerId`, so the settings had no effect regardless of
 * what a user set them to.
 *
 * These two pure functions are the resolution the Pipeline now runs before
 * touching a provider: **the setting is the default, the profile overrides
 * it field by field when it states its own value** (`profile.tts.baseUrl ??
 * settings.baseUrl`). `TtsBinding`/`NarratorBinding` (`src/core/profile.ts`)
 * made `providerId`/`baseUrl`/`model` optional for exactly this — a profile
 * no longer has to restate the default to be valid.
 */

import type { NarratorBinding, TtsBinding } from "../core/profile.js";

/** Snapshot of `llmVoice.tts.*`, read once by the caller (`vscode.workspace.getConfiguration`). */
export interface TtsSettings {
  provider: string;
  baseUrl: string;
}

/** Snapshot of `llmVoice.narrator.*`. */
export interface NarratorSettings {
  provider: string;
  baseUrl: string;
  model: string;
}

export interface ResolvedTtsConfig {
  providerId: string;
  baseUrl: string;
}

export interface ResolvedNarratorConfig {
  providerId: string;
  baseUrl: string;
  model: string;
}

/** `profile.tts.{providerId,baseUrl}` if set, else `llmVoice.tts.{provider,baseUrl}`. */
export function resolveTtsConfig(tts: TtsBinding, settings: TtsSettings): ResolvedTtsConfig {
  return {
    providerId: tts.providerId ?? settings.provider,
    baseUrl: tts.baseUrl ?? settings.baseUrl
  };
}

/**
 * Same fallback for the narrator binding. `undefined` in ⇒ `undefined` out:
 * a profile with no narrator at all still means "faithful reading only"
 * (ADR-005) — settings never conjure a narrator binding out of nothing.
 */
export function resolveNarratorConfig(
  narrator: NarratorBinding | undefined,
  settings: NarratorSettings
): ResolvedNarratorConfig | undefined {
  if (narrator === undefined) {
    return undefined;
  }
  return {
    providerId: narrator.providerId ?? settings.provider,
    baseUrl: narrator.baseUrl ?? settings.baseUrl,
    model: narrator.model ?? settings.model
  };
}
