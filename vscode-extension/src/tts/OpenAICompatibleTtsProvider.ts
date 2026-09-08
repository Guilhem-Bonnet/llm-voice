/**
 * The one production `TtsProvider` for this slice (ADR-005, D9): a single
 * OpenAI-compatible speech endpoint, parameterised by `baseUrl`, so local
 * (Chatterbox/Kokoro/...), enterprise and cloud engines share the exact same
 * code. Every request goes through the injected `EgressGuardHandle` — this
 * class never calls `fetch` directly (ADR-010).
 *
 * `health()` tries `GET {baseUrl}/health` first (the common convenience
 * endpoint), and falls back to `GET {baseUrl}/v1/audio/voices` — the one
 * endpoint every OpenAI-compatible server is guaranteed to expose — when the
 * first one 404s or otherwise fails, so a server that skipped `/health`
 * still reports something better than `unreachable`.
 */

import type { ProviderHealth } from "../core/health.js";
import type { AudioResult, TtsCapabilities, TtsProvider, TtsRequest, Voice } from "../core/tts.js";
import type { EgressGuardHandle } from "../net/EgressGuard.js";

export interface OpenAICompatibleTtsProviderOptions {
  /** Defaults to `"openai-compatible"`, matching `DEFAULT_PROFILE.tts.providerId`. */
  id?: string;
  baseUrl: string;
  egress: EgressGuardHandle;
  /** Resolved secret value (from `SecretStorage`, ADR-004), never logged. */
  apiKey?: string;
}

interface VoicesResponseBody {
  voices?: Array<{ id: string; name?: string; language?: string }>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class OpenAICompatibleTtsProvider implements TtsProvider {
  readonly id: string;

  private readonly baseUrl: string;
  private readonly egress: EgressGuardHandle;
  private readonly apiKey: string | undefined;

  constructor(options: OpenAICompatibleTtsProviderOptions) {
    this.id = options.id ?? "openai-compatible";
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.egress = options.egress;
    this.apiKey = options.apiKey;
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    const checkedAt = Date.now();
    const started = Date.now();
    try {
      let response = await this.egress.fetch(`${this.baseUrl}/health`, {
        method: "GET",
        headers: this.headers(),
        ...(signal !== undefined ? { signal } : {})
      });
      if (!response.ok) {
        response = await this.egress.fetch(`${this.baseUrl}/v1/audio/voices`, {
          method: "GET",
          headers: this.headers(),
          ...(signal !== undefined ? { signal } : {})
        });
      }
      const latencyMs = Date.now() - started;
      if (response.ok) {
        return { providerId: this.id, status: "ok", checkedAt, latencyMs, endpoint: this.endpointLabel("/health") };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          providerId: this.id,
          status: "unauthorized",
          checkedAt,
          latencyMs,
          endpoint: this.endpointLabel("/health")
        };
      }
      return {
        providerId: this.id,
        status: "degraded",
        checkedAt,
        latencyMs,
        endpoint: this.endpointLabel("/health"),
        detail: `HTTP ${response.status}`
      };
    } catch (error) {
      return {
        providerId: this.id,
        status: "unreachable",
        checkedAt,
        endpoint: this.endpointLabel("/health"),
        detail: messageOf(error)
      };
    }
  }

  async getCapabilities(signal?: AbortSignal): Promise<TtsCapabilities> {
    const voices = await this.listVoices(signal).catch(() => []);
    return {
      streaming: false,
      voices,
      parameters: [],
      formats: ["wav"],
      languages: []
    };
  }

  async listVoices(signal?: AbortSignal): Promise<Voice[]> {
    const response = await this.egress.fetch(`${this.baseUrl}/v1/audio/voices`, {
      method: "GET",
      headers: this.headers(),
      ...(signal !== undefined ? { signal } : {})
    });
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as VoicesResponseBody;
    return (body.voices ?? []).map((voice) => ({
      id: voice.id,
      label: voice.name ?? voice.id,
      ...(voice.language !== undefined ? { language: voice.language } : {})
    }));
  }

  async synthesize(request: TtsRequest, signal?: AbortSignal): Promise<AudioResult> {
    const response = await this.egress.fetch(`${this.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        ...(request.model !== undefined ? { model: request.model } : {}),
        ...(request.voice !== undefined ? { voice: request.voice } : {}),
        input: request.text,
        response_format: "wav",
        ...(request.speed !== undefined ? { speed: request.speed } : {})
      }),
      ...(signal !== undefined ? { signal } : {})
    });
    if (!response.ok) {
      throw new Error(
        `OpenAICompatibleTtsProvider: HTTP ${response.status} from ${this.baseUrl}/v1/audio/speech`
      );
    }
    const buffer = await response.arrayBuffer();
    return { format: "wav", data: new Uint8Array(buffer) };
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...(this.apiKey !== undefined ? { authorization: `Bearer ${this.apiKey}` } : {}),
      ...extra
    };
  }

  /** Host + path only (D10): never a query string, never a body. */
  private endpointLabel(path: string): string {
    try {
      const url = new URL(this.baseUrl);
      return `${url.hostname}${path}`;
    } catch {
      return path;
    }
  }
}
