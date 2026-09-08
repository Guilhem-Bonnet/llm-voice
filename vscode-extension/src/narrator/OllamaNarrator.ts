/**
 * `NarratorProvider` for Ollama (CdC §21, ADR-005's recommended local
 * narrator): `POST {baseUrl}/api/chat` with `stream: false` and `format` set
 * to the `narration-segments` JSON Schema (Ollama's structured-output
 * support). Every request goes through the injected `EgressGuardHandle`
 * (ADR-010) — this class never calls `fetch` directly.
 */

import type { ProviderHealth } from "../core/health.js";
import type { NarrationRequest, NarrationResult, NarratorCapabilities, NarratorProvider } from "../core/narration.js";
import type { EgressGuardHandle } from "../net/EgressGuard.js";
import { NARRATION_JSON_SCHEMA, narrationSystemPrompt } from "./narrationContract.js";
import { buildBlockPrompt, parseNarration } from "./parseNarration.js";
import { fallbackResult, isAbortLike, messageOf, wasAborted, withTimeout } from "./shared.js";

export interface OllamaNarratorOptions {
  /** Defaults to `"ollama"`. `Pipeline` overrides it to a registry cache key. */
  id?: string;
  baseUrl: string;
  model: string;
  egress: EgressGuardHandle;
  /** Forwarded as `options.temperature`; the model's own default when absent. */
  temperature?: number;
  /** Aborts the request if the model has not answered in time (default 60s). */
  timeoutMs?: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface OllamaChatResponse {
  message?: { content?: string };
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class OllamaNarrator implements NarratorProvider {
  readonly id: string;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly egress: EgressGuardHandle;
  private readonly temperature: number | undefined;
  private readonly defaultTimeoutMs: number;

  constructor(options: OllamaNarratorOptions) {
    this.id = options.id ?? "ollama";
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.model = options.model;
    this.egress = options.egress;
    this.temperature = options.temperature;
    this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** `GET /api/tags`: reachable, and the configured model is actually pulled. */
  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    const checkedAt = Date.now();
    const started = Date.now();
    try {
      const response = await this.egress.fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        ...(signal !== undefined ? { signal } : {})
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        return {
          providerId: this.id,
          status: "degraded",
          checkedAt,
          latencyMs,
          endpoint: this.endpointLabel("/api/tags"),
          detail: `HTTP ${response.status}`
        };
      }
      const body = (await response.json()) as OllamaTagsResponse;
      const names = (body.models ?? []).map((entry) => entry.name ?? entry.model ?? "");
      if (!this.hasModel(names)) {
        return {
          providerId: this.id,
          status: "degraded",
          checkedAt,
          latencyMs,
          endpoint: this.endpointLabel("/api/tags"),
          detail: `model not pulled: ${this.model}`
        };
      }
      return { providerId: this.id, status: "ok", checkedAt, latencyMs, endpoint: this.endpointLabel("/api/tags") };
    } catch (error) {
      return {
        providerId: this.id,
        status: "unreachable",
        checkedAt,
        endpoint: this.endpointLabel("/api/tags"),
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
      const response = await this.egress.fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [
            { role: "system", content: narrationSystemPrompt(request.style) },
            { role: "user", content: buildBlockPrompt(request.segments) }
          ],
          format: NARRATION_JSON_SCHEMA,
          options: this.temperature !== undefined ? { temperature: this.temperature } : {}
        }),
        signal: timeout.controller.signal
      });
      if (!response.ok) {
        return fallbackResult(request.segments, "provider-unavailable");
      }
      const body = (await response.json()) as OllamaChatResponse;
      const content = body.message?.content;
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

  private hasModel(names: readonly string[]): boolean {
    const wanted = this.model.toLowerCase();
    const wantedBase = wanted.split(":")[0];
    return names.some((name) => {
      const lower = name.toLowerCase();
      return lower === wanted || lower.split(":")[0] === wantedBase;
    });
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
