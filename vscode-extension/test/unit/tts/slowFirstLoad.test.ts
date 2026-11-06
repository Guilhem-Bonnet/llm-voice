/**
 * The first reading after a start: the server loads its model inside the first
 * `POST /tts`. A real HTTP server, the real provider and the real queue, with
 * every delay scaled down (120 ms stands for the 60 s of `llmVoice.tts.timeoutMs`).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { AudioChunk } from "../../../src/core/playback.js";
import { TtsHoldError } from "../../../src/core/tts.js";
import type { EgressGuardHandle } from "../../../src/net/EgressGuard.js";
import { AudioQueue } from "../../../src/playback/AudioQueue.js";
import { InMemoryAudioCache } from "../../../src/playback/AudioCache.js";
import { KyutaiPocketProvider } from "../../../src/tts/KyutaiPocketProvider.js";

const egress = { fetch: (url: string, init?: RequestInit) => fetch(url, init) } as unknown as EgressGuardHandle;
const WAV = Buffer.from("RIFF....WAVEfmt ");

interface SlowServer {
  server: Server;
  baseUrl: string;
  posts: { at: number; closedEarly: boolean }[];
}

/** Answers `/tts` after `loadMs` for the first request (the model loads once), at once afterwards. */
async function slowServer(loadMs: number): Promise<SlowServer> {
  const posts: SlowServer["posts"] = [];
  const started = Date.now();
  const loadedAt = started + loadMs;
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ status: "healthy" }));
      return;
    }
    const post = { at: Date.now() - started, closedEarly: false };
    posts.push(post);
    request.resume();
    response.on("close", () => {
      post.closedEarly = !response.writableFinished;
    });
    setTimeout(() => {
      if (!response.destroyed) {
        response.setHeader("content-type", "audio/wav");
        response.end(WAV);
      }
    }, Math.max(0, loadedAt - Date.now()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, posts };
}

function chunk(): AudioChunk {
  return { id: "c0", sessionId: "s", spokenText: "Bonjour.", sourceRanges: [], status: "pending" };
}

describe("a first load longer than the request timeout", () => {
  let running: SlowServer | undefined;
  afterEach(async () => {
    running?.server.closeAllConnections();
    await new Promise((resolve) => running?.server.close(resolve));
  });

  it("is cut at the timeout, then resumed by the queue's own retry: audio arrives, late", async () => {
    running = await slowServer(200);
    const queue = new AudioQueue(
      {
        tts: new KyutaiPocketProvider({ baseUrl: running.baseUrl, egress, languages: ["fr"], id: "kyutai-1-6b" }),
        cache: new InMemoryAudioCache()
      },
      { timeoutMs: 120, maxRetries: 2, retryBackoffMs: [10], retryJitterMs: 0 }
    );
    queue.reset([chunk()]);
    queue.setCursor(0);
    const started = Date.now();
    const ready = await queue.waitFor(0);

    expect(ready.status).toBe("ready");
    expect(running.posts).toHaveLength(2);
    expect(running.posts[0]?.closedEarly).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(120);
    queue.dispose();
  });
});

