/** GAO-metteur-en-s-001 : la boucle `canStartNow` du contrôleur, sur une lecture préparée. */
import { describe, expect, it } from "vitest";
import type { TtsProvider } from "../../../src/core/index.js";
import { PlaybackController, type EarlyStartEvent } from "../../../src/playback/PlaybackController.js";
import { FakeAudioSink } from "../../fakes/FakeAudioSink.js";
import { makeProfile, makeSegments } from "./helpers.js";

function slowTts(durationMs: number | undefined, delayMs: number): { tts: TtsProvider; calls: () => number } {
  let calls = 0;
  const tts = {
    id: "moteur",
    health: async () => ({ status: "ok" as const }),
    getCapabilities: async () => ({ streaming: false, voices: [], parameters: [], formats: ["wav" as const], languages: ["fr"] }),
    synthesize: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { format: "wav" as const, data: new Uint8Array([1, 2, 3]), ...(durationMs !== undefined ? { durationMs } : {}) };
    }
  } as unknown as TtsProvider;
  return { tts, calls: () => calls };
}

const TOTAL = 6;

describe("démarrage anticipé dans le contrôleur", () => {
  it("durées connues, moteur bien plus rapide que l'écoute : le son part avant le dernier passage", async () => {
    const { tts, calls } = slowTts(10_000, 80);
    const controller = new PlaybackController({ retryJitterMs: 0 });
    const events: EarlyStartEvent[] = [];
    controller.onEarlyStart((event) => events.push(event));
    await controller.start({ segments: makeSegments(TOTAL), profile: makeProfile(), tts, sink: new FakeAudioSink(), startAhead: TOTAL - 1, prefetchChunks: TOTAL, earlyStart: true });
    expect(controller.getState()).toBe("playing");
    expect(events).toHaveLength(1);
    expect(events[0]?.measures).toBe(2);
    expect(events[0]?.ready).toBeLessThan(TOTAL - 1);
    expect(calls()).toBeLessThan(TOTAL + 1);
    controller.dispose();
  });

  it("sans durée connue : aucune mesure, repli sur l'attente de tous les passages", async () => {
    const { tts, calls } = slowTts(undefined, 60);
    const controller = new PlaybackController({ retryJitterMs: 0 });
    const events: EarlyStartEvent[] = [];
    controller.onEarlyStart((event) => events.push(event));
    await controller.start({ segments: makeSegments(TOTAL), profile: makeProfile(), tts, sink: new FakeAudioSink(), startAhead: TOTAL - 1, prefetchChunks: TOTAL, earlyStart: true });
    expect(events).toEqual([]);
    expect(calls()).toBe(TOTAL);
    controller.dispose();
  });

  it("moteur plus lent que l'écoute : on attend tout", async () => {
    const { tts, calls } = slowTts(100, 80);
    const controller = new PlaybackController({ retryJitterMs: 0 });
    const events: EarlyStartEvent[] = [];
    controller.onEarlyStart((event) => events.push(event));
    await controller.start({ segments: makeSegments(TOTAL), profile: makeProfile(), tts, sink: new FakeAudioSink(), startAhead: TOTAL - 1, prefetchChunks: TOTAL, earlyStart: true });
    expect(events).toEqual([]);
    expect(calls()).toBe(TOTAL);
    controller.dispose();
  });
});
