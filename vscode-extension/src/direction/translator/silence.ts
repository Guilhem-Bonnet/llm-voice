/**
 * Silence segments (ADR-015 §5.4): an exact pause is a file of zero samples put
 * in the queue between two cues, so the duration is exact by construction and
 * the Core v1 protocol does not change. Pure, no `vscode`, no I/O.
 */

import { createHash } from "node:crypto";

export type SilenceFormat = "wav" | "pcm16le";

/** 24 kHz mono: what the local engines (Chatterbox) produce; any integer kHz keeps whole-millisecond durations exact. */
export const DEFAULT_SILENCE_SAMPLE_RATE = 24_000;
export const SILENCE_CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;

export interface SilenceSpec {
  readonly durationMs: number;
  readonly format?: SilenceFormat;
  readonly sampleRate?: number;
}

export interface SilenceMedia {
  readonly format: SilenceFormat;
  readonly sampleRate: number;
  readonly channels: typeof SILENCE_CHANNELS;
  /** Cache key: duration + format + sample rate (ADR-015 §5.4), nothing else. */
  readonly cacheKey: string;
}

function samplesFor(durationMs: number, sampleRate: number): number {
  return Math.round((durationMs * sampleRate) / 1000);
}

export function silenceMedia(spec: SilenceSpec): SilenceMedia {
  const format = spec.format ?? "wav";
  const sampleRate = spec.sampleRate ?? DEFAULT_SILENCE_SAMPLE_RATE;
  const cacheKey = createHash("sha256")
    .update(["silence", String(spec.durationMs), format, String(sampleRate)].join("\u0000"), "utf8")
    .digest("hex");
  return { format, sampleRate, channels: SILENCE_CHANNELS, cacheKey };
}

/** The bytes of a silence: a canonical 44-byte-header PCM16 WAV, or headerless `pcm16le`. */
export function buildSilence(spec: SilenceSpec): Uint8Array {
  const format = spec.format ?? "wav";
  const sampleRate = spec.sampleRate ?? DEFAULT_SILENCE_SAMPLE_RATE;
  const dataBytes = samplesFor(spec.durationMs, sampleRate) * SILENCE_CHANNELS * BYTES_PER_SAMPLE;
  if (format === "pcm16le") {
    return new Uint8Array(dataBytes);
  }
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, SILENCE_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * SILENCE_CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(32, SILENCE_CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

/** Duration, in milliseconds, of bytes produced by `buildSilence` (used to prove exactness). */
export function silenceDurationMs(bytes: Uint8Array, media: Pick<SilenceMedia, "format" | "sampleRate">): number {
  const dataBytes = media.format === "wav" ? bytes.byteLength - WAV_HEADER_BYTES : bytes.byteLength;
  return (dataBytes / (SILENCE_CHANNELS * BYTES_PER_SAMPLE) / media.sampleRate) * 1000;
}
