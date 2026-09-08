/**
 * `KokoroProvider`: ADR-009 niveau 1 fallback (lightweight, 82M-parameter
 * model, CdC §27) — same OpenAI-compatible base as `ChatterboxProvider`
 * (CdC §28), with `speed` as its one real tuning knob and `ff_siwis` as the
 * default French voice (Kokoro's only French voicepack today, CdC §27).
 */

import type { TtsCapabilities, TtsParameterDescriptor, TtsRequest } from "../core/tts.js";
import { OpenAICompatibleTtsProvider, type OpenAICompatibleTtsProviderOptions } from "./OpenAICompatibleTtsProvider.js";

const DEFAULT_ID = "kokoro";

/** CdC §27: French support is limited to a single voicepack, `ff_siwis`. */
export const KOKORO_DEFAULT_FR_VOICE = "ff_siwis";

const PARAMETERS: readonly TtsParameterDescriptor[] = [
  {
    name: "speed",
    label: "Vitesse",
    type: "number",
    default: 1,
    min: 0.5,
    max: 2,
    step: 0.05,
    description: "Vitesse de lecture appliquée par le moteur."
  }
];

export class KokoroProvider extends OpenAICompatibleTtsProvider {
  constructor(options: OpenAICompatibleTtsProviderOptions) {
    super({ id: DEFAULT_ID, ...options });
  }

  override async getCapabilities(signal?: AbortSignal): Promise<TtsCapabilities> {
    const base = await super.getCapabilities(signal);
    return { ...base, parameters: PARAMETERS };
  }

  protected override buildSpeechRequestBody(request: TtsRequest): Record<string, unknown> {
    const base = super.buildSpeechRequestBody(request);
    const voice = request.voice ?? (request.language === "fr" ? KOKORO_DEFAULT_FR_VOICE : undefined);
    return {
      ...base,
      ...(voice !== undefined ? { voice } : {})
    };
  }
}
