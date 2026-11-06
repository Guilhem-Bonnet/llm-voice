/**
 * `KyutaiPocketProvider`: ADR-016 §2 "voie intermédiaire" — an HTTP adapter
 * to `pocket-tts serve` (Python, started by the user on `127.0.0.1`,
 * opt-in advanced setting, never a default). Only `kyutai-pocket`'s
 * intermediate path; the target path (sherpa-onnx inside the Core,
 * `CoreTtsProvider`) is a separate, future card.
 *
 * Contract (verified by direct reading of `pocket_tts/main.py`,
 * `_grimoire-output/evidence/GAO-kyutai-pocke-001/task-envelope.md`,
 * 2026-11-05):
 *  - `POST /tts`: `multipart/form-data`, `text` required, `voice_url`
 *    optional (never sent empty) — this provider never sends `voice_wav`,
 *    the server's other, mutually-exclusive voice field (no local
 *    reference-upload path here, unlike `ChatterboxProvider`). Response is
 *    a chunked `audio/wav` stream, no JSON — read to completion via
 *    `response.arrayBuffer()`, same as every other provider in this file.
 *  - `GET /health` → `{"status":"healthy"}` JSON; anything else (including
 *    a reachable server reporting a different status) is `unreachable`,
 *    never a false `ok` (ADR-005 D10).
 *  - No voice-listing endpoint: the catalogue is static (ADR-016 §4).
 *  - The server's language is fixed at its own startup (`--language`), not
 *    per request: `languages` is a constructor option mirroring what the
 *    user declared their running server was started with, never detected.
 *
 * `deploy/kyutai16/server.py` (Kyutai TTS 1.6B) answers this same contract, so
 * `createTtsProvider`'s `"kyutai-1-6b"` case is this class with another `id`,
 * `catalog` and `engineName`.
 */

import type { ProviderHealth } from "../core/health.js";
import { TtsHoldError, type AudioResult, type DirectionCapabilities, type TtsCapabilities, type TtsHoldReason, type TtsProvider, type TtsRequest, type Voice } from "../core/tts.js";
import { repairStreamedWavSizes } from "../core/wavRepair.js";
import type { EgressGuardHandle } from "../net/EgressGuard.js";
import { KYUTAI_POCKET_VOICE_CATALOG } from "./kyutaiVoiceCatalog.js";

const DEFAULT_ID = "kyutai-pocket";

export { KYUTAI_POCKET_VOICE_CATALOG };

export interface KyutaiPocketProviderOptions {
  /** ADR-018 §3: declares several voices per reading, and reads which ones the server holds. */
  multiVoice?: boolean;
  /** What the bench has measured of a reading direction on this engine (ADR-015 §5.2). */
  direction?: DirectionCapabilities;
  /** Defaults to `"kyutai-pocket"`. */
  id?: string;
  baseUrl: string;
  egress: EgressGuardHandle;
  /**
   * Mirrors the `--language` flag the user's `pocket-tts serve` process was
   * started with (ADR-016 §2). There is no endpoint to read this back from
   * the server, so it is never auto-detected: a profile that mis-declares
   * it simply advertises the wrong language, it does not change what the
   * server actually speaks.
   */
  languages: readonly string[];
  /**
   * Voice used when a request names none: either a voice-cloning reference
   * (`http://`, `https://`, `hf://`) or a built-in voice name from the
   * server's own catalogue (sent the same way, see `synthesize()`).
   */
  defaultVoice?: string;
  /** Defaults to `KYUTAI_POCKET_VOICE_CATALOG`. */
  catalog?: readonly Voice[];
  /** What an error calls this engine; defaults to `"KyutaiPocketProvider"`. */
  engineName?: string;
  /** The server has `POST /load` and says its `state` (`deploy/kyutai16/server.py`). `pocket-tts serve` does not. */
  loadsOnDemand?: boolean;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `POST /tts` form shape (`text` + optional `voice_url`, never `voice_wav`
 * — this provider has no local-file upload path, see file header).
 */
function buildTtsForm(text: string, voice: string | undefined): FormData {
  const form = new FormData();
  form.append("text", text);
  // "ne jamais envoyer voice_url vide" (task envelope): an explicitly empty
  // string from a stale/hand-edited profile is treated the same as no
  // voice at all, not forwarded.
  if (voice !== undefined && voice.trim().length > 0) {
    form.append("voice_url", voice);
  }
  return form;
}

/** The server's `reason`; a server predating it is recognised by its own two sentences. */
function holdReasonOf(reason: unknown, detail: string): TtsHoldReason | undefined {
  if (reason === "gpu_yield" || detail.startsWith("Mode jeu")) {
    return "gpu-yield";
  }
  if (reason === "gpu_memory" || detail.includes("mémoire insuffisante")) {
    return "gpu-memory";
  }
  return undefined;
}

export class KyutaiPocketProvider implements TtsProvider {
  readonly id: string;

