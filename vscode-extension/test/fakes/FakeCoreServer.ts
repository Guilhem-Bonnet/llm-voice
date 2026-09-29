/**
 * Fake `llm-voice-core` (ADR-012, `contracts/core-v1/`) for `NativeAudioSink`
 * unit tests: real HTTP + a hand-rolled RFC 6455 WebSocket server (Node's
 * `http` module has no server-side WebSocket helper, unlike the global
 * `WebSocket` client `NativeAudioSink` uses — see that class's doc comment
 * for the throwaway script that proved the two talk to each other before
 * this file was written).
 *
 * Deliberately **scripted, not simulated**: every HTTP command is recorded
 * in `requests` and acknowledged `{ ok: true }` by default (or a canned
 * response via `nextAck`/`nextAckError`); WS events are only ever sent when
 * a test calls `emit(...)` — there is no internal clock or `cpal` model here.
 * That keeps every test explicit about which Core event follows which
 * command, the same discipline `FakeAudioSink` applies on the `AudioSink`
 * side of the same boundary.
 */
import * as crypto from "node:crypto";
import * as http from "node:http";
import type { Socket } from "node:net";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface RecordedRequest {
  path: string;
  body: Record<string, unknown>;
}

export interface AckError {
  code: string;
  message: string;
}

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

export class FakeCoreServer {
  readonly token = "test-core-token-0123456789";
  readonly requests: RecordedRequest[] = [];

  private server: http.Server | undefined;
  private readonly sockets = new Set<Socket>();
  private port = 0;
  /** One-shot overrides for the next `enqueue`/`play`/etc. ack. */
  private queuedAcks: (AckError | undefined)[] = [];
  private readonly pathAcks = new Map<string, AckError[]>();

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get wsUrl(): string {
    return `ws://127.0.0.1:${this.port}/v1/ws`;
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handleHttp(req, res);
    });
    this.server.on("upgrade", (req, socket) => {
      this.handleUpgrade(req, socket as Socket);
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("FakeCoreServer: unexpected server address");
    }
    this.port = address.port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => (error !== undefined && error !== null ? reject(error) : resolve()));
    });
  }

  /** Makes the next HTTP command fail with this ack error (one-shot). */
  failNextWith(error: AckError): void {
    this.queuedAcks.push(error);
  }

  /**
   * Makes the next command on `path` (e.g. `"enqueue"`) fail with this ack
   * error (one-shot, HTTP 400), whatever came before it: `load()` sends `stop`
   * first, so `failNextWith` alone would hit that one.
   */
  failNextOn(path: string, error: AckError): void {
    const list = this.pathAcks.get(path) ?? [];
    list.push(error);
    this.pathAcks.set(path, list);
  }

  /** Broadcasts one Core v1 WS event (`contracts/core-v1/ws/*.event.schema.json`) as-is. */
  emit(event: Record<string, unknown>): void {
    const frame = encodeTextFrame(JSON.stringify({ protocolVersion: "1.0", ...event }));
    for (const socket of this.sockets) {
      socket.write(frame);
    }
  }

  get connectedSockets(): number {
    return this.sockets.size;
  }

  private handleUpgrade(req: http.IncomingMessage, socket: Socket): void {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const url = new URL(req.url ?? "", "http://127.0.0.1");
    if (url.searchParams.get("token") !== this.token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const accept = crypto.createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => this.sockets.delete(socket));
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          protocolVersion: "1.0",
          status: "ok",
          capabilities: { formats: ["wav", "pcm16le"], engine: "cpal" }
        })
      );
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: Record<string, unknown> = {};
      try {
        body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        // Malformed body: recorded as empty, ack below still runs.
      }
      const path = url.replace(/^\/v1\//, "");
      this.requests.push({ path, body });
      if (body.token !== this.token) {
        this.sendAck(res, 401, { code: "invalid_token", message: "jeton absent ou invalide" });
        return;
      }
      // Mirrors contracts/core-v1 `segmentId` (`^[A-Za-z0-9_-]+$`), as the
      // real Core does: a fake that accepted any id hid the field bug where
      // every `session-N:i` chunk was refused (2026-09-29).
      if (typeof body.segmentId === "string" && !/^[A-Za-z0-9_-]+$/.test(body.segmentId)) {
        this.sendAck(res, 400, { code: "invalid_request", message: `segmentId "${body.segmentId}" hors contrat` });
        return;
      }
      const error = this.pathAcks.get(path)?.shift() ?? this.queuedAcks.shift();
      if (error !== undefined) {
        this.sendAck(res, 400, error);
        return;
      }
      this.sendAck(res, 200);
    });
  }

  private sendAck(res: http.ServerResponse, status: number, error?: AckError): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        error === undefined
          ? { protocolVersion: "1.0", ok: true }
          : { protocolVersion: "1.0", ok: false, error }
      )
    );
  }
}
