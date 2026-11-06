/**
 * `KyutaiPocketProvider` (ADR-016 §2, `GAO-kyutai-pocke-001`) against a fake
 * `pocket-tts serve` built on the contract this card's task envelope
 * verified by reading `pocket_tts/main.py` directly — not a real server
 * (none available in this environment, see the evidence pack).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createEgressGuard } from "../../../src/net/EgressGuard.js";
import { KYUTAI_POCKET_VOICE_CATALOG, KyutaiPocketProvider } from "../../../src/tts/KyutaiPocketProvider.js";
import { makeSilentWav, readWavHeader } from "../../fakes/wav.js";

function egress() {
  return createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
}

interface FakePocketTtsRequest {
  method: string;
  url: string;
  fields: Record<string, string>;
}

type FakeTtsResponse = "ok" | { status: number; contentType?: string; body?: string };

interface FakePocketServerOptions {
  healthStatus?: number;
  healthBody?: unknown;
  ttsResponse?: FakeTtsResponse;
}

/** Pulls `name="..."` fields and their text value out of a multipart body — this
 *  provider only ever sends text fields (`text`, `voice_url`), never a file,
 *  so a regex split on the boundary is enough (same approach as the shared
 *  `MockTtsServer`'s own `extractMultipartFilename`, not reused here to keep
 *  this card's footprint to its own new files). */
function parseMultipartFields(contentType: string, body: string): Record<string, string> {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  const fields: Record<string, string> = {};
  if (boundary === undefined) {
    return fields;
  }
  for (const part of body.split(`--${boundary}`)) {
    const nameMatch = /name="([^"]+)"/.exec(part);
    const separator = part.indexOf("\r\n\r\n");
    if (nameMatch === null || separator === -1) {
      continue;
    }
    fields[nameMatch[1]!] = part.slice(separator + 4).replace(/\r\n$/, "");
  }
  return fields;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectPromise);
  });
}

/** Fake `pocket-tts serve`: `GET /health` and `POST /tts` only — no voice
 *  listing, matching the real server's documented surface. */
class FakePocketServer {
  private readonly server: Server;
  private readonly options: FakePocketServerOptions;
  readonly requests: FakePocketTtsRequest[] = [];

