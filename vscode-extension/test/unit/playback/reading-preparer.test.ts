/** ADR-018 §5.2, partie livrée avec le choix « Préparer » : même file, mêmes clés, aucun sink. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TtsHoldError, type TtsProvider, type TtsRequest } from "../../../src/core/index.js";
import { InMemoryAudioCache } from "../../../src/playback/AudioCache.js";
import { AudioQueue } from "../../../src/playback/AudioQueue.js";
import { ReadingPreparer } from "../../../src/playback/ReadingPreparer.js";

function chunks(total: number) {
  return Array.from({ length: total }, (_, index) => ({
    id: `s:${index}`,
    sessionId: "s",
    spokenText: `Passage ${index}.`,
    sourceRanges: [],
    status: "pending" as const,
    ...(index % 2 === 1 ? { cast: { speakerId: "r", voice: "v" } } : {})
  }));
}

function tts(behaviour: (request: TtsRequest) => void = () => {}): { provider: TtsProvider; requests: TtsRequest[] } {
  const requests: TtsRequest[] = [];
  const provider = {
    id: "moteur",
    health: async () => ({ status: "ok" as const }),
    getCapabilities: async () => ({ streaming: false, voices: [], parameters: [], formats: ["wav" as const], languages: ["fr"] }),
    synthesize: async (request: TtsRequest) => {
      requests.push(request);
      behaviour(request);
      return { format: "wav" as const, data: new Uint8Array([1]), durationMs: 100 };
    }
  } as unknown as TtsProvider;
  return { provider, requests };
}

describe("ReadingPreparer", () => {
  it("remplit le cache dans l'ordre et rapporte un progrès réel ; la file de lecture ne génère ensuite plus rien", async () => {
    const { provider, requests } = tts();
    const cache = new InMemoryAudioCache();
    const progress: number[] = [];
    const preparer = new ReadingPreparer({ tts: provider, cache, binding: { voice: "n" } });
    const outcome = await preparer.run(chunks(4), (done) => progress.push(done));
    expect(outcome).toEqual({ status: "ready", done: 4, total: 4 });
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(requests.map((request) => request.voice)).toEqual(["n", "v", "n", "v"]);

    const queue = new AudioQueue({ tts: provider, cache, binding: { voice: "n" } }, { prefetchChunks: 0 });
    queue.reset(chunks(4));
    for (let index = 0; index < 4; index += 1) {
      queue.setCursor(index);
      await queue.waitFor(index);
    }
    expect(requests).toHaveLength(4);
  });

  it("annuler arrête le travail, et reprendre ne génère que ce qui manque", async () => {
    const cache = new InMemoryAudioCache();
    let preparer: ReadingPreparer | undefined;
    const { provider, requests } = tts();
    preparer = new ReadingPreparer({ tts: provider, cache, binding: {} });
    const outcome = await preparer.run(chunks(4), (done) => {
      if (done === 2) {
        preparer?.cancel();
      }
    });
    expect(outcome.status).toBe("cancelled");
    expect(outcome.done).toBe(2);
    expect(requests).toHaveLength(2);

    const again = await new ReadingPreparer({ tts: provider, cache, binding: {} }).run(chunks(4));
    expect(again.status).toBe("ready");
    expect(requests).toHaveLength(4);
  });

  it("le mode jeu arrête la préparation sans insister", async () => {
    const { provider, requests } = tts((request) => {
      if (request.text === "Passage 1.") {
        throw new TtsHoldError("gpu-yield", "Mode jeu");
      }
    });
    const outcome = await new ReadingPreparer({ tts: provider, cache: new InMemoryAudioCache(), binding: {} }).run(chunks(3));
    expect(outcome).toEqual({ status: "held", holdReason: "gpu-yield", done: 1, total: 3 });
    expect(requests).toHaveLength(2);
  });

  it("n'a aucun sink : il ne peut rien lire", () => {
    const code = readFileSync(resolve(__dirname, "../../../src/playback/ReadingPreparer.ts"), "utf8");
    expect(code).not.toMatch(/AudioSink|\.play\(|from "vscode"/);
  });
});
