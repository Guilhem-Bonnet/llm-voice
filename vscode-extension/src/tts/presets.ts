/**
 * Named TTS presets covering ADR-009's three tiers on one contract: a preset
 * is pure data (`{kind, baseUrl, model?, voice?, remote}`) plus
 * `createTtsProvider`, the one factory that turns a preset (or an arbitrary
 * `baseUrl` for the generic tier) into a concrete `TtsProvider`. Profiles and
 * `llmVoice.tts.*` settings only ever name a preset id or a `providerId`
 * string — never a class (ADR-005).
 */

import type { TtsProvider } from "../core/tts.js";
import type { EgressGuardHandle } from "../net/EgressGuard.js";
import { ChatterboxProvider } from "./ChatterboxProvider.js";
import { KokoroProvider, KOKORO_DEFAULT_FR_VOICE } from "./KokoroProvider.js";
import { OpenAICompatibleTtsProvider } from "./OpenAICompatibleTtsProvider.js";

/** Which concrete class a preset instantiates; never guessed from an id (ADR-005). */
export type TtsPresetKind = "chatterbox" | "kokoro" | "openai-compatible";

export interface TtsProviderPreset {
  id: string;
  label: string;
  kind: TtsPresetKind;
  baseUrl: string;
  model?: string;
  voice?: string;
  /** ADR-009: false for `localhost`-only tiers 1/1b, true for tier 2/3. */
  remote: boolean;
}

/** ADR-009 niveau 1: Chatterbox Multilingual V3 on its RDNA4 container default port. */
export const CHATTERBOX_LOCAL_PRESET: TtsProviderPreset = {
  id: "chatterbox-local",
  label: "Chatterbox (local)",
  kind: "chatterbox",
  baseUrl: "http://localhost:8004",
  voice: "default",
  remote: false
};

/** ADR-009 niveau 1: Kokoro, the lightweight fallback (CdC §27). */
export const KOKORO_LOCAL_PRESET: TtsProviderPreset = {
  id: "kokoro-local",
  label: "Kokoro (local)",
  kind: "kokoro",
  baseUrl: "http://localhost:8880",
  voice: KOKORO_DEFAULT_FR_VOICE,
  remote: false
};

/** ADR-009 niveau 1b: Piper behind an OpenAI-compatible wrapper, no GPU required. */
export const PIPER_LOCAL_PRESET: TtsProviderPreset = {
  id: "piper-local",
  label: "Piper (local, sans installation)",
  kind: "openai-compatible",
  baseUrl: "http://localhost:5000",
  voice: "fr_FR-siwis-medium",
  remote: false
};

/** ADR-009 niveaux 2/3: generic OpenAI-compatible endpoint (enterprise or cloud). */
export const OPENAI_COMPATIBLE_PRESET: TtsProviderPreset = {
  id: "openai-compatible",
  label: "Compatible OpenAI (générique)",
  kind: "openai-compatible",
  baseUrl: "",
  remote: true
};

export const TTS_PROVIDER_PRESETS: readonly TtsProviderPreset[] = [
  CHATTERBOX_LOCAL_PRESET,
  KOKORO_LOCAL_PRESET,
  PIPER_LOCAL_PRESET,
  OPENAI_COMPATIBLE_PRESET
];

export function findTtsProviderPreset(id: string): TtsProviderPreset | undefined {
  return TTS_PROVIDER_PRESETS.find((preset) => preset.id === id);
}

export interface CreateTtsProviderOptions {
  /** Overrides `preset.baseUrl`; a profile's own `tts.baseUrl` always wins. */
  baseUrl?: string;
  /** Provider id stored in the cache key and shown in the UI; defaults per class. */
  id?: string;
  egress: EgressGuardHandle;
  /** Resolved secret value (`SecretStorage`, ADR-004/D9 niveau 2-3), never logged. */
  apiKey?: string;
}

/**
 * Instantiates the `TtsProvider` a preset (or a bare `kind`) describes. The
 * one place that maps `TtsPresetKind` to a class, so the rest of the
 * codebase only ever handles `TtsProvider` (ADR-005).
 */
export function createTtsProvider(
  preset: Pick<TtsProviderPreset, "kind" | "baseUrl">,
  options: CreateTtsProviderOptions
): TtsProvider {
  const baseUrl = options.baseUrl ?? preset.baseUrl;
  const providerOptions = {
    baseUrl,
    egress: options.egress,
    ...(options.id !== undefined ? { id: options.id } : {}),
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {})
  };
  switch (preset.kind) {
    case "chatterbox":
      return new ChatterboxProvider(providerOptions);
    case "kokoro":
      return new KokoroProvider(providerOptions);
    case "openai-compatible":
      return new OpenAICompatibleTtsProvider(providerOptions);
    default: {
      const exhaustive: never = preset.kind;
      return exhaustive;
    }
  }
}

/** `TtsPresetKind` for a resolved `providerId` (`chatterbox`, `kokoro`, ...), else generic. */
export function presetKindForProviderId(providerId: string): TtsPresetKind {
  if (providerId === "chatterbox") {
    return "chatterbox";
  }
  if (providerId === "kokoro") {
    return "kokoro";
  }
  return "openai-compatible";
}
