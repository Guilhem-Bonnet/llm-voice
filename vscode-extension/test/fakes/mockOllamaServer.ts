/**
 * Mock Ollama server (cahier-des-charges.md §21, §78).
 *
 * A tiny `node:http` server on 127.0.0.1 / an ephemeral port emulating
 * Ollama's `POST /api/chat` with structured outputs (`format` as a JSON
 * Schema): given a prompt containing `BLOCK_xxx` markers, it returns
 * `{ segments: [{ sourceIds, spokenText }] }`. Also emulates `GET /api/tags`
 * (`OllamaNarrator.health`'s "model not pulled" check).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface MockOllamaServerOptions {
  /** If true, POST /api/chat always responds 500. */
  fail500?: boolean;
  /** If true, POST /api/chat responds 302 to an external host, used to
   *  test the localOnly guard (CdC §80). */
  redirectExternal?: boolean;
  /** Model names reported by GET /api/tags. Defaults to `["qwen2.5:7b"]`. */
  models?: string[];
  /** Delay (ms) before POST /api/chat responds, to exercise abort/timeout. */
  chatDelayMs?: number;
  /** Raw `message.content` to return instead of the extracted BLOCK_xxx mapping. */
  chatContentOverride?: string;
}

export interface MockOllamaServerRequestLog {
  method: string;
  url: string;
  body: string;
}

interface NarratedSegment {
  sourceIds: string[];
  spokenText: string;
}

const BLOCK_PATTERN = /BLOCK_(\d+)\n([\s\S]*?)(?=\nBLOCK_\d+\n|$)/g;

function extractSegmentsFromPrompt(content: string): NarratedSegment[] {
  const segments: NarratedSegment[] = [];
  let match: RegExpExecArray | null;
  BLOCK_PATTERN.lastIndex = 0;

  while ((match = BLOCK_PATTERN.exec(content)) !== null) {
    const [, blockId, blockText] = match;
    segments.push({
      sourceIds: [`BLOCK_${blockId}`],
      spokenText: `[narrated] ${(blockText ?? "").trim()}`
    });
  }

  if (segments.length === 0 && content.trim().length > 0) {
    segments.push({ sourceIds: [], spokenText: `[narrated] ${content.trim()}` });
  }

  return segments;
}

function extractPromptContent(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "messages" in parsed) {
      const messages = (parsed as { messages: unknown }).messages;
      if (Array.isArray(messages)) {
        return messages
          .map((m) => (m && typeof m === "object" && "content" in m ? String((m as { content: unknown }).content) : ""))
          .join("\n");
      }
    }
  } catch {
    // fall through
  }
  return body;
}

export class MockOllamaServer {
  private readonly server: Server;
  private readonly options: Required<MockOllamaServerOptions>;
  readonly requests: MockOllamaServerRequestLog[] = [];

  constructor(options: MockOllamaServerOptions = {}) {
    this.options = {
      fail500: options.fail500 ?? false,
      redirectExternal: options.redirectExternal ?? false,
      models: options.models ?? ["qwen2.5:7b"],
      chatDelayMs: options.chatDelayMs ?? 0,
      chatContentOverride: options.chatContentOverride ?? ""
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
      throw new Error("MockOllamaServer: failed to bind an ephemeral TCP port");
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

    if (req.method === "GET" && url === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.method === "GET" && url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: this.options.models.map((name) => ({ name, model: name })) }));
      return;
    }

    if (req.method === "POST" && url === "/api/chat") {
      if (this.options.redirectExternal) {
        res.writeHead(302, { location: "https://example.com/api/chat" });
        res.end();
        return;
      }
      if (this.options.fail500) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "mock Ollama server: simulated failure" }));
        return;
      }
      if (this.options.chatDelayMs > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, this.options.chatDelayMs));
      }

      const content =
        this.options.chatContentOverride.length > 0
          ? this.options.chatContentOverride
          : JSON.stringify({ segments: extractSegmentsFromPrompt(extractPromptContent(body)) });

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: { content } }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `mock Ollama server: no route for ${req.method} ${url}` }));
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
