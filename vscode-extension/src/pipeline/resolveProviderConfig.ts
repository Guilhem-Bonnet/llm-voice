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
import {
  CHATTERBOX_LOCAL_PRESET,
  KOKORO_LOCAL_PRESET,
  KYUTAI_POCKET_LOCAL_PRESET,
  PIPER_LOCAL_PRESET
} from "../tts/presets.js";

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

/** `localhost` and `127.0.0.1` name the same endpoint; same rule as the profile editor's `normalizeLoopbackUrl`. */
function normalizeLoopbackUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "").replace("://127.0.0.1", "://localhost");
}

/** The setting names no server of its own: it is blank, or still on Chatterbox's port (its shipped default). */
function settingNamesNoServer(settingBaseUrl: string): boolean {
  const normalized = normalizeLoopbackUrl(settingBaseUrl);
  return normalized === "" || normalized === normalizeLoopbackUrl(CHATTERBOX_LOCAL_PRESET.baseUrl);
}

/**
 * `profile.tts.{providerId,baseUrl}` if set, else `llmVoice.tts.{provider,baseUrl}`.
 * `kyutai-pocket` keeps its own port: the setting's default is Chatterbox's.
 * So do `kokoro` and `piper-local`, however they were chosen, unless the
 * setting names another endpoint: `llmVoice.tts.provider` can select them,
 * which leaves that setting as the only place to point at a custom server.
 */
export function resolveTtsConfig(tts: TtsBinding, settings: TtsSettings): ResolvedTtsConfig {
  const providerId = tts.providerId ?? settings.provider;
  let ownDefault: string | undefined;
  if (tts.providerId === "kyutai-pocket") {
    ownDefault = KYUTAI_POCKET_LOCAL_PRESET.baseUrl;
  } else if (settingNamesNoServer(settings.baseUrl)) {
    if (providerId === "kokoro") {
      ownDefault = KOKORO_LOCAL_PRESET.baseUrl;
    } else if (providerId === "piper-local") {
      ownDefault = PIPER_LOCAL_PRESET.baseUrl;
    }
  }
  return {
    providerId,
    baseUrl: tts.baseUrl ?? ownDefault ?? settings.baseUrl
  };
}

/**
 * What identifies one speech engine instance, and therefore its audio (ADR-017
 * §1.5, cause B): the resolved engine, never the written `auto`; its URL; its
 * cloning sample. It is `TtsProvider.id`, which `AudioQueue` hashes into the cache
 * key, and the registry key of `Pipeline.ttsFor`. `system` makes no network call,
 * so a URL left in the settings must not split its audio in two.
 */
export function ttsInstanceKey(resolved: ResolvedTtsConfig, referenceAudioPath: string | undefined): string {
  const endpoint = resolved.providerId === "system" ? "" : resolved.baseUrl;
  const base = `${resolved.providerId}@${endpoint}`;
  return referenceAudioPath !== undefined ? `${base}@ref:${referenceAudioPath}` : base;
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
