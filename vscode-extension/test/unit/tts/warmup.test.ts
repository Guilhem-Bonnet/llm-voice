import { describe, expect, it } from "vitest";
import { WARMUP_TEXT, warmupProvider } from "../../../src/tts/warmup.js";
import { FakeTtsProvider } from "../../fakes/FakeTtsProvider.js";

describe("warmupProvider (S6.2, llmVoice.tts.warmup)", () => {
  it("calls health() then a short synthesize(), and reports ok with timings", async () => {
    const tts = new FakeTtsProvider();
    const result = await warmupProvider(tts, { language: "fr" });

    expect(result.ok).toBe(true);
    expect(result.providerId).toBe(tts.id);
    expect(result.healthMs).toBeGreaterThanOrEqual(0);
    expect(result.synthesisMs).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.audio).toBeDefined();
    expect(tts.requests).toHaveLength(1);
    expect(tts.requests[0]?.text).toBe(WARMUP_TEXT);
    expect(tts.requests[0]?.language).toBe("fr");
  });

  it("forwards voice when provided", async () => {
    const tts = new FakeTtsProvider();
    await warmupProvider(tts, { voice: "Emily.wav" });
    expect(tts.requests[0]?.voice).toBe("Emily.wav");
  });

  it("never throws: an unreachable provider (health() rejects) reports ok: false", async () => {
    const tts: Parameters<typeof warmupProvider>[0] = {
      id: "broken",
      health: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      getCapabilities: async () => ({ streaming: false, voices: [], parameters: [], formats: ["wav"], languages: [] }),
      synthesize: async () => {
        throw new Error("unreachable");
      }
    };

    const result = await warmupProvider(tts);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
    expect(result.audio).toBeUndefined();
  });

  it("never throws: health() ok but synthesize() rejects still reports ok: false", async () => {
    const tts = new FakeTtsProvider({ failFromNth: 1 });
    const result = await warmupProvider(tts);

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.healthMs).toBeGreaterThanOrEqual(0);
  });
});
