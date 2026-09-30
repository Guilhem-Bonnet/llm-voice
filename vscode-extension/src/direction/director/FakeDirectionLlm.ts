/**
 * Scripted `DirectionLlm` for tests (ADR-015 §Tests 8, 10, 12, 14): canned
 * answers, injectable latency and failures, a record of every call. No model,
 * no network, no GPU. It never sleeps past an abort: `signal` cuts the
 * simulated latency, like a real client cuts its request.
 *
 * With `egress` set, every call first issues one request through the given
 * `EgressGuardHandle` (to `baseUrl`), so a test can prove what the guard let
 * through and what it refused (ADR-010 level 2). The request carries no text
 * of the document.
 */

import type { EgressGuardHandle } from "../../net/EgressGuard.js";
import {
  DirectionLlmError,
  classifyLlmFailure,
  type AnalysisLlmRequest,
  type DirectionDegradedReason,
  type DirectionLlm,
  type DirectionLlmRequest
} from "./llm.js";

export type FakeCallKind = "analyze" | "direct";

export interface FakeCallInfo {
  readonly kind: FakeCallKind;
  /** 0-based rank among the calls of the same kind. */
  readonly index: number;
  /** 0-based rank among all calls. */
  readonly call: number;
}

export interface RecordedCall {
  readonly kind: FakeCallKind;
  readonly at: number;
  readonly request: AnalysisLlmRequest | DirectionLlmRequest;
}

/** A failure to inject: a degraded reason, an error, or `"hang"` (never answers, until aborted). */
export type FakeFailure = DirectionDegradedReason | Error | "hang";

/** A canned raw answer (any JSON value, malformed ones included), or a function of the call and its request. */
export type RawAnswer = string | number | boolean | null | readonly unknown[] | { readonly [key: string]: unknown };
export type Script<Request> = RawAnswer | ((info: FakeCallInfo, request: Request) => unknown);

export interface FakeDirectionLlmOptions {
  readonly id?: string;
  readonly model?: string;
  readonly promptVersion?: string;
  /** Raw answer to `analyze`; default: no analysis, no character. */
  readonly analysis?: Script<AnalysisLlmRequest>;
  /** Raw answer to `direct`; default: one calm narrator cue per window segment, text unchanged. */
  readonly direction?: Script<DirectionLlmRequest>;
  readonly latencyMs?: number | ((info: FakeCallInfo) => number);
  readonly failure?: (info: FakeCallInfo) => FakeFailure | undefined;
  readonly egress?: { readonly guard: EgressGuardHandle; readonly baseUrl: string };
  readonly clock?: () => number;
}

/** `cue-<id>`, safe for the `cueId` pattern whatever the source id. */
export function defaultCueId(sourceId: string): string {
  return `cue-${sourceId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/** The director's default answer: one cue per segment, narrator voice, mild emotion, a short pause after. */
export function defaultDirection(request: DirectionLlmRequest): { cues: unknown[] } {
  return {
    cues: request.window.map((block) => ({
      cueId: defaultCueId(block.id),
      sourceIds: [block.id],
      speakerId: "narrator",
      spokenText: block.text,
      emotion: { label: "calm", intensity: 0.4 },
      tempo: 1,
      pauseAfterMs: 200
    }))
  };
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError());
      return;
    }
    let onAbort: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (onAbort !== undefined) {
        signal?.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);
    onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function hang(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError());
      return;
    }
    signal?.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

export class FakeDirectionLlm implements DirectionLlm {
  readonly id: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly calls: RecordedCall[] = [];

  private readonly options: FakeDirectionLlmOptions;
  private readonly counts: Record<FakeCallKind, number> = { analyze: 0, direct: 0 };
  private total = 0;

  constructor(options: FakeDirectionLlmOptions = {}) {
    this.options = options;
    this.id = options.id ?? "fake-direction";
    this.model = options.model ?? "fake-model";
    this.promptVersion = options.promptVersion ?? "fake-prompt-1";
  }

  callsOf(kind: FakeCallKind): RecordedCall[] {
    return this.calls.filter((call) => call.kind === kind);
  }

  analyze(request: AnalysisLlmRequest, signal?: AbortSignal): Promise<unknown> {
    return this.run("analyze", request, signal, (info) => {
      const script = this.options.analysis;
      return typeof script === "function" ? script(info, request) : (script ?? {});
    });
  }

  direct(request: DirectionLlmRequest, signal?: AbortSignal): Promise<unknown> {
    return this.run("direct", request, signal, (info) => {
      const script = this.options.direction;
      return typeof script === "function" ? script(info, request) : (script ?? defaultDirection(request));
    });
  }

  private async run(
    kind: FakeCallKind,
    request: AnalysisLlmRequest | DirectionLlmRequest,
    signal: AbortSignal | undefined,
    answer: (info: FakeCallInfo) => unknown
  ): Promise<unknown> {
    const info: FakeCallInfo = { kind, index: this.counts[kind], call: this.total };
    this.counts[kind] += 1;
    this.total += 1;
    this.calls.push({ kind, at: (this.options.clock ?? Date.now)(), request });

    const failure = this.options.failure?.(info);
    if (failure === "hang") {
      return hang(signal);
    }
    const latency = this.options.latencyMs;
    const delay = typeof latency === "function" ? latency(info) : (latency ?? 0);
    if (delay > 0) {
      await sleep(delay, signal);
    }
    if (failure !== undefined) {
      throw typeof failure === "string" ? new DirectionLlmError(failure) : failure;
    }
    if (this.options.egress !== undefined) {
      await this.throughGuard(this.options.egress, signal);
    }
    return answer(info);
  }

  /** One POST to `<baseUrl>/api/chat`, as the Ollama client would issue; a refusal maps to its degraded reason. */
  private async throughGuard(egress: NonNullable<FakeDirectionLlmOptions["egress"]>, signal: AbortSignal | undefined): Promise<void> {
    try {
      await egress.guard.fetch(`${egress.baseUrl.replace(/\/+$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, stream: false }),
        ...(signal !== undefined ? { signal } : {})
      });
    } catch (error) {
      throw new DirectionLlmError(classifyLlmFailure(error, signal));
    }
  }
}
