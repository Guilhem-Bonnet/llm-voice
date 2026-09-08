/**
 * Mock HTTP TTS server (cahier-des-charges.md §28 API TTS standardisée, §78).
 *
 * A tiny `node:http` server on 127.0.0.1 / an ephemeral port, used to
 * exercise the HTTP-facing part of a real TtsProvider implementation
 * without any GPU or external network access.
 *
 * Routes:
 *   POST /v1/audio/speech  -> WAV bytes (audio/wav)
 *   GET  /v1/audio/voices  -> { voices: Voice[] }
 *   GET  /health           -> { status: "ok" }
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

  constructor(options: MockTtsServerOptions = {}) {
    this.options = {
      fail500: options.fail500 ?? false,
      redirectExternal: options.redirectExternal ?? false,
      sampleRate: options.sampleRate ?? 16000,
      msPerChar: options.msPerChar ?? 10,
      voices404: options.voices404 ?? false,
      predefinedVoices: options.predefinedVoices ?? [],
      healthBody: options.healthBody ?? { status: "ok" }
    };
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      });
    });
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolvePromise) => {
      this.server.listen(0, "127.0.0.1", resolvePromise);
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
