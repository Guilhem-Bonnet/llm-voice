/**
 * `DirectionLlm` for Ollama (ADR-015 §2, ADR-010), the same approach as
 * `OllamaNarrator`: `POST {baseUrl}/api/chat` with `stream: false` and `format`
 * set to a JSON Schema (structured outputs). Every request goes through the
 * injected `EgressGuardHandle`: this class never calls a global `fetch`, and a
 * destination that is not loopback is refused by the guard before any byte
 * leaves (the refusal surfaces as `EgressDeniedError`, classified
 * `egress-denied` by the pipeline, which then suspends direction).
 *
 * - The answer is parsed from JSON and returned **not validated**: the analyst
 *   schema and the partition controller validate.
 * - Failures reject with `DirectionLlmError` (HTTP error, unreachable server,
 *   answer that is not JSON, timeout, cancel) or with the guard's own error.
 * - `num_ctx` is set explicitly: Ollama's default context is small and it
 *   silently drops the start of a longer prompt (the instructions). The prompt
 *   size reported back (`onCall`) tells when the window is close to it.
 * - `keep_alive` keeps the model resident between windows.
 * - `onCall` receives counts and durations only, never a text.
 */

import { isAbortLike, messageOf, wasAborted, withTimeout } from "../../narrator/shared.js";
import { EgressDeniedError, type EgressGuardHandle } from "../../net/EgressGuard.js";
import { DirectionLlmError, type AnalysisLlmRequest, type DirectionDegradedReason, type DirectionLlm, type DirectionLlmRequest } from "./llm.js";
import {
  ANALYSIS_OUTPUT_JSON_SCHEMA,
  DIRECTION_OUTPUT_JSON_SCHEMA,
  DIRECTION_PROMPT_VERSION,
  analystSystemPrompt,
  analystUserPrompt,
  directorSystemPrompt,
  directorUserPrompt
} from "./prompts/index.js";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_DIRECTION_MODEL = "qwen2.5:7b";
export const DEFAULT_KEEP_ALIVE = "10m";
/** Prompt window: a director call carries K + W + L segments, the bible and the instructions. */
export const DEFAULT_NUM_CTX = 8192;
export const DEFAULT_DIRECTION_TEMPERATURE = 0.2;
/** Client-side ceiling of one request; the pipeline's own deadlines are shorter. */
export const DEFAULT_OLLAMA_TIMEOUT_MS = 60_000;

/** What one call cost, without any content. */
export interface OllamaCallStats {
  readonly kind: "analyze" | "direct";
  readonly ok: boolean;
  /** `"ok"` or the degraded reason the call ended with. */
  readonly outcome: "ok" | DirectionDegradedReason;
  readonly durationMs: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  /** Model load time (nanoseconds converted), non-zero on a cold model. */
  readonly loadMs?: number;
  /** Server-side total duration (`total_duration`); the gap with `durationMs` is client and guard overhead. */
  readonly totalMs?: number;
  readonly promptEvalMs?: number;
  readonly evalMs?: number;
  /** The model stopped on the token limit: the JSON is probably cut. */
  readonly truncated: boolean;
  /** The prompt filled the context (`num_ctx`): Ollama may have dropped its start. */
  readonly contextSaturated: boolean;
}

export interface OllamaDirectionLlmOptions {
  /** Defaults to `"ollama-direction"`. */
  readonly id?: string;
  /** Defaults to `http://127.0.0.1:11434`. */
  readonly baseUrl?: string;
  /** Defaults to `qwen2.5:7b`. */
  readonly model?: string;
  readonly egress: EgressGuardHandle;
  /** Defaults to 0.2: a score is a structured document, not free prose. */
  readonly temperature?: number;
  readonly numCtx?: number;
  /** Ollama duration string (`"10m"`) or seconds; `-1` keeps the model loaded. Defaults to `"10m"`. */
  readonly keepAlive?: string | number;
  readonly seed?: number;
  readonly timeoutMs?: number;
  readonly onCall?: (stats: OllamaCallStats) => void;
}

interface OllamaChatResponse {
  readonly message?: { readonly content?: unknown };
  readonly done_reason?: string;
  readonly total_duration?: number;
  readonly load_duration?: number;
  readonly prompt_eval_count?: number;
  readonly prompt_eval_duration?: number;
  readonly eval_count?: number;
  readonly eval_duration?: number;
}

type JsonSchema = { readonly [key: string]: unknown };

const nsToMs = (value: number | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value / 1e5) / 10 : undefined;

const countOf = (value: number | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** `{ analysis, characters: [{ traits: [{key, value}] }] }` to the record form `RawAnalysisSchema` reads. */
export function foldAnalysisTraits(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const answer = raw as { characters?: unknown };
  if (!Array.isArray(answer.characters)) {
    return raw;
  }
  const characters = answer.characters.map((sheet: unknown) => {
    if (typeof sheet !== "object" || sheet === null) {
      return sheet;
    }
    const entry = sheet as { traits?: unknown };
    if (!Array.isArray(entry.traits)) {
      return sheet;
    }
    const traits: Record<string, string> = {};
    for (const pair of entry.traits as unknown[]) {
      const { key, value } = (typeof pair === "object" && pair !== null ? pair : {}) as { key?: unknown; value?: unknown };
      if (typeof key === "string" && key !== "__proto__" && typeof value === "string") {
        traits[key] = value;
      }
    }
    return { ...entry, traits };
  });
  return { ...answer, characters };
}

/** The content of a chat answer, tolerating a Markdown fence around the JSON some models add despite `format`. */
function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  try {
    return JSON.parse(fenced?.[1] ?? trimmed);
  } catch {
    throw new DirectionLlmError("invalid-structured-output", "the model's answer is not JSON");
  }
}

