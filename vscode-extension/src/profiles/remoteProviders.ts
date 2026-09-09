/**
 * Naming and discovery for `SecretStorage`-backed provider API keys
 * (AC-17, AC-SEC-08): `LLM Voice: Set/Clear Provider API Key` never lets a
 * key land in `globalState`/`workspaceState`, only `context.secrets`, keyed
 * as `llmVoice.apiKey.<providerId>`.
 */

import type { VoiceProfile } from "../core/profile.js";
import { isLoopbackUrl } from "../core/profile.schema.js";
import { OPENAI_COMPATIBLE_PRESET } from "../tts/presets.js";

/** `SecretStorage` key a provider's API key is stored under. */
export function apiKeySecretKey(providerId: string): string {
  return `llmVoice.apiKey.${providerId}`;
}

/**
 * Distinct `providerId`s bound to a non-loopback `baseUrl` across every
 * profile (TTS or narrator side) — the candidates `Set/Clear Provider API
 * Key` offers in its Quick Pick. Falls back to the generic OpenAI-compatible
 * preset id so the command is never a dead end before any remote profile
 * exists (ADR-009 niveaux 2-3).
 */
export function collectRemoteProviderIds(profiles: readonly VoiceProfile[]): string[] {
  const ids = new Set<string>();
  for (const profile of profiles) {
    const tts = profile.tts;
    if (tts.baseUrl !== undefined && tts.providerId !== undefined && !isLoopbackUrl(tts.baseUrl)) {
      ids.add(tts.providerId);
    }
    const narrator = profile.narrator;
    if (
      narrator?.baseUrl !== undefined &&
      narrator.providerId !== undefined &&
      !isLoopbackUrl(narrator.baseUrl)
    ) {
      ids.add(narrator.providerId);
    }
  }
  if (ids.size === 0) {
    ids.add(OPENAI_COMPATIBLE_PRESET.id);
  }
  return [...ids].sort();
}
