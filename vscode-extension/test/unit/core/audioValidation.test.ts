import { describe, expect, it } from "vitest";
import {
  describeUnverifiedFormat,
  MAX_REFERENCE_DURATION_MS,
  MIN_REFERENCE_DURATION_MS,
  parseWavHeader,
  RECOMMENDED_MAX_DURATION_MS,
  RECOMMENDED_MIN_DURATION_MS,
  validateWavReferenceAudio
} from "../../../src/core/audioValidation.js";
import { makeSilentWav, makeToneWav } from "../../fakes/wav.js";

describe("parseWavHeader", () => {
  it("reads a canonical WAV header", () => {
    const wav = makeToneWav(500, 440, 24000);
    const info = parseWavHeader(new Uint8Array(wav));
    expect(info).toBeDefined();
    expect(info?.sampleRate).toBe(24000);
    expect(info?.channels).toBe(1);
    expect(info?.bitsPerSample).toBe(16);
    expect(info?.durationMs).toBeCloseTo(500, 0);
    expect(info?.rms).toBeGreaterThan(0);
  });

  it("returns undefined for a non-RIFF buffer", () => {
    expect(parseWavHeader(new TextEncoder().encode("not a wav"))).toBeUndefined();
  });

  it("tolerates an extra LIST chunk before data", () => {
    const canonical = makeToneWav(300, 300, 16000);
    // Insert a fake "LIST" chunk of 4 padding bytes right after `fmt ` (offset 36)
    // — a real WAV recorder/editor commonly does this before `data`.
    const listChunk = Buffer.from("LIST\x04\x00\x00\x00abcd", "binary");
    const withList = Buffer.concat([canonical.subarray(0, 36), listChunk, canonical.subarray(36)]);
    // Fix up RIFF size to account for the inserted bytes.
    withList.writeUInt32LE(withList.length - 8, 4);

    const info = parseWavHeader(new Uint8Array(withList));
    expect(info).toBeDefined();
    expect(info?.sampleRate).toBe(16000);
    expect(info?.durationMs).toBeCloseTo(300, 0);
  });

  it("does not compute rms for non-16-bit-PCM data", () => {
    const wav = makeToneWav(200, 400, 16000);
    // Flip the fmt chunk's bitsPerSample field (offset 34) to 8 bits.
    const mutated = Buffer.from(wav);
    mutated.writeUInt16LE(8, 34);
    const info = parseWavHeader(new Uint8Array(mutated));
    expect(info?.rms).toBeUndefined();
  });
});

describe("validateWavReferenceAudio", () => {
  it("rejects a non-WAV buffer", () => {
    const result = validateWavReferenceAudio(new TextEncoder().encode("hello"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not-wav");
    }
  });

  it("rejects a sample shorter than the hard minimum", () => {
    const wav = makeToneWav(MIN_REFERENCE_DURATION_MS - 500, 300, 24000);
    const result = validateWavReferenceAudio(new Uint8Array(wav));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("too-short");
    }
  });

  it("rejects a sample longer than the hard maximum", () => {
    // A long silent WAV would also be flagged silent; use a short tone
    // buffer tiled instead — actually simplest is to just exceed the max
    // with a tone (loud enough to not fail the silence gate).
    const wav = makeToneWav(MAX_REFERENCE_DURATION_MS + 5_000, 300, 8000);
    const result = validateWavReferenceAudio(new Uint8Array(wav));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("too-long");
    }
  });

  it("rejects a silent sample", () => {
    const wav = makeSilentWav(15_000, 24000);
    const result = validateWavReferenceAudio(new Uint8Array(wav));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("silent");
    }
  });

  it("accepts a sample in the recommended range with no warnings", () => {
    const durationMs = (RECOMMENDED_MIN_DURATION_MS + RECOMMENDED_MAX_DURATION_MS) / 2;
    const wav = makeToneWav(durationMs, 300, 24000);
    const result = validateWavReferenceAudio(new Uint8Array(wav));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toHaveLength(0);
    }
  });

  it("accepts but warns on a too-short-of-recommended, stereo, non-24kHz sample", () => {
    const durationMs = RECOMMENDED_MIN_DURATION_MS - 1_000;
    const mono = makeToneWav(durationMs, 300, 16000);
    // Duplicate each sample to fake stereo (interleaved L/R) and bump the fmt
    // chunk's channel count — good enough to exercise the warning path.
    const stereo = Buffer.from(mono);
    stereo.writeUInt16LE(2, 22); // numChannels
    stereo.writeUInt32LE(16000 * 2 * 2, 28); // byteRate
    stereo.writeUInt16LE(2 * 2, 32); // blockAlign

    const result = validateWavReferenceAudio(new Uint8Array(stereo));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((warning) => warning.includes("recommandé"))).toBe(true);
      expect(result.warnings.some((warning) => warning.includes("stéréo"))).toBe(true);
      expect(result.warnings.some((warning) => warning.includes("24 kHz"))).toBe(true);
    }
  });
});

describe("describeUnverifiedFormat", () => {
  it("mentions the extension and the recommended profile", () => {
    const message = describeUnverifiedFormat(".mp3");
    expect(message).toContain(".mp3");
    expect(message).toContain("ffmpeg");
  });
});