  constructor(options: FakePocketServerOptions = {}) {
    this.options = options;
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: String(error) }));
      });
    });
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolvePromise) => {
      this.server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("FakePocketServer: failed to bind an ephemeral TCP port");
    }
    return `http://127.0.0.1:${(address as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      this.server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    const body = await readBody(req);

    if (req.method === "GET" && url === "/health") {
      res.writeHead(this.options.healthStatus ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(this.options.healthBody ?? { status: "healthy" }));
      return;
    }

    if (req.method === "POST" && url === "/tts") {
      const contentType = req.headers["content-type"] ?? "";
      const fields = parseMultipartFields(contentType, body);
      this.requests.push({ method: req.method, url, fields });

      const ttsResponse = this.options.ttsResponse ?? "ok";
      if (ttsResponse !== "ok") {
        res.writeHead(ttsResponse.status, { "content-type": ttsResponse.contentType ?? "application/json" });
        res.end(ttsResponse.body ?? "");
        return;
      }

      // Real chunked transfer (task envelope: "Transfer-Encoding: chunked",
      // no known size in advance), split into two writes on purpose so a
      // provider that only reads the first chunk would get a truncated WAV.
      const wav = makeSilentWav(Math.max(fields["text"]?.length ?? 1, 1) * 10, 16000);
      // Same placeholder sizes as the real server's header (captured 2026-11-05).
      wav.writeUInt32LE(2_000_000_036, 4);
      wav.writeUInt32LE(2_000_000_000, 40);
      const mid = Math.ceil(wav.length / 2);
      res.writeHead(200, { "content-type": "audio/wav", "transfer-encoding": "chunked" });
      res.write(wav.subarray(0, mid));
      res.end(wav.subarray(mid));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: `fake pocket-tts: no route for ${req.method ?? "GET"} ${url}` }));
  }
}

describe("KyutaiPocketProvider (ADR-016 §2, GAO-kyutai-pocke-001)", () => {
  let server: FakePocketServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('id defaults to "kyutai-pocket"', () => {
    const provider = new KyutaiPocketProvider({ baseUrl: "http://127.0.0.1:8000", egress: egress(), languages: ["fr"] });
    expect(provider.id).toBe("kyutai-pocket");
  });

  it("synthesize() posts multipart text to /tts and returns a full, valid wav read to the end of the chunked stream", async () => {
    server = new FakePocketServer();
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });

    const result = await provider.synthesize({ text: "Bonjour" });

    expect(result.format).toBe("wav");
    const header = readWavHeader(Buffer.from(result.data));
    expect(header.dataSize).toBe(result.data.length - 44);
    expect(Buffer.from(result.data).readUInt32LE(4)).toBe(result.data.length - 8);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.fields["text"]).toBe("Bonjour");
    expect(server.requests[0]?.fields).not.toHaveProperty("voice_url");
    expect(server.requests[0]?.fields).not.toHaveProperty("voice_wav");
  });

  it("synthesize() forwards a voice-cloning reference URL as voice_url", async () => {
    server = new FakePocketServer();
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });

    await provider.synthesize({ text: "Bonjour", voice: "https://example.com/ref.wav" });

    expect(server.requests[0]?.fields["voice_url"]).toBe("https://example.com/ref.wav");
    expect(server.requests[0]?.fields).not.toHaveProperty("voice_wav");
  });

  it("synthesize() forwards an hf:// reference the same way", async () => {
    server = new FakePocketServer();
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });

    await provider.synthesize({ text: "Bonjour", voice: "hf://kyutai/tts-voices/some-reference.wav" });

    expect(server.requests[0]?.fields["voice_url"]).toBe("hf://kyutai/tts-voices/some-reference.wav");
  });

  it("synthesize() forwards a static-catalogue built-in voice name as voice_url too", async () => {
    server = new FakePocketServer();
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });

    await provider.synthesize({ text: "Bonjour", voice: "alba" });

    expect(server.requests[0]?.fields["voice_url"]).toBe("alba");
    expect(server.requests[0]?.fields).not.toHaveProperty("voice_wav");
  });

  it("synthesize() falls back to defaultVoice when the request names none", async () => {
    server = new FakePocketServer();
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"], defaultVoice: "alba" });

    await provider.synthesize({ text: "Bonjour" });

    expect(server.requests[0]?.fields["voice_url"]).toBe("alba");
  });

  it("an explicit request.voice always wins over defaultVoice", async () => {
    server = new FakePocketServer();
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"], defaultVoice: "alba" });

    await provider.synthesize({ text: "Bonjour", voice: "https://example.com/other.wav" });

    expect(server.requests[0]?.fields["voice_url"]).toBe("https://example.com/other.wav");
  });

  it("never sends an empty voice_url (an explicit empty-string voice is treated as no voice at all)", async () => {
    server = new FakePocketServer();
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });

    await provider.synthesize({ text: "Bonjour", voice: "" });

    expect(server.requests[0]?.fields).not.toHaveProperty("voice_url");
  });

  it("never builds the voice_url + voice_wav combination the server rejects with 400 (no local-file voice path exists on this provider)", async () => {
    server = new FakePocketServer();
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });

    await provider.synthesize({ text: "Bonjour", voice: "alba" });

    // Only ever `text` and (optionally) `voice_url` leave this provider.
    expect(Object.keys(server.requests[0]?.fields ?? {}).sort()).toEqual(["text", "voice_url"]);
  });

  it("synthesize() rejects with the server's JSON detail message on HTTP 400", async () => {
    server = new FakePocketServer({ ttsResponse: { status: 400, body: JSON.stringify({ detail: "text must not be empty" }) } });
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });

    await expect(provider.synthesize({ text: "" })).rejects.toThrow(/text must not be empty/);
  });

  it("synthesize() rejects on an HTTP 400 with an empty body, without a dangling separator", async () => {
    server = new FakePocketServer({ ttsResponse: { status: 400, body: "" } });
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });

    await expect(provider.synthesize({ text: "Bonjour" })).rejects.toThrow(/^KyutaiPocketProvider: HTTP 400 from [^\s—]+\/tts$/);
  });

  it("synthesize() rejects with the raw text body on a non-JSON HTTP 500", async () => {
    server = new FakePocketServer({
      ttsResponse: { status: 500, contentType: "text/plain", body: "internal error" }
    });
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });

    await expect(provider.synthesize({ text: "Bonjour" })).rejects.toThrow(/internal error/);
  });

  it("synthesize() rejects immediately on an already-aborted signal, without any network request", async () => {
    server = new FakePocketServer();
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });
    const controller = new AbortController();
    controller.abort();

    await expect(provider.synthesize({ text: "Bonjour" }, controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(server.requests).toHaveLength(0);
  });

  it("health() reports ok when the server answers {status: healthy}", async () => {
    server = new FakePocketServer();
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });

    const health = await provider.health();

    expect(health.status).toBe("ok");
    expect(health.providerId).toBe("kyutai-pocket");
  });

  it("health() reports unreachable (never a false ok) when the server reports a different status", async () => {
    server = new FakePocketServer({ healthBody: { status: "starting" } });
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });

    const health = await provider.health();

    expect(health.status).toBe("unreachable");
  });

  it("health() reports unreachable on a non-2xx /health response", async () => {
    server = new FakePocketServer({ healthStatus: 500 });
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr"] });

    const health = await provider.health();

    expect(health.status).toBe("unreachable");
  });

  it("health() reports unreachable when the server cannot be reached at all", async () => {
    const provider = new KyutaiPocketProvider({ baseUrl: "http://127.0.0.1:1", egress: egress(), languages: ["fr"] });

    const health = await provider.health();

    expect(health.status).toBe("unreachable");
  });

  it("getCapabilities() reflects the configured languages, the minimal static catalogue, never streaming, no direction, no word timestamps", async () => {
    server = new FakePocketServer();
    const baseUrl = await server.listen();
    const provider = new KyutaiPocketProvider({ baseUrl, egress: egress(), languages: ["fr", "en"] });

    const capabilities = await provider.getCapabilities();

    expect(capabilities.streaming).toBe(false);
    expect(capabilities.voices).toEqual(KYUTAI_POCKET_VOICE_CATALOG);
    expect(capabilities.voices.length).toBeGreaterThan(0);
    expect(capabilities.languages).toEqual(["fr", "en"]);
    expect(capabilities.formats).toEqual(["wav"]);
    expect(capabilities.direction).toBeUndefined();
  });

  it("listVoices() resolves the static catalogue with no network call at all, even through a denying EgressGuard (GAO-fix-provider-001)", async () => {
    const provider = new KyutaiPocketProvider({ baseUrl: "http://example.com", egress: egress(), languages: ["fr"] });

    const voices = await provider.listVoices();

    expect(voices).toEqual(KYUTAI_POCKET_VOICE_CATALOG);
  });

  it("never reaches a non-loopback host: the real EgressGuard denies synthesize() before any request leaves (D10)", async () => {
    const provider = new KyutaiPocketProvider({ baseUrl: "http://example.com", egress: egress(), languages: ["fr"] });

    await expect(provider.synthesize({ text: "Bonjour" })).rejects.toThrow(/denied/i);
  });

  it("never reaches a non-loopback host: health() reports unreachable instead of throwing (D10)", async () => {
    const provider = new KyutaiPocketProvider({ baseUrl: "http://example.com", egress: egress(), languages: ["fr"] });

    const health = await provider.health();

    expect(health.status).toBe("unreachable");
  });
});
