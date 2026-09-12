/**
 * Validation of a voice-cloning reference sample (CdC §55, S8.2 "Use My Own
 * Voice"), by reading its header rather than trusting its extension or
 * size alone.
 *
 * Deliberately pure/offline: no `node:fs`, no `vscode`. `UseOwnVoice.ts`
 * reads the file and hands the bytes here; this module never touches disk
 * or network itself, which is what makes it usable from plain-Node vitest
 * and keeps the "tout reste local" guarantee legible — nothing in this file
 * *could* leave the machine even by mistake.
 *
 * Only WAV (RIFF/PCM) is parsed in depth: it is both the format
 * `ChatterboxProvider` re-encodes towards and the one a local recording
 * command (`pw-record`, `arecord`) produces directly. Other accepted
 * extensions (`mp3`, `flac`, `ogg`, `opus`, `m4a`, see
 * `REFERENCE_AUDIO_EXTENSIONS`) are recognised but not decoded here —
 * `UseOwnVoice.ts` converts them to WAV with `ffmpeg` when available before
 * calling `validateWavReferenceAudio`, and explains the limitation when it
 * is not (`describeUnverifiedFormat`).
 */

/** What this module actually learns about a WAV sample. */
export interface WavAudioInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationMs: number;
  /**
   * Root-mean-square amplitude of 16-bit PCM samples, normalised to
   * `[0, 1]`. `undefined` for bit depths this module does not decode
   * (8/24/32-bit) — the silence check is then skipped rather than guessed.
   */
  rms: number | undefined;
}

export type ReferenceAudioRejectionReason =
  | "not-wav"
  | "unsupported-encoding"
  | "too-short"
  | "too-long"
  | "silent";

export type ReferenceAudioValidation =
  | { ok: true; info: WavAudioInfo; warnings: readonly string[] }
  | { ok: false; reason: ReferenceAudioRejectionReason; detail: string };

/** Below this, a sample is unusable for cloning — hard rejection. */
export const MIN_REFERENCE_DURATION_MS = 3_000;
/** CdC §55/`docs/voices.md`: the range that produced good results in practice. */
export const RECOMMENDED_MIN_DURATION_MS = 10_000;
export const RECOMMENDED_MAX_DURATION_MS = 30_000;
/** Above this, still accepted but flagged — most engines only use the first seconds anyway. */
export const MAX_REFERENCE_DURATION_MS = 120_000;
/** RMS below this (of a `[-1, 1]`-normalised 16-bit signal) is treated as silence. */
export const SILENCE_RMS_THRESHOLD = 0.01;

interface RiffChunk {
  id: string;
  start: number;
  size: number;
}

/** Walks RIFF chunks after the 12-byte `RIFF....WAVE` header, tolerating any chunk order/padding. */
function* riffChunks(buffer: Uint8Array): Generator<RiffChunk> {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = String.fromCharCode(buffer[offset]!, buffer[offset + 1]!, buffer[offset + 2]!, buffer[offset + 3]!);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    yield { id, start, size };
    // Chunks are word-aligned: an odd size is followed by one padding byte.
    offset = start + size + (size % 2);
  }
}

/**
 * Parses a WAV buffer's `fmt `/`data` chunks, tolerating extra chunks
 * (`LIST`, `fact`, `JUNK`...) that a real recorder or editor commonly
 * inserts between them — unlike the canonical-44-byte-header assumption of
 * `test/fakes/wav.ts` (a generator, not a reader for arbitrary input).
 * Returns `undefined` when `buffer` is not a RIFF/WAVE container at all.
 */
