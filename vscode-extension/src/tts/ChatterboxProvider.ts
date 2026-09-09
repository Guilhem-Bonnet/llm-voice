/**
 * `ChatterboxProvider`: the ADR-009 niveau 1 default (`Chatterbox
 * Multilingual V3`, CdC §24-25, §28: `ChatterboxProvider extends
 * OpenAICompatibleTtsProvider` for the shared HTTP plumbing — `health()`,
 * `headers()`, `egress`, voice listing fallback — but synthesis itself talks
 * the community `Chatterbox-TTS-Server`'s *native* `POST /tts`, not the
 * inherited `/v1/audio/speech`).
 *
 * fix(review, S4.2/S4.3): field names verified against the real server's
 * OpenAPI schema (`GET /openapi.json` on `localhost:8004`, 2026-09-08), not
 * guessed. `POST /v1/audio/speech` (`OpenAISpeechRequest`) requires `model`
 * + `voice` and has **no** `exaggeration`/`cfg_weight`/`temperature`/
 * `language`/clone-mode fields at all — extra JSON keys are silently
 * dropped, and `docs/e2e/report-2026-09-08.md` ("Accent français") traced
 * the English-accented French synthesis the S4.3 real E2E run first hit
 * back to exactly this: `language` is honoured by `/tts` but ignored by
 * `/v1/audio/speech` on this server. `POST /tts` (`CustomTTSRequest`) is
 * the endpoint that actually exposes `voice_mode`, `predefined_voice_id`,
 * `reference_audio_filename`, `exaggeration`, `cfg_weight`, `temperature`
 * and `language`. `OpenAICompatibleTtsProvider.synthesize()` (unchanged,
 * `/v1/audio/speech`) stays the code path for any *other* OpenAI-compatible
 * engine (Piper via a wrapper, enterprise/cloud tiers 2-3, ADR-009) that has
 * no native alternative — it requires `model` + `voice` and does not carry
 * `language` to the engine; profiles pointed at it must pick a voice whose
 * language already matches.
 *
 * Voice cloning (CdC §55): a profile's `tts.referenceAudio` (a local file
 * path) is uploaded once, lazily, on the first `synthesize()` call, via
 * `POST /upload_reference` (multipart/form-data, `files` field — verified
 * in `/docs`/`openapi.json`); the community server keeps the uploaded file
 * under its original basename, which is then sent back as
 * `reference_audio_filename` on every `/tts` call for the rest of this
 * provider instance's lifetime (one instance per resolved
 * providerId/baseUrl/referenceAudio tuple, `Pipeline.ttsFor`'s registry
 * key). Concurrent first calls share one upload via `uploadPromise`. Without
 * a `referenceAudio`, `voice_mode: "predefined"` is used with
 * `request.voice` as `predefined_voice_id`.
 */

import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

import {
  MAX_REFERENCE_AUDIO_BYTES,
  REFERENCE_AUDIO_EXTENSIONS,
  isSafeReferenceAudioPath
} from "../core/safePath.js";

import type { ProviderHealth } from "../core/health.js";
import type { AudioResult, TtsCapabilities, TtsParameterDescriptor, TtsRequest, Voice } from "../core/tts.js";
import {
  OpenAICompatibleTtsProvider,
  messageOf,
  type OpenAICompatibleTtsProviderOptions
} from "./OpenAICompatibleTtsProvider.js";

const DEFAULT_ID = "chatterbox";

/** CdC §24: the tunables the native `/tts` endpoint accepts (`CustomTTSRequest`). */
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
  }
  // `language` is a first-class `TtsRequest.language`/profile field, not a
  // free-form `parameters` entry (it used to be smuggled in here as
  // "language_id", a field `/tts` does not have — see file header).
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

/** `"fr-FR"` → `"fr"`: profiles carry a BCP-47 tag, `/tts`'s `language` wants the short code. */
function normalizeLanguage(language: string): string {
  return language.slice(0, 2).toLowerCase();
}

export interface ChatterboxProviderOptions extends OpenAICompatibleTtsProviderOptions {
  /**
   * Local filesystem path to a reference sample for voice cloning (CdC §55).
   * Uploaded once via `POST /upload_reference` on first use; absent means
   * `voice_mode: "predefined"`.
   */
  referenceAudioPath?: string;
}

export class ChatterboxProvider extends OpenAICompatibleTtsProvider {
  private readonly referenceAudioPath: string | undefined;
  private uploadedReferenceFilename: string | undefined;
  private uploadPromise: Promise<string> | undefined;

  constructor(options: ChatterboxProviderOptions) {
    super({ id: DEFAULT_ID, ...options });
    this.referenceAudioPath = options.referenceAudioPath;
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

  /** `POST /tts` (native, CdC §24-25/§55) — not the inherited `/v1/audio/speech`, see file header. */
  override async synthesize(request: TtsRequest, signal?: AbortSignal): Promise<AudioResult> {
    const referenceAudioFilename = await this.ensureReferenceUploaded(signal);
    const response = await this.egress.fetch(`${this.baseUrl}/tts`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(this.buildTtsRequestBody(request, referenceAudioFilename)),
      ...(signal !== undefined ? { signal } : {})
    });
    if (!response.ok) {
      // Endpoint label only (host + path): `baseUrl` may embed a userinfo
      // segment carrying a secret, and this message reaches the Output
      // Channel (S6.1 audit F-07).
      throw new Error(`ChatterboxProvider: HTTP ${response.status} from ${this.endpointLabel("/tts")}`);
    }
    const buffer = await response.arrayBuffer();
    return { format: "wav", data: new Uint8Array(buffer) };
  }

