/** ADR-018 §4 : une voix par passage, résolue en un seul point pour la requête et la clé. */
import { describe, expect, it } from "vitest";
import type { AudioChunk, TtsProvider, TtsRequest } from "../../../src/core/index.js";
import { AudioQueue, bindingForChunk, cacheKeyFor } from "../../../src/playback/AudioQueue.js";
import { InMemoryAudioCache, computeCacheKey } from "../../../src/playback/AudioCache.js";
import { PlaybackController } from "../../../src/playback/PlaybackController.js";
import { FakeAudioSink } from "../../fakes/FakeAudioSink.js";
import { makeProfile } from "./helpers.js";

function recordingTts(): { tts: TtsProvider; requests: TtsRequest[]; maxInFlight: () => number } {
  const requests: TtsRequest[] = [];
  let inFlight = 0;
  let max = 0;
  const tts = {
    id: "moteur",
    health: async () => ({ status: "ok" as const }),
    getCapabilities: async () => ({ streaming: false, voices: [], parameters: [], formats: ["wav" as const], languages: ["fr"] }),
    synthesize: async (request: TtsRequest) => {
      requests.push(request);
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { format: "wav" as const, data: new Uint8Array([1, 2, 3]), durationMs: 500 };
    }
  } as unknown as TtsProvider;
  return { tts, requests, maxInFlight: () => max };
}

function chunk(index: number, text: string, cast?: AudioChunk["cast"]): AudioChunk {
  return {
    id: `s:${index}`,
    sessionId: "s",
    spokenText: text,
    sourceRanges: [],
    status: "pending",
    ...(cast !== undefined ? { cast } : {})
  };
}

const BINDING = { language: "fr", voice: "narrateur-v", model: "m", speed: 1.1, parameters: { a: 1 } };

async function drain(queue: AudioQueue, total: number): Promise<void> {
  for (let index = 0; index < total; index += 1) {
    queue.setCursor(index);
    await queue.waitFor(index);
  }
}