export function parseWavHeader(buffer: Uint8Array): WavAudioInfo | undefined {
  if (buffer.length < 12) {
    return undefined;
  }
  const riff = String.fromCharCode(buffer[0]!, buffer[1]!, buffer[2]!, buffer[3]!);
  const wave = String.fromCharCode(buffer[8]!, buffer[9]!, buffer[10]!, buffer[11]!);
  if (riff !== "RIFF" || wave !== "WAVE") {
    return undefined;
  }

  let channels: number | undefined;
  let sampleRate: number | undefined;
  let bitsPerSample: number | undefined;
  let audioFormat: number | undefined;
  let dataStart: number | undefined;
  let dataSize: number | undefined;

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (const chunk of riffChunks(buffer)) {
    if (chunk.id === "fmt " && chunk.size >= 16 && chunk.start + 16 <= buffer.byteLength) {
      audioFormat = view.getUint16(chunk.start, true);
      channels = view.getUint16(chunk.start + 2, true);
      sampleRate = view.getUint32(chunk.start + 4, true);
      bitsPerSample = view.getUint16(chunk.start + 14, true);
    } else if (chunk.id === "data") {
      dataStart = chunk.start;
      // A streamed/truncated capture can under-report or omit `data`'s
      // size; clamp to what is actually in the buffer either way.
      dataSize = Math.min(chunk.size, buffer.byteLength - chunk.start);
    }
  }

  if (
    channels === undefined ||
    sampleRate === undefined ||
    bitsPerSample === undefined ||
    dataStart === undefined ||
    dataSize === undefined ||
    channels === 0 ||
    sampleRate === 0
  ) {
    return undefined;
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channels;
  const durationMs = frameSize > 0 ? (dataSize / frameSize / sampleRate) * 1000 : 0;

  // PCM (1) and IEEE float (3) are both fine to *carry*; only 16-bit PCM is
  // decoded for the loudness check below (see `WavAudioInfo.rms`'s doc).
  const rms =
    audioFormat === 1 && bitsPerSample === 16
      ? computeRms16(view, dataStart, dataSize, channels)
      : undefined;

  return { sampleRate, channels, bitsPerSample, durationMs, rms };
}

function computeRms16(view: DataView, dataStart: number, dataSize: number, channels: number): number {
  const bytesPerSample = 2;
  const frameSize = bytesPerSample * channels;
  const frameCount = Math.floor(dataSize / frameSize);
  if (frameCount === 0) {
    return 0;
  }
  let sumSquares = 0;
  let sampleCount = 0;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const byteOffset = dataStart + frame * frameSize + channel * bytesPerSample;
      if (byteOffset + 2 > view.byteLength) {
        break;
      }
      const sample = view.getInt16(byteOffset, true) / 0x8000;
      sumSquares += sample * sample;
      sampleCount += 1;
    }
  }
  return sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The full validation a candidate reference sample must pass before it is
 * copied into `globalStorageUri/voices/` and referenced by a profile.
 * Duration and silence are hard rejections; everything else is a warning
 * shown to the user but not blocking (CdC §55 recommends 10-30 s, it does
 * not require it).
 */
export function validateWavReferenceAudio(buffer: Uint8Array): ReferenceAudioValidation {
  const info = parseWavHeader(buffer);
  if (info === undefined) {
    return { ok: false, reason: "not-wav", detail: "Fichier non reconnu comme WAV (RIFF/WAVE)." };
  }
  if (info.durationMs < MIN_REFERENCE_DURATION_MS) {
    return {
      ok: false,
      reason: "too-short",
      detail: `Durée ${formatSeconds(info.durationMs)} : trop court pour cloner une voix (minimum ${formatSeconds(MIN_REFERENCE_DURATION_MS)}).`
    };
  }
  if (info.durationMs > MAX_REFERENCE_DURATION_MS) {
    return {
      ok: false,
      reason: "too-long",
      detail: `Durée ${formatSeconds(info.durationMs)} : trop long (maximum ${formatSeconds(MAX_REFERENCE_DURATION_MS)}).`
    };
  }
  if (info.rms !== undefined && info.rms < SILENCE_RMS_THRESHOLD) {
    return {
      ok: false,
      reason: "silent",
      detail: "Le fichier semble silencieux (niveau audio quasi nul) — vérifiez le micro et réessayez."
    };
  }

  const warnings: string[] = [];
  if (info.durationMs < RECOMMENDED_MIN_DURATION_MS) {
    warnings.push(
      `Durée ${formatSeconds(info.durationMs)} : recommandé entre ${formatSeconds(RECOMMENDED_MIN_DURATION_MS)} et ${formatSeconds(RECOMMENDED_MAX_DURATION_MS)}.`
    );
  } else if (info.durationMs > RECOMMENDED_MAX_DURATION_MS) {
    warnings.push(
      `Durée ${formatSeconds(info.durationMs)} : au-delà de la plage recommandée (${formatSeconds(RECOMMENDED_MIN_DURATION_MS)} à ${formatSeconds(RECOMMENDED_MAX_DURATION_MS)}).`
    );
  }
  if (info.channels > 1) {
    warnings.push("Fichier stéréo : sera converti en mono.");
  }
  if (info.sampleRate !== 24000) {
    warnings.push(`Fréquence ${info.sampleRate} Hz : sera reconverti en 24 kHz si possible.`);
  }
  if (info.rms === undefined) {
    warnings.push("Format audio non décodé pour la vérification de niveau (accepté sans ce contrôle).");
  }

  return { ok: true, info, warnings };
}

/** Shown when a non-WAV file could not be converted (`ffmpeg` unavailable) and cannot be probed here. */
export function describeUnverifiedFormat(extension: string): string {
  return (
    `Le fichier ${extension} n'a pas pu être vérifié en profondeur (ffmpeg indisponible) — ` +
    "seuls le format et la taille ont été contrôlés. Un fichier WAV mono 24 kHz de 10 à 30 s donne les meilleurs résultats."
  );
}
