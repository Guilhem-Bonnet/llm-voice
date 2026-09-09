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
import type { ProviderHealth } from "../core/health.js";

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

/**
 * S7.1 / `llmVoice.tts.provider: "auto"` (the shipped default, ADR-009):
 * a candidate this extension can automatically fall back to, in the order
 * it should be tried. `health` is a thunk (not a bound method reference) so
 * a test double never has to be an actual `TtsProvider`.
 */
export interface AutoTtsCandidate {
  providerId: string;
  baseUrl: string;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
}

/** `ok` (fully up) or `degraded` (e.g. "loading", CdC §51) both count as "usable now" — only `unreachable`/`unauthorized`/`unverified` fall through to the next candidate. */
export function isHealthyEnough(health: ProviderHealth): boolean {
  return health.status === "ok" || health.status === "degraded";
}

/**
 * ADR-009's auto-selection order (S7.1): the first candidate whose
 * `health()` resolves "usable now" wins; a candidate whose `health()`
 * itself throws is treated exactly like `unreachable` (never lets one
 * misbehaving probe abort the whole selection — same spirit as
 * `probeHealth`, `src/tts/ProviderRegistry.ts`). `fallback` (always
 * `{ providerId: "system", baseUrl: "" }` in production, ADR-009 §"1b" —
 * `SystemTtsProvider` needs no server, so it is always eligible) is
 * returned when every candidate is unusable.
 */
export async function selectAutoTtsProvider(
  candidates: readonly AutoTtsCandidate[],
  fallback: ResolvedTtsConfig,
  signal?: AbortSignal
): Promise<ResolvedTtsConfig> {
  for (const candidate of candidates) {
    try {
      const health = await candidate.health(signal);
      if (isHealthyEnough(health)) {
        return { providerId: candidate.providerId, baseUrl: candidate.baseUrl };
      }
    } catch {
      // Treated as unreachable: try the next candidate.
    }
  }
  return fallback;
}
