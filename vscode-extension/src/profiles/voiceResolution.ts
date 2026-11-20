/**
 * ADR-017 §1.3: the one place that decides who speaks. Pure and vscode-free. The
 * priority is: voice of the character (direction, ADR-015) > voice of the mode >
 * global voice; this file holds the last two, and they replace each other whole,
 * never field by field (causes A and D of ADR-017 §1.1).
 */

import type { GlobalVoice, ReadingMode, TtsBinding } from "../core/profile.js";
import type { TtsParameterDescriptor, Voice } from "../core/tts.js";
import { KYUTAI16_VOICE_CATALOG } from "../tts/kyutai16VoiceCatalog.js";
import { KYUTAI_POCKET_VOICE_CATALOG } from "../tts/kyutaiVoiceCatalog.js";
import { QWEN3_VOICE_CATALOG } from "../tts/qwen3VoiceCatalog.js";
import { PIPER_VOICE_ID } from "../tts/SystemTtsProvider.js";
import { friendlyTtsProviderLabel } from "./ttsProviderLabel.js";

export type VoiceOrigin = "global" | "mode";

/** Every voice the interface can name by id. `estelle` is in both, under the same name and language. */
const NAMED_VOICES: readonly Voice[] = [...KYUTAI_POCKET_VOICE_CATALOG, ...KYUTAI16_VOICE_CATALOG, ...QWEN3_VOICE_CATALOG];

/** A mode as stored, and as it reads: `tts` of `effective` is the voice retained. */
export interface EffectiveMode {
  mode: ReadingMode;
  effective: ReadingMode;
  voiceOrigin: VoiceOrigin;
}

/** Deterministic JSON: keys sorted, `undefined` members dropped. "Same JSON value" is equality of this. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(",")}}`;
}

/**
 * At least one field defined in `tts`. `{ parameters }`, `{ format }` and
 * `{ providerId: "auto" }` all count: there is no in-between state, so no setting
 * kept in a mode can be ignored in silence.
 */
export function hasOwnVoice(mode: Pick<ReadingMode, "tts">): boolean {
  return Object.values(mode.tts).some((value) => value !== undefined);
}

/** The global voice as a `tts` binding: everything but its speed, which is not an engine field. */
export function bindingOfGlobalVoice(voice: GlobalVoice): TtsBinding {
  const { speed: _speed, ...binding } = voice;
  return binding;
}

/** `tts` replaced whole by the global voice when the mode inherits; the mode untouched otherwise. */
export function withEffectiveVoice(mode: ReadingMode, global: GlobalVoice): ReadingMode {
  return hasOwnVoice(mode) ? mode : { ...mode, tts: bindingOfGlobalVoice(global) };
}

/** The full resolution of one mode, as `resolveReading` and `listEffective` return it. */
export function effectiveModeOf(mode: ReadingMode, global: GlobalVoice): EffectiveMode {
  return {
    mode,
    effective: withEffectiveVoice(mode, global),
    voiceOrigin: hasOwnVoice(mode) ? "mode" : "global"
  };
}

/**
 * "Estelle", "Voix automatique": what the interface calls a voice. A sample
 * outranks a voice name at synthesis (`ChatterboxProvider`), so it does here too;
 * otherwise the label would repeat the lie cause A is about.
 */
export function describeVoice(binding: TtsBinding, catalog: readonly Voice[] = NAMED_VOICES): string {
  if (binding.referenceAudio !== undefined) {
    return "Votre échantillon";
  }
  if (binding.voice !== undefined) {
    if (binding.voice === PIPER_VOICE_ID) {
      return "Voix française autonome (Piper)";
    }
    return catalog.find((voice) => voice.id === binding.voice)?.label ?? binding.voice;
  }
  return friendlyTtsProviderLabel(binding.providerId);
}

/** What a catalogue declares about the language of this voice; `undefined` when it says nothing. */
export function declaredVoiceLanguage(
  binding: TtsBinding,
  catalog: readonly Voice[] = NAMED_VOICES
): string | undefined {
  if (binding.voice === undefined || binding.referenceAudio !== undefined) {
    return undefined;
  }
  if (binding.voice === PIPER_VOICE_ID) {
    return "fr";
  }
  return catalog.find((voice) => voice.id === binding.voice)?.language;
}

/**
 * Cause D: an engine and its voice form one whole. The list comes from the engine
 * `resolved` names (never the written `auto`), so that engine is what gets saved
 * with the id. The sample always goes (cause A). Engine settings survive only on
 * the very same engine: they would mean nothing, or something else, on another.
 */
export function bindingForEngineVoice(
  current: TtsBinding,
  resolved: { providerId: string; baseUrl: string },
  voiceId: string
): TtsBinding {
  const sameEngine = current.providerId === resolved.providerId;
  return {
    providerId: resolved.providerId,
    ...(resolved.baseUrl.length > 0 ? { baseUrl: resolved.baseUrl } : {}),
    voice: voiceId,
    ...(sameEngine && current.model !== undefined ? { model: current.model } : {}),
    ...(sameEngine && current.format !== undefined ? { format: current.format } : {}),
    ...(sameEngine && current.apiKeyRef !== undefined ? { apiKeyRef: current.apiKeyRef } : {}),
    ...(sameEngine && current.parameters !== undefined ? { parameters: current.parameters } : {})
  };
}

/** ADR-017 §1.4: speed of the voice × factor of the mode, whichever voice speaks. */
export function requestedSpeed(global: Pick<GlobalVoice, "speed">, mode: Pick<ReadingMode, "playback">): number {
  return global.speed * mode.playback.rate;
}

export type EngineSpeed =
  /** The engine applies it: `speed` goes in the request and the cache key. */
  | { route: "engine"; requested: number; speed: number; limited: boolean }
  /** No way to apply it here: the player route belongs to card 0-007. */
  | { route: "none"; requested: number };

/**
 * ADR-017 §1.4, first choice of the order: `TtsRequest.speed` when the engine
 * declares `speed` in its capabilities, the product brought back within its bounds.
 * A provider-specific parameter of another name is not the same contract.
 */
export function resolveEngineSpeed(requested: number, parameters: readonly TtsParameterDescriptor[]): EngineSpeed {
  const declared = parameters.find((parameter) => parameter.name === "speed" && parameter.type === "number");
  if (declared === undefined) {
    return { route: "none", requested };
  }
  const min = declared.min ?? Number.NEGATIVE_INFINITY;
  const max = declared.max ?? Number.POSITIVE_INFINITY;
  const speed = Math.min(max, Math.max(min, requested));
  return { route: "engine", requested, speed, limited: speed !== requested };
}

/**
 * ADR-017 §1.4: "the gap always shows". The text the header of card 0-007 will
 * display; `undefined` when what is heard is what was asked.
 */
export function describeSpeedGap(speed: EngineSpeed): string | undefined {
  if (speed.route === "none") {
    return speed.requested !== 1 ? "Vitesse non disponible avec cette voix" : undefined;
  }
  if (!speed.limited) {
    return undefined;
  }
  const bound = speed.speed < speed.requested ? "maximum" : "minimum";
  return `×${speed.speed}, ${bound} de cette voix`;
}

/** ADR-017 §1.3 "Langue": the warning, never a block. */
export function formatVoiceLanguageWarning(voiceLabel: string, voiceLanguage: string, modeLanguage: string): string {
  return `LLM Voice : la voix « ${voiceLabel} » parle ${voiceLanguage}, ce mode lit en ${modeLanguage}.`;
}
