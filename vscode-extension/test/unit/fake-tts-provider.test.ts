import { describe, expect, it } from "vitest";
import { FakeTtsProvider } from "../fakes/FakeTtsProvider.js";
import { getWavDurationMs } from "../fakes/wav.js";

function decodeAudioUri(audioUri: string): Buffer {
  const base64 = audioUri.split(",")[1] ?? "";
  return Buffer.from(base64, "base64");
}

describe("FakeTtsProvider", () => {
  it("produces a WAV whose duration matches wordCount * msPerWord", async () => {
    const provider = new FakeTtsProvider({ msPerWord: 100 });
    const result = await provider.synthesize({ text: "Bonjour le monde aujourd'hui" });

    expect(result.durationMs).toBe(400); // 4 words * 100ms
    const wav = decodeAudioUri(result.audioUri);
    expect(getWavDurationMs(wav)).toBeCloseTo(400, 0);
  });

  it("uses a configurable msPerWord", async () => {
    const provider = new FakeTtsProvider({ msPerWord: 50 });
    const result = await provider.synthesize({ text: "un deux" });
    expect(result.durationMs).toBe(100);
  });

  it("records every request in an internal journal", async () => {
    const provider = new FakeTtsProvider();
    await provider.synthesize({ text: "premier" });
    await provider.synthesize({ text: "second appel" });

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.text).toBe("premier");
    expect(provider.requests[1]?.text).toBe("second appel");
  });

  it("rejects with an AbortError when the signal is already aborted", async () => {
    const provider = new FakeTtsProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(provider.synthesize({ text: "test" }, controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
  });

  it("rejects with an AbortError when aborted during latency", async () => {
    const provider = new FakeTtsProvider({ latencyMs: 200 });
    const controller = new AbortController();
    const pending = provider.synthesize({ text: "test" }, controller.signal);

    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails every Nth request when failEveryNth is set", async () => {
    const provider = new FakeTtsProvider({ failEveryNth: 2 });

    await expect(provider.synthesize({ text: "ok" })).resolves.toBeDefined();
    await expect(provider.synthesize({ text: "fails" })).rejects.toThrow(/simulated failure/);
    await expect(provider.synthesize({ text: "ok again" })).resolves.toBeDefined();
  });

  it("synthesizeStream emits exactly 3 frames, the last one marked final", async () => {
    const provider = new FakeTtsProvider({ msPerWord: 60 });
    const frames = [];
    for await (const frame of provider.synthesizeStream({ text: "un deux trois quatre" })) {
      frames.push(frame);
    }

    expect(frames).toHaveLength(3);
    expect(frames[0]?.isFinal).toBe(false);
    expect(frames[1]?.isFinal).toBe(false);
    expect(frames[2]?.isFinal).toBe(true);

    const totalBytes = frames.reduce((sum, frame) => sum + frame.data.length, 0);
    expect(totalBytes).toBeGreaterThan(44); // at least the WAV header
  });

  it("exposes health() and getCapabilities()", async () => {
    const provider = new FakeTtsProvider();
    await expect(provider.health()).resolves.toEqual({ ok: true });
    await expect(provider.getCapabilities()).resolves.toMatchObject({ streaming: true });
  });
});