describe("what the provider reads from a server that loads on demand", () => {
  function provider(respond: (url: string, init?: RequestInit) => Response) {
    const calls: { url: string; method: string | undefined }[] = [];
    const guarded = {
      fetch: async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method });
        return respond(url, init);
      }
    } as unknown as EgressGuardHandle;
    return { calls, tts: new KyutaiPocketProvider({ baseUrl: "http://127.0.0.1:8020", egress: guarded, languages: ["fr"], loadsOnDemand: true }) };
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("a loading state is degraded/loading, with what the server says of the time spent", async () => {
    const { tts } = provider(() => json({ status: "healthy", state: "loading", model_loaded: false, loading_since_s: 12.5 }));
    expect(await tts.health()).toMatchObject({ status: "degraded", detail: "loading", modelLoaded: false, loadingSinceMs: 12_500 });
  });

  it("a server predating `state` stays a plain ok, and says what it knows", async () => {
    const { tts } = provider(() => json({ status: "healthy", model_loaded: false }));
    const health = await tts.health();
    expect(health.status).toBe("ok");
    expect(health.modelLoaded).toBe(false);
  });

  it("prepare asks /load, and a server without the route changes nothing", async () => {
    const { calls, tts } = provider(() => json({ detail: "Adresse inconnue." }, 404));
    await expect(tts.prepare()).resolves.toBeUndefined();
    expect(calls).toEqual([{ url: "http://127.0.0.1:8020/load", method: "POST" }]);
  });

  it("prepare asks nothing of a server that cannot load on demand", async () => {
    const calls: string[] = [];
    const guarded = { fetch: async (url: string) => (calls.push(url), json({})) } as unknown as EgressGuardHandle;
    await new KyutaiPocketProvider({ baseUrl: "http://127.0.0.1:8000", egress: guarded, languages: ["fr"] }).prepare();
    expect(calls).toEqual([]);
  });

  it.each([
    ["gpu-yield", { detail: "Mode jeu actif (gpu-yield) : aucune synthèse tant qu'il dure.", reason: "gpu_yield" }],
    ["gpu-yield", { detail: "Mode jeu actif (gpu-yield) : aucune synthèse tant qu'il dure." }],
    ["gpu-memory", { detail: "GPU indisponible ou mémoire insuffisante.", reason: "gpu_memory" }]
  ])("a 503 says %s to the queue", async (reason, body) => {
    const { tts } = provider(() => json(body, 503));
    await expect(tts.synthesize({ text: "x" })).rejects.toMatchObject({ name: "TtsHoldError", reason });
  });

  it("a busy server stays an ordinary failure, which the queue may retry", async () => {
    const { tts } = provider(() => json({ detail: "Trop de synthèses en attente.", reason: "busy" }, 503));
    await expect(tts.synthesize({ text: "x" })).rejects.not.toBeInstanceOf(TtsHoldError);
  });
});

describe("the queue before an engine that holds back", () => {
  it("asks once per passage and never loops: the mode jeu is not insisted upon", async () => {
    let calls = 0;
    const tts = {
      id: "t",
      health: async () => ({ providerId: "t", status: "ok" as const, checkedAt: 0 }),
      getCapabilities: async () => ({ streaming: false, voices: [], parameters: [], formats: ["wav" as const], languages: ["fr"] }),
      synthesize: async () => {
        calls += 1;
        throw new TtsHoldError("gpu-yield", "Mode jeu actif");
      }
    };
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache() }, { maxRetries: 5, retryBackoffMs: [1], retryJitterMs: 0, prefetchChunks: 0 });
    queue.reset([chunk()]);
    queue.setCursor(0);
    const failed = await queue.waitFor(0);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(failed.status).toBe("error");
    expect(failed.holdReason).toBe("gpu-yield");
    expect(calls).toBe(1);

    queue.retry(0);
    await queue.waitFor(0);
    expect(calls).toBe(2);
    queue.dispose();
  });
});

describe("the same first load, asked for ahead of the synthesis", () => {
  it("is not counted against the request timeout: one request, never cut", async () => {
    const posts: { closedEarly: boolean }[] = [];
    let loadedAt: number | undefined;
    const server = createServer((request, response) => {
      const url = request.url ?? "";
      request.resume();
      if (url === "/load") {
        loadedAt = Date.now() + 200;
        response.statusCode = 202;
        response.end("{}");
      } else if (url === "/health") {
        const loading = loadedAt !== undefined && Date.now() < loadedAt;
        response.end(JSON.stringify({ status: "healthy", state: loading ? "loading" : "ready", model_loaded: !loading && loadedAt !== undefined }));
      } else {
        const post = { closedEarly: false };
        posts.push(post);
        response.on("close", () => {
          post.closedEarly = !response.writableFinished;
        });
        response.setHeader("content-type", "audio/wav");
        response.end(WAV);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const tts = new KyutaiPocketProvider({ baseUrl, egress, languages: ["fr"], id: "kyutai-1-6b", loadsOnDemand: true });

    await tts.prepare();
    expect((await tts.health()).detail).toBe("loading");
    while ((await tts.health()).detail === "loading") {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await tts.health()).modelLoaded).toBe(true);

    const queue = new AudioQueue(
      { tts, cache: new InMemoryAudioCache() },
      { timeoutMs: 120, maxRetries: 2, retryBackoffMs: [10], retryJitterMs: 0 }
    );
    queue.reset([chunk()]);
    queue.setCursor(0);
    expect((await queue.waitFor(0)).status).toBe("ready");
    expect(posts).toEqual([{ closedEarly: false }]);
    queue.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
});