describe("bindingFor(chunk)", () => {
  it("doré : sans `cast`, la clé et la requête sont celles d'aujourd'hui, au champ près", async () => {
    const { tts, requests } = recordingTts();
    const cache = new InMemoryAudioCache();
    const queue = new AudioQueue({ tts, cache, binding: BINDING }, { prefetchChunks: 0 });
    queue.reset([chunk(0, "Bonjour.")]);
    queue.setCursor(0);
    await queue.waitFor(0);
    expect(requests).toEqual([{ text: "Bonjour.", language: "fr", voice: "narrateur-v", model: "m", speed: 1.1, parameters: { a: 1 } }]);
    const todaysKey = computeCacheKey({
      providerId: "moteur",
      model: "m",
      voice: "narrateur-v",
      parameters: { a: 1 },
      speed: 1.1,
      language: "fr",
      spokenText: "Bonjour."
    });
    expect(await cache.get(todaysKey)).toBeDefined();
    expect(cacheKeyFor("moteur", BINDING, "Bonjour.")).toBe(todaysKey);
  });

  it("un passage du narrateur garde sa clé : une lecture à une seule voix ne change pas de cache", async () => {
    const { tts, requests } = recordingTts();
    const cache = new InMemoryAudioCache();
    const first = new AudioQueue({ tts, cache, binding: BINDING }, { prefetchChunks: 0 });
    first.reset([chunk(0, "Il était une fois.")]);
    await drain(first, 1);
    expect(requests).toHaveLength(1);

    const second = new AudioQueue({ tts, cache, binding: BINDING }, { prefetchChunks: 0 });
    second.reset([chunk(0, "Il était une fois.", { speakerId: "narrator" })]);
    await drain(second, 1);
    expect(requests).toHaveLength(1);
    expect(second.chunks[0]?.status).toBe("ready");
  });

  it("le `speakerId` n'entre ni dans la clé ni dans la requête : deux personnages sur une voix partagent l'audio", async () => {
    const { tts, requests } = recordingTts();
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache(), binding: BINDING }, { prefetchChunks: 0 });
    queue.reset([chunk(0, "Oui.", { speakerId: "romeo", voice: "v1" }), chunk(1, "Oui.", { speakerId: "juliette", voice: "v1" })]);
    await drain(queue, 2);
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).not.toContain("romeo");
    expect(cacheKeyFor("moteur", bindingForChunk(BINDING, { speakerId: "romeo", voice: "v1" }), "Oui.")).toBe(
      cacheKeyFor("moteur", bindingForChunk(BINDING, { speakerId: "autre", voice: "v1" }), "Oui.")
    );
  });

  it("une voix différente donne une clé différente et une requête exacte, le reste du binding gardé", async () => {
    const { tts, requests } = recordingTts();
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache(), binding: BINDING }, { prefetchChunks: 0 });
    queue.reset([chunk(0, "Oui."), chunk(1, "Oui.", { speakerId: "romeo", voice: "v2" })]);
    await drain(queue, 2);
    expect(requests).toEqual([
      { text: "Oui.", language: "fr", voice: "narrateur-v", model: "m", speed: 1.1, parameters: { a: 1 } },
      { text: "Oui.", language: "fr", voice: "v2", model: "m", speed: 1.1, parameters: { a: 1 } }
    ]);
    expect(cacheKeyFor("moteur", bindingForChunk(BINDING, { speakerId: "romeo", voice: "v2" }), "Oui.")).not.toBe(
      cacheKeyFor("moteur", BINDING, "Oui.")
    );
  });

  it("la voix, le modèle et les paramètres d'un personnage remplacent ceux de la session", () => {
    expect(bindingForChunk(BINDING, { speakerId: "r", voice: "v", model: "m2", parameters: { b: 2 } })).toEqual({
      language: "fr",
      voice: "v",
      model: "m2",
      speed: 1.1,
      parameters: { b: 2 }
    });
    expect(bindingForChunk(BINDING, undefined)).toBe(BINDING);
    expect(bindingForChunk(BINDING, { speakerId: "narrator" })).toBe(BINDING);
  });

  it("annuler garde le chunk synthétisable, et une seule requête à la fois entre voix", async () => {
    const { tts, requests, maxInFlight } = recordingTts();
    const queue = new AudioQueue({ tts, cache: new InMemoryAudioCache(), binding: BINDING }, { prefetchChunks: 3 });
    queue.reset([0, 1, 2, 3].map((index) => chunk(index, `Réplique ${index}.`, { speakerId: `r${index}`, voice: `v${index}` })));
    queue.setCursor(0);
    queue.cancelAll();
    expect(queue.chunks[0]?.status === "pending" || queue.chunks[0]?.status === "generating").toBe(true);
    await drain(queue, 4);
    expect(queue.chunks.every((item) => item.status === "ready")).toBe(true);
    expect(maxInFlight()).toBe(1);
    expect(requests.map((request) => request.voice).sort()).toEqual(["v0", "v1", "v2", "v3"]);
  });
});

describe("PlaybackController entre voix", () => {
  const segments = ["Un.", "Deux.", "Trois."].map((spokenText, index) => ({
    id: `seg-${index}`,
    spokenText,
    sourceSegmentIds: [`src-${index}`],
    sourceRanges: [{ startLine: index, startColumn: 0, endLine: index, endColumn: 4 }],
    ...(index === 1 ? { metadata: { cast: { speakerId: "romeo", voice: "v1" } } } : {})
  }));

  it("recopie `metadata.cast` sur le chunk, et le surlignage et l'enchaînement `enqueue` restent", async () => {
    const { tts, requests } = recordingTts();
    const sink = new FakeAudioSink({ tickMs: 250 });
    const controller = new PlaybackController({ cache: new InMemoryAudioCache() });
    const seen: { voice: string | undefined; line: number | undefined }[] = [];
    controller.onChunkChange((change) => seen.push({ voice: change.chunk.cast?.voice, line: change.sourceRanges[0]?.startLine }));
    await controller.start({ segments, profile: makeProfile(), tts, sink, prefetchChunks: 2 });
    for (let guard = 0; guard < 400 && (requests.length < 3 || sink.enqueues.length === 0); guard += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(sink.enqueues[0]?.chunkId).toBe(controller.getChunks()[1]?.id);
    expect(requests.map((request) => request.voice)).toEqual(["fake-voice", "v1", "fake-voice"]);
    expect(controller.getChunks()[1]?.cast).toEqual({ speakerId: "romeo", voice: "v1" });
    expect(seen[0]).toEqual({ voice: undefined, line: 0 });
    controller.dispose();
  });
});
