/**
 * Mock HTTP TTS server (cahier-des-charges.md §28 API TTS standardisée, §78).
 *
 * A tiny `node:http` server on 127.0.0.1 / an ephemeral port, used to
 * exercise the HTTP-facing part of a real TtsProvider implementation
 * without any GPU or external network access.
 *
 * Routes:
 *   POST /v1/audio/speech   -> WAV bytes (audio/wav)
 *   GET  /v1/audio/voices   -> { voices: Voice[] }
 *   GET  /health            -> { status: "ok" }
 *   POST /tts                -> WAV bytes (audio/wav) — Chatterbox's native
 *                                endpoint (S4.2, `ChatterboxProvider`), field
 *                                names verified against the real server's
 *                                `/openapi.json` (`CustomTTSRequest`).
 *   POST /upload_reference   -> { message } — voice-cloning reference upload
 *                                (multipart/form-data, CdC §55)
 *   GET  /get_reference_files -> string[] — uploaded reference filenames
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { makeSilentWav } from "./wav.js";

export interface MockTtsServerOptions {
  /** If true, POST /v1/audio/speech always responds 500. */
  fail500?: boolean;
  /** If true, POST /v1/audio/speech responds 302 to an external host,
   *  used to test the localOnly guard (CdC §80). */
  redirectExternal?: boolean;
  /** Sample rate of generated WAV responses. */
  sampleRate?: number;
  /** Milliseconds of audio generated per character of input text. */
  msPerChar?: number;
  /** If true, GET /v1/audio/voices responds 404 (community-server fallback path). */
  voices404?: boolean;
  /** Body served by GET /get_predefined_voices when `voices404` is set (S4.2, CdC §25). */
  predefinedVoices?: Array<{ voice_id: string; display_name?: string; language?: string }>;
  /** Body merged into the GET /health JSON response (e.g. `{status: "loading"}`, S4.2). */
  healthBody?: Record<string, unknown>;
  /** If true, POST /upload_reference always responds 500 (CdC §55 upload failure path). */
  uploadReference500?: boolean;
  /** Body of GET /voices (`deploy/kyutai16/server.py`); absent = 404. */
  kyutaiVoices?: { voices: Array<{ id: string; name?: string; available: boolean; origin?: string; description?: string }> };
  /** Milliseconds POST /tts takes, so that two requests at once would be seen. */
  ttsDelayMs?: number;
  /** POST /tts answers 503 with this `reason`, as `deploy/kyutai16/server.py` does. */
  ttsHold?: "gpu_yield" | "gpu_memory";
}

export interface MockTtsServerRequestLog {
  method: string;
  url: string;
  body: string;
}

export class MockTtsServer {
  private readonly server: Server;
  private readonly options: Required<MockTtsServerOptions>;
  readonly requests: MockTtsServerRequestLog[] = [];
  /** Filenames received by POST /upload_reference, in call order (CdC §55). */
  readonly uploadedReferenceFilenames: string[] = [];
  /** The most POST /tts ever in progress at once. */
  maxConcurrentTts = 0;
  private activeTts = 0;