  /** JSON body of `POST /tts` (`CustomTTSRequest`, verified field-for-field against `/openapi.json`). */
  private buildTtsRequestBody(
    request: TtsRequest,
    referenceAudioFilename: string | undefined
  ): Record<string, unknown> {
    const parameters = request.parameters;
    const exaggeration = numberParam(parameters, "exaggeration");
    const cfgWeight = numberParam(parameters, "cfg_weight");
    const temperature = numberParam(parameters, "temperature");
    const language = request.language !== undefined ? normalizeLanguage(request.language) : undefined;
    const cloning = referenceAudioFilename !== undefined;
    return {
      text: request.text,
      voice_mode: cloning ? "clone" : "predefined",
      ...(cloning
        ? { reference_audio_filename: referenceAudioFilename }
        : request.voice !== undefined
          ? { predefined_voice_id: request.voice }
          : {}),
      output_format: "wav",
      ...(language !== undefined ? { language } : {}),
      ...(exaggeration !== undefined ? { exaggeration } : {}),
      ...(cfgWeight !== undefined ? { cfg_weight: cfgWeight } : {}),
      ...(temperature !== undefined ? { temperature } : {})
    };
  }

  /** Uploads `referenceAudioPath` at most once (memoised across concurrent callers). */
  private async ensureReferenceUploaded(signal?: AbortSignal): Promise<string | undefined> {
    if (this.referenceAudioPath === undefined) {
      return undefined;
    }
    if (this.uploadedReferenceFilename !== undefined) {
      return this.uploadedReferenceFilename;
    }
    this.uploadPromise ??= this.uploadReference(this.referenceAudioPath, signal);
    const filename = await this.uploadPromise;
    this.uploadedReferenceFilename = filename;
    return filename;
  }

  /**
   * Reads the reference sample, refusing anything that is not plainly an
   * audio file (S6.1 audit F-03). `referenceAudio` comes from a profile,
   * which may have been *imported* (AC-SEC-05) — without these checks,
   * importing a profile is enough to have an arbitrary local file read and
   * uploaded to the TTS endpoint. Four controls, in order:
   *
   *  1. the declared path passes `isSafeReferenceAudioPath` (audio
   *     extension, no deceptive character) — already enforced by the schema
   *     on import, re-checked here because a profile can also be
   *     hand-edited in `profiles.json` after the fact;
   *  2. the path is not a symlink to something else, and its `realpath`
   *     still ends in an audio extension — a `voice.wav` symlink pointing
   *     at `~/.ssh/id_rsa` is refused, not followed;
   *  3. it is a regular file (not a fifo, device, or directory);
   *  4. it is under `MAX_REFERENCE_AUDIO_BYTES`.
   */
  private async readReferenceAudio(filePath: string): Promise<Buffer> {
    if (!isSafeReferenceAudioPath(filePath)) {
      throw new Error(
        `ChatterboxProvider: refusing reference audio "${basename(filePath)}" ` +
          `(expected one of ${REFERENCE_AUDIO_EXTENSIONS.join(", ")})`
      );
    }
    const link = await lstat(filePath);
    if (link.isSymbolicLink()) {
      const resolved = await realpath(filePath);
      if (!REFERENCE_AUDIO_EXTENSIONS.includes(extname(resolved).toLowerCase())) {
        throw new Error(
          `ChatterboxProvider: refusing reference audio "${basename(filePath)}" — symlink to a non-audio file`
        );
      }
    }
    const target = await stat(filePath);
    if (!target.isFile()) {
      throw new Error(`ChatterboxProvider: reference audio "${basename(filePath)}" is not a regular file`);
    }
    if (target.size > MAX_REFERENCE_AUDIO_BYTES) {
      throw new Error(
        `ChatterboxProvider: reference audio "${basename(filePath)}" is ${target.size} bytes, ` +
          `over the ${MAX_REFERENCE_AUDIO_BYTES} byte limit`
      );
    }
    return readFile(filePath);
  }

  /** `POST /upload_reference` (multipart/form-data, `files[]`) — verified in `/openapi.json`. */
  private async uploadReference(path: string, signal?: AbortSignal): Promise<string> {
    const filename = basename(path);
    let bytes: Buffer;
    try {
      bytes = await this.readReferenceAudio(path);
    } catch (error) {
      // `basename` only: an absolute path is user-identifying and this
      // message reaches the Output Channel (CdC §81).
      throw new Error(`ChatterboxProvider: cannot read reference audio "${filename}": ${messageOf(error)}`);
    }
    const form = new FormData();
    form.append("files", new Blob([bytes]), filename);
    // No content-type header here: `fetch` sets `multipart/form-data;
    // boundary=...` itself from the `FormData` body — setting it manually
    // would drop the boundary and break the upload.
    const response = await this.egress.fetch(`${this.baseUrl}/upload_reference`, {
      method: "POST",
      headers: this.headers(),
      body: form,
      ...(signal !== undefined ? { signal } : {})
    });
    if (!response.ok) {
      throw new Error(
        `ChatterboxProvider: reference upload failed, HTTP ${response.status} from ${this.endpointLabel("/upload_reference")}`
      );
    }
    return filename;
  }
}
