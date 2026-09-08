/**
 * `ChatterboxProvider`: the ADR-009 niveau 1 default (`Chatterbox
 * Multilingual V3`, CdC §24-25, §28: `ChatterboxProvider extends
 * OpenAICompatibleTtsProvider`).
 *
 * Adds the engine-specific tuning parameters the community
 * `Chatterbox-TTS-Server` accepts on top of the OpenAI-compatible
 * `/v1/audio/speech` body (`exaggeration`, `cfg_weight`, `temperature`,
 * `language_id`), and falls back to the server's own `/get_predefined_voices`
 * route when `/v1/audio/voices` 404s (older/community builds only expose the
 * former). `health()` reads an optional `{"status": "..."}` body on
 * `/health` so a model still warming up reports `degraded`, not a bare `ok`.
 */

import type { ProviderHealth } from "../core/health.js";
import type { TtsCapabilities, TtsParameterDescriptor, TtsRequest, Voice } from "../core/tts.js";
import {
  OpenAICompatibleTtsProvider,
  messageOf,
  type OpenAICompatibleTtsProviderOptions
} from "./OpenAICompatibleTtsProvider.js";

const DEFAULT_ID = "chatterbox";

/** CdC §24: the tunables Chatterbox exposes beyond the base OpenAI-compatible request. */
const PARAMETERS: readonly TtsParameterDescriptor[] = [
  {
    name: "exaggeration",
    label: "Exaggeration",
    type: "number",
    default: 0.5,
    min: 0,
    max: 2,
    step: 0.05,
    description: "Expressivité de la voix générée."
  },
  {
    name: "cfg_weight",
    label: "CFG weight",
    type: "number",
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    description: "Fidélité au conditionnement de voix."
  },
  {
    name: "temperature",
    label: "Temperature",
    type: "number",
    default: 0.8,
    min: 0.05,
    max: 2,
    step: 0.05,
    description: "Variabilité de la génération."
  },
  {
    name: "language_id",
    label: "Langue",
    type: "string",
    default: "fr",
    description: "Code de langue transmis au modèle (ex. \"fr\", \"en\")."
  }
];

interface PredefinedVoiceEntry {
  voice_id?: string;
  id?: string;
  name?: string;
  display_name?: string;
  language?: string;
}

function numberParam(parameters: Readonly<Record<string, unknown>> | undefined, name: string): number | undefined {
  const value = parameters?.[name];
  return typeof value === "number" ? value : undefined;
}

export class ChatterboxProvider extends OpenAICompatibleTtsProvider {
  constructor(options: OpenAICompatibleTtsProviderOptions) {
    super({ id: DEFAULT_ID, ...options });
  }

  override async health(signal?: AbortSignal): Promise<ProviderHealth> {
    const checkedAt = Date.now();
    const started = Date.now();
    try {
      const response = await this.egress.fetch(`${this.baseUrl}/health`, {
        method: "GET",
        headers: this.headers(),
        ...(signal !== undefined ? { signal } : {})
      });
      const latencyMs = Date.now() - started;
      if (response.ok) {
        const reported = await this.reportedStatus(response);
        if (reported === "loading") {
          return {
            providerId: this.id,
            status: "degraded",
            checkedAt,
            latencyMs,
            endpoint: this.endpointLabel("/health"),
            detail: "loading"
          };
        }
        return { providerId: this.id, status: "ok", checkedAt, latencyMs, endpoint: this.endpointLabel("/health") };
      }
    } catch {
      // Fall through to the /v1/audio/voices probe below, like the base class.
    }
    // `/health` missing or erroring: a server that skipped it still answers
    // `/v1/audio/voices` — same fallback contract as the base class.
    return super.health(signal);
  }

  private async reportedStatus(response: Response): Promise<string | undefined> {
    try {
      const body = (await response.clone().json()) as { status?: string } | undefined;
      return body?.status?.toLowerCase();
    } catch {
      return undefined;
    }
  }

  override async listVoices(signal?: AbortSignal): Promise<Voice[]> {
    const response = await this.egress.fetch(`${this.baseUrl}/v1/audio/voices`, {
      method: "GET",
      headers: this.headers(),
      ...(signal !== undefined ? { signal } : {})
    });
    if (response.ok) {
      return this.parseVoicesResponse(await response.json());
    }
    if (response.status === 404) {
      return this.listPredefinedVoices(signal);
    }
    return [];
  }

  /** Repli communautaire quand `/v1/audio/voices` n'existe pas (CdC §25). */
  private async listPredefinedVoices(signal?: AbortSignal): Promise<Voice[]> {
    try {
      const response = await this.egress.fetch(`${this.baseUrl}/get_predefined_voices`, {
        method: "GET",
        headers: this.headers(),
        ...(signal !== undefined ? { signal } : {})
      });
      if (!response.ok) {
        return [];
      }
      const body = (await response.json()) as PredefinedVoiceEntry[] | { voices?: PredefinedVoiceEntry[] };
      const entries = Array.isArray(body) ? body : (body.voices ?? []);
      return entries
        .map((entry) => {
          const id = entry.voice_id ?? entry.id;
          if (id === undefined) {
            return undefined;
          }
          return {
            id,
            label: entry.display_name ?? entry.name ?? id,
            ...(entry.language !== undefined ? { language: entry.language } : {})
          };
        })
        .filter((voice): voice is Voice => voice !== undefined);
    } catch (error) {
      void messageOf(error); // never let a fallback probe crash synthesis (ADR-005 degraded mode)
      return [];
    }
  }

  override async getCapabilities(signal?: AbortSignal): Promise<TtsCapabilities> {
    const base = await super.getCapabilities(signal);
    return { ...base, parameters: PARAMETERS };
  }

  protected override buildSpeechRequestBody(request: TtsRequest): Record<string, unknown> {
    const base = super.buildSpeechRequestBody(request);
    const parameters = request.parameters;
    const exaggeration = numberParam(parameters, "exaggeration");
    const cfgWeight = numberParam(parameters, "cfg_weight");
    const temperature = numberParam(parameters, "temperature");
    const languageId = request.language ?? (typeof parameters?.["language_id"] === "string" ? (parameters["language_id"] as string) : undefined);
    return {
      ...base,
      ...(languageId !== undefined ? { language_id: languageId } : {}),
      ...(exaggeration !== undefined ? { exaggeration } : {}),
      ...(cfgWeight !== undefined ? { cfg_weight: cfgWeight } : {}),
      ...(temperature !== undefined ? { temperature } : {})
    };
  }
}