  private readonly baseUrl: string;
  private readonly egress: EgressGuardHandle;
  private readonly languages: readonly string[];
  private readonly defaultVoice: string | undefined;
  private readonly catalog: readonly Voice[];
  private readonly engineName: string;
  private readonly loadsOnDemand: boolean;
  private readonly multiVoice: boolean;
  private readonly direction: DirectionCapabilities | undefined;

  constructor(options: KyutaiPocketProviderOptions) {
    this.id = options.id ?? DEFAULT_ID;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.egress = options.egress;
    this.languages = options.languages;
    this.defaultVoice = options.defaultVoice;
    this.catalog = options.catalog ?? KYUTAI_POCKET_VOICE_CATALOG;
    this.engineName = options.engineName ?? "KyutaiPocketProvider";
    this.loadsOnDemand = options.loadsOnDemand === true;
    this.multiVoice = options.multiVoice === true;
    this.direction = options.direction;
  }

  /** `GET /health` → `{"status":"healthy"}`; anything else is `unreachable`, never a false `ok` (ADR-005 D10). */
  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    const checkedAt = Date.now();
    const started = Date.now();
    try {
      const response = await this.egress.fetch(`${this.baseUrl}/health`, {
        method: "GET",
        ...(signal !== undefined ? { signal } : {})
      });
      const latencyMs = Date.now() - started;
      if (response.ok) {
        const body = await response
          .json()
          .then((value) => value as { status?: unknown; state?: unknown; model_loaded?: unknown; loading_since_s?: unknown })
          .catch(() => undefined);
        if (body?.status === "healthy") {
          const known = {
            providerId: this.id,
            checkedAt,
            latencyMs,
            endpoint: this.endpointLabel("/health"),
            ...(typeof body.model_loaded === "boolean" ? { modelLoaded: body.model_loaded } : {})
          };
          // Only what the server says: a server predating `state` stays a plain `ok`.
          if (body.state === "loading") {
            return {
              ...known,
              status: "degraded",
              detail: "loading",
              ...(typeof body.loading_since_s === "number" ? { loadingSinceMs: body.loading_since_s * 1000 } : {})
            };
          }
          return { ...known, status: "ok" };
        }
      }
      return {
        providerId: this.id,
        status: "unreachable",
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

  /**
   * `POST /load`: starts the load and returns at once. A refusal or a server predating the
   * route changes nothing: `synthesize()` then reports it, or pays for the load as before.
   */
  async prepare(signal?: AbortSignal): Promise<void> {
    if (!this.loadsOnDemand) {
      return;
    }
    try {
      await this.egress.fetch(`${this.baseUrl}/load`, {
        method: "POST",
        ...(signal !== undefined ? { signal } : {})
      });
    } catch {
      // `health()` and `synthesize()` report an unreachable server.
    }
  }

  /**
   * No `signal` use: purely local/static data, nothing to abort. Declared
   * on the parameter anyway to match `TtsProvider`'s contract shape.
   */
  async getCapabilities(_signal?: AbortSignal): Promise<TtsCapabilities> {
    return {
      streaming: false,
      voices: this.catalog,
      parameters: [],
      formats: ["wav"],
      languages: this.languages,
      ...(this.multiVoice ? { multiVoice: true } : {}),
      ...(this.direction !== undefined ? { direction: this.direction } : {})
      // ADR-016 §5: no `direction` on Pocket — the bench (R6) has measured nothing
      // yet; no word-level timestamps either (R4, closed negative: neither
      // Pocket TTS nor TTS 1.6B produce them officially). Both stay absent
      // rather than falsely advertised (ADR-005 "capacités lues, jamais
      // devinées").
    };
  }

  /**
   * No server endpoint lists voices (file header) — but the catalogue is
   * already fully known statically (same data `getCapabilities()` returns),
   * so `listVoices()` is just that, resolved with no network call. Without
   * this, the profile editor's "Parcourir les voix" button (`TtsProvider`'s
   * optional `listVoices`, `Pipeline.pickVoiceForProfile`) stays permanently
   * disabled for this provider even once it is selectable — found by real
   * testing after GAO-fix-voix-fra-001 (fixed here, GAO-fix-provider-001).
   */
  async listVoices(signal?: AbortSignal): Promise<Voice[]> {
    if (!this.multiVoice) {
      return [...this.catalog];
    }
    // ADR-018 §3: a voice absent from the server's cache would answer 503, so a skipped
    // line. `GET /voices` says which ones it holds; no answer falls back on the catalogue.
    try {
      const response = await this.egress.fetch(`${this.baseUrl}/voices`, signal !== undefined ? { signal } : {});
      if (!response.ok) {
        return [...this.catalog];
      }
      const body = (await response.json()) as { voices?: { id?: unknown; available?: unknown }[] };
      const available = new Set((body.voices ?? []).filter((row) => row.available === true).map((row) => row.id));
      const voices = this.catalog.filter((voice) => available.has(voice.id));
      return voices.length > 0 ? voices : [...this.catalog];
    } catch (error) {
      if (signal?.aborted === true) {
        throw error;
      }
      return [...this.catalog];
    }
  }

  /**
   * `POST /tts` (`multipart/form-data`). Never implements
   * `synthesizeStream()` (a single chunked WAV stream, no discrete frames to
   * yield from) — optional on `TtsProvider`, so simply absent here.
   */
  async synthesize(request: TtsRequest, signal?: AbortSignal): Promise<AudioResult> {
    if (signal?.aborted === true) {
      throw new DOMException("Aborted", "AbortError");
    }
    const voice = request.voice ?? this.defaultVoice;
    const response = await this.egress.fetch(`${this.baseUrl}/tts`, {
      method: "POST",
      body: buildTtsForm(request.text, voice),
      ...(signal !== undefined ? { signal } : {})
    });
    if (!response.ok) {
      const { detail, reason } = await this.errorDetail(response);
      const message =
        `${this.engineName}: HTTP ${response.status} from ${this.endpointLabel("/tts")}` +
        (detail.length > 0 ? ` — ${detail}` : "");
      const hold = response.status === 503 ? holdReasonOf(reason, detail) : undefined;
      throw hold !== undefined ? new TtsHoldError(hold, message) : new Error(message);
    }
    // Chunked `audio/wav`, no `content-length` known in advance (task
    // envelope): `arrayBuffer()` still reads the stream through to its end.
    const buffer = await response.arrayBuffer();
    return { format: "wav", data: repairStreamedWavSizes(new Uint8Array(buffer)) };
  }

  /** `{"detail": "..."}` (FastAPI's default error shape) when JSON, else the raw body text. */
  private async errorDetail(response: Response): Promise<{ detail: string; reason?: unknown }> {
    const text = await response.text().catch(() => "");
    try {
      const body = JSON.parse(text) as { detail?: unknown; message?: unknown; reason?: unknown };
      const detail = body.detail ?? body.message;
      if (typeof detail === "string" && detail.length > 0) {
        return { detail, reason: body.reason };
      }
    } catch {
      // Not JSON: the raw text below is the best available message.
    }
    return { detail: text };
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