  constructor(options: MockTtsServerOptions = {}) {
    this.options = {
      fail500: options.fail500 ?? false,
      redirectExternal: options.redirectExternal ?? false,
      sampleRate: options.sampleRate ?? 16000,
      msPerChar: options.msPerChar ?? 10,
      voices404: options.voices404 ?? false,
      predefinedVoices: options.predefinedVoices ?? [],
      healthBody: options.healthBody ?? { status: "ok" },
      uploadReference500: options.uploadReference500 ?? false,
      kyutaiVoices: options.kyutaiVoices ?? { voices: [] },
      ttsDelayMs: options.ttsDelayMs ?? 0,
      ttsHold: options.ttsHold as "gpu_yield" | "gpu_memory"
    };
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      });
    });
  }

  /** `port` defaults to an ephemeral one; a fixed one serves the `auto` chain (ADR-017 § Tests). */
  async listen(port = 0): Promise<string> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      this.server.once("error", rejectPromise);
      this.server.listen(port, "127.0.0.1", () => {
        this.server.off("error", rejectPromise);
        resolvePromise();
      });
    });
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("MockTtsServer: failed to bind an ephemeral TCP port");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      this.server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
      // Without this a provider's keep-alive socket holds `close()` open, and a
      // "stopped" server would keep answering on its existing connections.
      this.server.closeAllConnections();
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    const body = await readBody(req);
    this.requests.push({ method: req.method ?? "GET", url, body });

    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(this.options.healthBody));
      return;
    }

    if (req.method === "GET" && url === "/v1/audio/voices") {
      if (this.options.voices404) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "mock TTS server: /v1/audio/voices not implemented" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          voices: [
            { id: "mock-voice-fr", name: "Mock Voice FR", language: "fr" },
            { id: "mock-voice-en", name: "Mock Voice EN", language: "en" }
          ]
        })
      );
      return;
    }

    // Qwen3 (`deploy/qwen3/server.py`, GAO-studio-distr-001): voices created on this machine.
    if (req.method === "POST" && url === "/voices/create") {
      const form = new URLSearchParams(body);
      const name = form.get("name") ?? "";
      const description = form.get("description") ?? "";
      if (name.length < 1 || name.length > 40 || description.length < 1 || description.length > 300) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "mock: invalid form" }));
        return;
      }
      if (this.options.kyutaiVoices.voices.some((voice) => voice.name === name)) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "mock: name taken" }));
        return;
      }
      const id = `created-${this.options.kyutaiVoices.voices.length + 1}`;
      this.options.kyutaiVoices.voices.push({ id, name, available: true, origin: "created", description });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id, name, description, seed: 1, sample_seconds: 2 }));
      return;
    }
    const sample = /^\/voices\/([^/]+)\/sample$/.exec(url);
    if (req.method === "GET" && sample !== null) {
      const wav = makeSilentWav(300, this.options.sampleRate);
      res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length });
      res.end(wav);
      return;
    }

    if (req.method === "GET" && url === "/voices" && this.options.kyutaiVoices.voices.length > 0) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(this.options.kyutaiVoices));
      return;
    }

    if (req.method === "GET" && url === "/get_predefined_voices") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(this.options.predefinedVoices));
      return;
    }

    if (req.method === "POST" && url === "/v1/audio/speech") {
      if (this.options.redirectExternal) {
        res.writeHead(302, { location: "https://example.com/v1/audio/speech" });
        res.end();
        return;
      }
      if (this.options.fail500) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "mock TTS server: simulated failure" }));
        return;
      }

      const text = safeExtractText(body);
      const durationMs = Math.max(text.length, 1) * this.options.msPerChar;
      const wav = makeSilentWav(durationMs, this.options.sampleRate);

      res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length });
      res.end(wav);
      return;
    }

    // Chatterbox's native endpoint (S4.2, `ChatterboxProvider`): same WAV
    // generation as `/v1/audio/speech` above, `CustomTTSRequest`'s `text`
    // field instead of `input`, and no `redirectExternal` case (nothing
    // exercises that egress-guard path through this route today).
    if (req.method === "POST" && url === "/tts") {
      this.activeTts += 1;
      this.maxConcurrentTts = Math.max(this.maxConcurrentTts, this.activeTts);
      if (this.options.ttsDelayMs > 0) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, this.options.ttsDelayMs));
      }
      this.activeTts -= 1;
      if (this.options.ttsHold !== undefined) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "mock TTS server: simulated hold", reason: this.options.ttsHold }));
        return;
      }
      if (this.options.fail500) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "mock TTS server: simulated failure" }));
        return;
      }
      const text = safeExtractText(body);
      const durationMs = Math.max(text.length, 1) * this.options.msPerChar;
      const wav = makeSilentWav(durationMs, this.options.sampleRate);

      res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length });
      res.end(wav);
      return;
    }

    if (req.method === "POST" && url === "/upload_reference") {
      if (this.options.uploadReference500) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "mock TTS server: simulated upload failure" }));
        return;
      }
      const filename = extractMultipartFilename(body);
      if (filename !== undefined) {
        this.uploadedReferenceFilenames.push(filename);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Reference audio uploaded." }));
      return;
    }

    if (req.method === "GET" && url === "/get_reference_files") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(this.uploadedReferenceFilenames));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `mock TTS server: no route for ${req.method} ${url}` }));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectPromise);
  });
}

function safeExtractText(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "text" in parsed && typeof (parsed as { text: unknown }).text === "string") {
      return (parsed as { text: string }).text;
    }
  } catch {
    // fall through
  }
  return body;
}

/**
 * Pulls the `filename="..."` off a `multipart/form-data` body's
 * `Content-Disposition` header — good enough for a test double (the binary
 * file bytes further down are irrelevant here, only the field's declared
 * filename), not a general multipart parser.
 */
function extractMultipartFilename(body: string): string | undefined {
  return /filename="([^"]+)"/.exec(body)?.[1];
}
