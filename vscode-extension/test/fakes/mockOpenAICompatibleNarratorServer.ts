/**
 * Mock OpenAI-compatible chat-completions server (CdC §22: llama.cpp / vLLM /
 * LiteLLM). Emulates `POST /v1/chat/completions` and `GET /v1/models`, with
 * the same `BLOCK_xxx` → structured-segments mapping as `MockOllamaServer`
 * so both narrators can be exercised with the same expectations.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface MockOpenAICompatibleNarratorServerOptions {
  /** If true, POST /v1/chat/completions responds 500. */
  fail500?: boolean;
  /** If true, a `response_format: json_schema` request gets 400 (server too
   *  old to understand it); a `json_object` retry still succeeds. */
  rejectJsonSchema?: boolean;
  /** Overrides the extracted content with a fixed raw string. */
  chatContentOverride?: string;
}

export interface MockOpenAICompatibleNarratorRequestLog {
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
    segments.push({ sourceIds: [`BLOCK_${blockId}`], spokenText: `[narrated] ${(blockText ?? "").trim()}` });
  }
  return segments;
}

interface ChatBody {
  messages?: Array<{ content?: unknown }>;
  response_format?: { type?: string };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectPromise);
  });
}

export class MockOpenAICompatibleNarratorServer {
  private readonly server: Server;
  private readonly options: Required<MockOpenAICompatibleNarratorServerOptions>;
  readonly requests: MockOpenAICompatibleNarratorRequestLog[] = [];

  constructor(options: MockOpenAICompatibleNarratorServerOptions = {}) {
    this.options = {
      fail500: options.fail500 ?? false,
      rejectJsonSchema: options.rejectJsonSchema ?? false,
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
    await new Promise<void>((resolvePromise) => this.server.listen(0, "127.0.0.1", resolvePromise));
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("MockOpenAICompatibleNarratorServer: failed to bind an ephemeral TCP port");
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

    if (req.method === "GET" && url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "local-model" }] }));
      return;
    }

    if (req.method === "POST" && url === "/v1/chat/completions") {
      if (this.options.fail500) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "mock OpenAI-compatible server: simulated failure" }));
        return;
      }
      const parsed = JSON.parse(body) as ChatBody;
      if (this.options.rejectJsonSchema && parsed.response_format?.type === "json_schema") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "response_format json_schema not supported" }));
        return;
      }
      const promptContent = (parsed.messages ?? []).map((m) => String(m.content ?? "")).join("\n");
      const content =
        this.options.chatContentOverride.length > 0
          ? this.options.chatContentOverride
          : JSON.stringify({ segments: extractSegmentsFromPrompt(promptContent) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `mock OpenAI-compatible server: no route for ${req.method} ${url}` }));
  }
}
