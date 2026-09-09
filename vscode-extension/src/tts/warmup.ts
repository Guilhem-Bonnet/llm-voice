/**
 * `warmupProvider` (S6.2, `llmVoice.tts.warmup`, default `true`): absorbs a
 * TTS engine's cold start — `docs/e2e/report-2026-09-08.md` measured
 * ≈38s for Chatterbox's first real synthesis on the reference GPU (ROCm
 * kernel compilation, distinct from and *not* reported by the container's
 * `/health` — see that report's "Latence 1ère synthèse (cold start GPU)")
 * — on a throwaway three-word phrase instead of the user's actual first
 * chunk, and on `health()` first so a genuinely unreachable provider fails
 * fast without an extra synthesis attempt.
 *
 * Deliberately provider-agnostic (`TtsProvider`, ADR-005) and free of any
 * `vscode` import: `Pipeline` is the only production caller (`ttsFor()`,
 * once per newly-created provider instance, fire-and-forget so it never
 * delays the command that triggered it), and `test/integration-real/
 * latency.test.ts` calls it directly, awaited, *before* timing TTFA — which
 * is what "warmup" is for: pay the cold start once, off the clock that
 * matters to the user.
 *
 * Never throws: a provider that is unreachable, still loading, or errors on
 * the warmup call reports `ok: false` — synthesis of the user's real content
 * is not gated on this succeeding, and the normal `waitForTtsReady`/
 * `AudioQueue` retry path is what actually surfaces a persistently broken
 * provider to the user.
 */

import type { AudioResult, TtsProvider } from "../core/tts.js";

/**
 * Short enough to warm the model without costing much even when already
 * warm. Exported for `test/unit/tts/warmup.test.ts`; never logged (CdC §81).
 */
export const WARMUP_TEXT = "Bonjour, ceci fonctionne.";

export interface WarmupOptions {
  language?: string;
  voice?: string;
  signal?: AbortSignal;
}

/** Timings only (CdC §81) — never the synthesized text, which is a fixed constant anyway. */
export interface WarmupResult {
  providerId: string;
  ok: boolean;
  totalMs: number;
  healthMs?: number;
  synthesisMs?: number;
  error?: string;
  /** The synthesized audio, so a caller may cache it (S6.2's "mise en cache"). */
  audio?: AudioResult;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function warmupProvider(tts: TtsProvider, options: WarmupOptions = {}): Promise<WarmupResult> {
  const startedAt = Date.now();
  let healthMs: number | undefined;
  try {
    const healthStartedAt = Date.now();
    await tts.health(options.signal);
    healthMs = Date.now() - healthStartedAt;

    const synthesisStartedAt = Date.now();
    const audio = await tts.synthesize(
      {
        text: WARMUP_TEXT,
        ...(options.language !== undefined ? { language: options.language } : {}),
        ...(options.voice !== undefined ? { voice: options.voice } : {})
      },
      options.signal
    );
    const synthesisMs = Date.now() - synthesisStartedAt;

    return { providerId: tts.id, ok: true, totalMs: Date.now() - startedAt, healthMs, synthesisMs, audio };
  } catch (error) {
    return {
      providerId: tts.id,
      ok: false,
      totalMs: Date.now() - startedAt,
      ...(healthMs !== undefined ? { healthMs } : {}),
      error: messageOf(error)
    };
  }
}