export class OllamaDirectionLlm implements DirectionLlm {
  readonly id: string;
  readonly model: string;
  readonly promptVersion: string = DIRECTION_PROMPT_VERSION;

  private readonly baseUrl: string;
  private readonly egress: EgressGuardHandle;
  private readonly temperature: number;
  private readonly numCtx: number;
  private readonly keepAlive: string | number;
  private readonly seed: number | undefined;
  private readonly timeoutMs: number;
  private readonly onCall: ((stats: OllamaCallStats) => void) | undefined;

  constructor(options: OllamaDirectionLlmOptions) {
    this.id = options.id ?? "ollama-direction";
    this.baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
    this.model = options.model ?? DEFAULT_DIRECTION_MODEL;
    this.egress = options.egress;
    this.temperature = options.temperature ?? DEFAULT_DIRECTION_TEMPERATURE;
    this.numCtx = options.numCtx ?? DEFAULT_NUM_CTX;
    this.keepAlive = options.keepAlive ?? DEFAULT_KEEP_ALIVE;
    this.seed = options.seed;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
    this.onCall = options.onCall;
  }

  async analyze(request: AnalysisLlmRequest, signal?: AbortSignal): Promise<unknown> {
    const raw = await this.chat("analyze", analystSystemPrompt(), analystUserPrompt(request), ANALYSIS_OUTPUT_JSON_SCHEMA, signal);
    return foldAnalysisTraits(raw);
  }

  direct(request: DirectionLlmRequest, signal?: AbortSignal): Promise<unknown> {
    return this.chat("direct", directorSystemPrompt(), directorUserPrompt(request), DIRECTION_OUTPUT_JSON_SCHEMA, signal);
  }

  private async chat(
    kind: OllamaCallStats["kind"],
    system: string,
    user: string,
    format: JsonSchema,
    signal: AbortSignal | undefined
  ): Promise<unknown> {
    if (wasAborted(signal)) {
      throw new DirectionLlmError("cancelled");
    }
    const started = Date.now();
    const timeout = withTimeout(signal, this.timeoutMs);
    let stats: Partial<OllamaCallStats> = {};
    let outcome: OllamaCallStats["outcome"] = "ok";
    try {
      const response = await this.egress.fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          keep_alive: this.keepAlive,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ],
          format,
          options: {
            temperature: this.temperature,
            num_ctx: this.numCtx,
            ...(this.seed !== undefined ? { seed: this.seed } : {})
          }
        }),
        signal: timeout.controller.signal
      });
      if (!response.ok) {
        throw new DirectionLlmError("provider-unavailable", `HTTP ${response.status}`);
      }
      const body = (await response.json()) as OllamaChatResponse;
      const promptTokens = countOf(body.prompt_eval_count);
      const loadMs = nsToMs(body.load_duration);
      const totalMs = nsToMs(body.total_duration);
      const promptEvalMs = nsToMs(body.prompt_eval_duration);
      const evalMs = nsToMs(body.eval_duration);
      const completionTokens = countOf(body.eval_count);
      stats = {
        ...(promptTokens !== undefined ? { promptTokens } : {}),
        ...(completionTokens !== undefined ? { completionTokens } : {}),
        ...(loadMs !== undefined ? { loadMs } : {}),
        ...(totalMs !== undefined ? { totalMs } : {}),
        ...(promptEvalMs !== undefined ? { promptEvalMs } : {}),
        ...(evalMs !== undefined ? { evalMs } : {}),
        truncated: body.done_reason === "length",
        contextSaturated: promptTokens !== undefined && promptTokens >= this.numCtx * 0.98
      };
      const content = body.message?.content;
      if (typeof content !== "string") {
        throw new DirectionLlmError("invalid-structured-output", "no message content");
      }
      return parseJsonContent(content);
    } catch (error) {
      const failure = this.classify(error, signal);
      outcome = failure instanceof DirectionLlmError ? failure.reason : "egress-denied";
      throw failure;
    } finally {
      timeout.cleanup();
      this.onCall?.({
        kind,
        ok: outcome === "ok",
        outcome,
        durationMs: Date.now() - started,
        truncated: false,
        contextSaturated: false,
        ...stats
      });
    }
  }

  /** The guard's refusal is passed on as is; everything else becomes a `DirectionLlmError`. */
  private classify(error: unknown, signal: AbortSignal | undefined): Error {
    if (error instanceof DirectionLlmError) {
      return error;
    }
    if (error instanceof EgressDeniedError) {
      return error;
    }
    if (isAbortLike(error)) {
      return new DirectionLlmError(wasAborted(signal) ? "cancelled" : "timeout");
    }
    return new DirectionLlmError("provider-unavailable", messageOf(error));
  }
}
