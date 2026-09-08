/**
 * Minimal WAV (RIFF/PCM) generator and reader, pure Node stdlib.
 *
 * Used by the fake TTS providers and mock HTTP servers to produce very
 * small, deterministic audio files without any GPU or network dependency
 * (cahier-des-charges.md §78).
 */

const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;

export interface WavHeaderInfo {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  dataSize: number;
  durationMs: number;
}

function buildWavBuffer(samples: Int16Array, sampleRate: number): Buffer {
  const dataSize = samples.length * BYTES_PER_SAMPLE;
  const byteRate = sampleRate * CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = CHANNELS * BYTES_PER_SAMPLE;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");

  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);

  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i]!, 44 + i * BYTES_PER_SAMPLE);
  }

  return buffer;
}

function sampleCountFor(durationMs: number, sampleRate: number): number {
  return Math.max(0, Math.round((durationMs / 1000) * sampleRate));
}

/** Generates a mono 16-bit PCM WAV buffer of pure digital silence. */
export function makeSilentWav(durationMs: number, sampleRate = 16000): Buffer {
  const numSamples = sampleCountFor(durationMs, sampleRate);
  const samples = new Int16Array(numSamples);
  return buildWavBuffer(samples, sampleRate);
}

/** Generates a mono 16-bit PCM WAV buffer containing a sine tone. */
export function makeToneWav(durationMs: number, freqHz: number, sampleRate = 16000): Buffer {
  const numSamples = sampleCountFor(durationMs, sampleRate);
  const samples = new Int16Array(numSamples);
  const amplitude = 0.5 * 0x7fff;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    samples[i] = Math.round(amplitude * Math.sin(2 * Math.PI * freqHz * t));
  }

  return buildWavBuffer(samples, sampleRate);
}

/** Parses a WAV buffer's RIFF/fmt/data headers. Throws on malformed input. */
export function readWavHeader(buffer: Buffer | Uint8Array): WavHeaderInfo {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("readWavHeader: not a valid RIFF/WAVE buffer");
  }
  if (buf.toString("ascii", 12, 16) !== "fmt " || buf.toString("ascii", 36, 40) !== "data") {
    throw new Error("readWavHeader: unsupported WAV layout (expected canonical 44-byte header)");
  }

  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  const dataSize = buf.readUInt32LE(40);
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = dataSize / (bytesPerSample * numChannels);
  const durationMs = sampleRate > 0 ? (numSamples / sampleRate) * 1000 : 0;

  return { sampleRate, numChannels, bitsPerSample, dataSize, durationMs };
}

/** Convenience: recomputed duration in ms from a generated WAV buffer. */
export function getWavDurationMs(buffer: Buffer | Uint8Array): number {
  return readWavHeader(buffer).durationMs;
}
