/**
 * `NarratorProvider` for OpenAI-compatible chat-completion servers (CdC §22:
 * llama.cpp, vLLM, LiteLLM — the enterprise path of ADR-009).
 * `POST {baseUrl}/v1/chat/completions` with `response_format: { type:
 * "json_schema", ... }`; on a 400 response (server too old/limited to
 * understand `json_schema`) it retries once with `response_format: { type:
 * "json_object" }`, which every OpenAI-compatible server that supports
 * structured JSON at all is expected to accept — the system prompt still
 * carries the exact contract either way (`narrationSystemPrompt`), since
 * `json_object` only guarantees valid JSON, not this shape.
 * Every request goes through the injected `EgressGuardHandle` (ADR-010).
 */

import type { ProviderHealth } from "../core/health.js";
import type { NarrationRequest, NarrationResult, NarratorCapabilities, NarratorProvider } from "../core/narration.js";
import type { EgressGuardHandle } from "../net/EgressGuard.js";
import { NARRATION_JSON_SCHEMA, NARRATION_SCHEMA_NAME, narrationSystemPrompt } from "./narrationContract.js";
import { buildBlockPrompt, parseNarration } from "./parseNarration.js";
import { fallbackResult, isAbortLike, messageOf, wasAborted, withTimeout } from "./shared.js";

export interface OpenAICompatibleNarratorOptions {
  /** Defaults to `"openai-compatible"`. */
  id?: string;
  baseUrl: string;
  model: string;
  egress: EgressGuardHandle;
  temperature?: number;
  timeoutMs?: number;
  /** Resolved secret value (`SecretStorage`), never logged. */
  apiKey?: string;
}

type ResponseFormatMode = "json_schema" | "json_object";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function messageOfContent(body: ChatCompletionResponse): string | undefined {
  return body.choices?.[0]?.message?.content;
}

function responseFormatFor(mode: ResponseFormatMode): Record<string, unknown> {
  if (mode === "json_schema") {
    return {
      type: "json_schema",
      json_schema: { name: NARRATION_SCHEMA_NAME, schema: NARRATION_JSON_SCHEMA }
    };
  }
  return { type: "json_object" };
}

export class OpenAICompatibleNarrator implements NarratorProvider {
  readonly id: string;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly egress: EgressGuardHandle;
  private readonly temperature: number | undefined;
  private readonly defaultTimeoutMs: number;
  private readonly apiKey: string | undefined;

  constructor(options: OpenAICompatibleNarratorOptions) {
    this.id = options.id ?? "openai-compatible";
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.model = options.model;
    this.egress = options.egress;
    this.temperature = options.temperature;
    this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.apiKey = options.apiKey;
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    const checkedAt = Date.now();
    const started = Date.now();
    try {
      const response = await this.egress.fetch(`${this.baseUrl}/v1/models`, {
        method: "GET",
        headers: this.headers(),
        ...(signal !== undefined ? { signal } : {})
      });
      const latencyMs = Date.now() - started;
      if (response.status === 401 || response.status === 403) {
        return {
          providerId: this.id,
          status: "unauthorized",
          checkedAt,
          latencyMs,
          endpoint: this.endpointLabel("/v1/models")
        };
      }
      if (!response.ok) {
        return {
          providerId: this.id,
          status: "degraded",
          checkedAt,
          latencyMs,
          endpoint: this.endpointLabel("/v1/models"),
          detail: `HTTP ${response.status}`
        };
      }
      return { providerId: this.id, status: "ok", checkedAt, latencyMs, endpoint: this.endpointLabel("/v1/models") };
    } catch (error) {
      return {
        providerId: this.id,
        status: "unreachable",
        checkedAt,
        endpoint: this.endpointLabel("/v1/models"),
        detail: messageOf(error)
      };
    }
  }

  async getCapabilities(): Promise<NarratorCapabilities> {
    return { structuredOutput: true };
  }

  async transform(request: NarrationRequest, signal?: AbortSignal): Promise<NarrationResult> {
    if (wasAborted(signal)) {
      return fallbackResult(request.segments, "cancelled");
    }

    const timeout = withTimeout(signal, request.timeoutMs ?? this.defaultTimeoutMs);
    try {
      let response = await this.post(request, "json_schema", timeout.controller.signal);
      if (response.status === 400) {
        response = await this.post(request, "json_object", timeout.controller.signal);
      }
      if (!response.ok) {
        return fallbackResult(request.segments, "provider-unavailable");
      }
      const body = (await response.json()) as ChatCompletionResponse;
      const content = messageOfContent(body);
      if (typeof content !== "string") {
        return fallbackResult(request.segments, "invalid-structured-output");
      }
      return parseNarration({ raw: content, group: request.segments }).result;
    } catch (error) {
      if (isAbortLike(error)) {
        return fallbackResult(request.segments, wasAborted(signal) ? "cancelled" : "timeout");
      }
      return fallbackResult(request.segments, "provider-unavailable");
    } finally {
      timeout.cleanup();
    }
  }

  private post(request: NarrationRequest, mode: ResponseFormatMode, signal: AbortSignal): Promise<Response> {
    return this.egress.fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: narrationSystemPrompt(request.style) },
          { role: "user", content: buildBlockPrompt(request.segments) }
        ],
        response_format: responseFormatFor(mode),
        ...(this.temperature !== undefined ? { temperature: this.temperature } : {})
      }),
      signal
    });
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...(this.apiKey !== undefined ? { authorization: `Bearer ${this.apiKey}` } : {}),
      ...extra
    };
  }

  private endpointLabel(path: string): string {
    try {
      const url = new URL(this.baseUrl);
      return `${url.hostname}${path}`;
    } catch {
      return path;
    }
  }
}
