/**
 * Factory picking a `NarratorProvider` implementation from a resolved
 * `providerId` (CdC §22: "OllamaNarrator / LlamaCppNarrator /
 * OpenAICompatibleNarrator sans modifier le pipeline principal" — `llama.cpp`
 * and `vllm`/`litellm` all speak the same OpenAI-compatible chat-completions
 * shape, so they share `OpenAICompatibleNarrator`, parameterised by
 * `baseUrl`, exactly like `OpenAICompatibleTtsProvider` for TTS (D9).
 *
 * Deliberately takes primitive fields rather than `ResolvedNarratorConfig`
 * (`src/pipeline/resolveProviderConfig.ts`): `src/narrator` must not depend
 * on `src/pipeline`, only the reverse.
 */

import type { NarratorProvider } from "../core/narration.js";
import type { EgressGuardHandle } from "../net/EgressGuard.js";
import { NoNarrator } from "./NoNarrator.js";
import { OllamaNarrator } from "./OllamaNarrator.js";
import { OpenAICompatibleNarrator } from "./OpenAICompatibleNarrator.js";

export interface CreateNarratorProviderOptions {
  /** `"none" | "" | "ollama" | "openai-compatible" | "llama.cpp" | "vllm" | "litellm"`. */
  providerId: string;
  baseUrl: string;
  model: string;
  egress: EgressGuardHandle;
  /** Registry cache key; defaults to `providerId`. */
  id?: string;
  temperature?: number;
  timeoutMs?: number;
  apiKey?: string;
}

const OPENAI_COMPATIBLE_IDS = new Set(["openai-compatible", "llama.cpp", "vllm", "litellm"]);

export function createNarratorProvider(options: CreateNarratorProviderOptions): NarratorProvider {
  const shared = {
    ...(options.id !== undefined ? { id: options.id } : {}),
    baseUrl: options.baseUrl,
    model: options.model,
    egress: options.egress,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  };

  if (options.providerId === "ollama") {
    return new OllamaNarrator(shared);
  }
  if (OPENAI_COMPATIBLE_IDS.has(options.providerId)) {
    return new OpenAICompatibleNarrator({
      ...shared,
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {})
    });
  }
  // "none", "" or anything unrecognised: explicit faithful-only, no request ever issued.
  return new NoNarrator(options.id ?? "none");
}
