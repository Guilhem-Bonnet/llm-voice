import { describe, expect, it } from "vitest";
import { getWavDurationMs, makeSilentWav, makeToneWav, readWavHeader } from "../fakes/wav.js";

describe("wav fakes", () => {
  it("makeSilentWav produces a valid RIFF/WAVE header", () => {
    const wav = makeSilentWav(200, 16000);

    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.toString("ascii", 36, 40)).toBe("data");
  });

  it("makeSilentWav sizes the buffer according to duration and sample rate", () => {
    const wav = makeSilentWav(500, 16000);
    const header = readWavHeader(wav);

    // 500ms @ 16kHz mono 16-bit => 8000 samples * 2 bytes = 16000 bytes of data
    expect(header.dataSize).toBe(16000);
    expect(wav.length).toBe(44 + 16000);
    expect(header.sampleRate).toBe(16000);
    expect(header.numChannels).toBe(1);
    expect(header.bitsPerSample).toBe(16);
  });

  it("recomputes a duration close to the requested one", () => {
    const wav = makeSilentWav(1234, 16000);
    expect(getWavDurationMs(wav)).toBeCloseTo(1234, 0);
  });

  it("silence contains only zero samples", () => {
    const wav = makeSilentWav(50, 8000);
    const dataStart = 44;
    for (let i = dataStart; i < wav.length; i++) {
      expect(wav[i]).toBe(0);
    }
  });

  it("makeToneWav produces a valid header and non-silent data", () => {
    const wav = makeToneWav(100, 440, 16000);
    const header = readWavHeader(wav);

    expect(header.sampleRate).toBe(16000);
    expect(getWavDurationMs(wav)).toBeCloseTo(100, 0);

    const hasNonZeroSample = wav.subarray(44).some((byte) => byte !== 0);
    expect(hasNonZeroSample).toBe(true);
  });

  it("readWavHeader rejects malformed buffers", () => {
    expect(() => readWavHeader(Buffer.from("not a wav"))).toThrow();
  });

  it("supports custom sample rates", () => {
    const wav = makeSilentWav(1000, 22050);
    const header = readWavHeader(wav);
    expect(header.sampleRate).toBe(22050);
    expect(header.dataSize).toBe(22050 * 2);
  });
});
