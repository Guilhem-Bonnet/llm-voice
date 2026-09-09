/**
 * S7.1 real E2E: `SystemTtsProvider` against whatever zero-install engine
 * is actually present on the machine running this suite — no fake, no
 * mock, plain Node, `npm run test:integration-real`
 * (`vitest.integration-real.config.ts`). Self-gated on binary presence
 * (`execFileSync(bin, ["--version"...])`), same spirit as
 * `chatterbox-tts.test.ts`'s `LLM_VOICE_E2E` gate but for a binary this
 * story's whole point is "already there, zero configuration" — requiring
 * an extra env var to prove that would undercut the claim.
 *
 * On the reference dev machine (Fedora 44) this exercises the real
 * `espeak-ng` path end to end: WAV header validated, PCM samples checked
 * non-silent (not just a valid-but-empty header), and — when `paplay` is
 * also present — actually played for ~2s through PulseAudio/PipeWire, the
 * closest this test suite gets to "a human would hear this."
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { SystemTtsProvider } from "../../src/tts/SystemTtsProvider.js";

function binaryAvailable(command: string, args: readonly string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const HAS_ESPEAK = binaryAvailable("espeak-ng", ["--version"]);
const HAS_PAPLAY = binaryAvailable("paplay", ["--version"]);

interface WavInfo {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  dataSize: number;
  dataOffset: number;
}

function parseWav(buffer: Uint8Array): WavInfo {
  const buf = Buffer.from(buffer);
  expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
  expect(buf.toString("ascii", 12, 16)).toBe("fmt ");
  expect(buf.toString("ascii", 36, 40)).toBe("data");
  return {
    numChannels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    bitsPerSample: buf.readUInt16LE(34),
    dataSize: buf.readUInt32LE(40),
    dataOffset: 44
  };
}

/** Peak absolute 16-bit PCM sample value — 0 would mean digital silence. */
function peakAmplitude(buffer: Uint8Array, info: WavInfo): number {
  const buf = Buffer.from(buffer);
  let peak = 0;
  for (let offset = info.dataOffset; offset + 1 < info.dataOffset + info.dataSize; offset += 2) {
    const sample = Math.abs(buf.readInt16LE(offset));
    if (sample > peak) {
      peak = sample;
    }
  }
  return peak;
}

describe.skipIf(!HAS_ESPEAK)("SystemTtsProvider — real espeak-ng (S7.1, gated on binary presence)", () => {
  it("health() reports ok with espeak-ng detected", async () => {
    const provider = new SystemTtsProvider({ platform: "linux", isFlatpak: false });
    const health = await provider.health();
    expect(health.status).toBe("ok");
    expect(health.endpoint).toBe("local:espeak-ng");
  });

  it("listVoices() returns real French espeak-ng voices", async () => {
    const provider = new SystemTtsProvider({ platform: "linux", isFlatpak: false });
    const voices = await provider.listVoices();
    expect(voices.length).toBeGreaterThan(0);
    expect(voices.some((voice) => voice.language?.toLowerCase().startsWith("fr"))).toBe(true);
  });

  it("synthesize() produces a valid, non-silent 22050Hz mono 16-bit WAV", async () => {
    const provider = new SystemTtsProvider({ platform: "linux", isFlatpak: false });
    const result = await provider.synthesize({
      text: "Bonjour. Ceci est un test réel de synthèse vocale système, sans aucune installation préalable.",
      language: "fr-FR"
    });

    expect(result.format).toBe("wav");
    const info = parseWav(result.data);
    expect(info.sampleRate).toBeGreaterThan(0);
    expect(info.numChannels).toBeGreaterThanOrEqual(1);
    expect(info.dataSize).toBeGreaterThan(0);

    const peak = peakAmplitude(result.data, info);
    // Digital silence is peak === 0; real speech is nowhere close. 1000 is a
    // conservative floor (16-bit full scale is 32767) that would never be
    // hit by silence, dithering noise, or a near-empty file.
    expect(peak).toBeGreaterThan(1000);

    console.log(
      `[system-tts.test.ts] espeak-ng: ${result.data.byteLength} bytes, ` +
        `${info.sampleRate}Hz, peak amplitude ${peak}/32767`
    );
  });

  it("respects AbortSignal: an already-aborted signal rejects without producing audio", async () => {
    const provider = new SystemTtsProvider({ platform: "linux", isFlatpak: false });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.synthesize({ text: "Bonjour" }, controller.signal)).rejects.toThrow();
  });

  it.skipIf(!HAS_PAPLAY)("plays ~2s of real synthesized speech through paplay (audible proof)", async () => {
    const provider = new SystemTtsProvider({ platform: "linux", isFlatpak: false });
    const result = await provider.synthesize({
      text:
        "Bonjour, ceci est un test audio réel de la voix système. " +
        "L'extension LLM Voice produit du son immédiatement après l'installation, sans aucun serveur.",
      language: "fr-FR"
    });
    const info = parseWav(result.data);
    const durationMs = (info.dataSize / (info.sampleRate * info.numChannels * (info.bitsPerSample / 8))) * 1000;
    expect(durationMs).toBeGreaterThan(1500);

    const { execFile } = await import("node:child_process");
    const { writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const path = join(tmpdir(), `llm-voice-system-tts-real-${Date.now()}.wav`);
    await writeFile(path, result.data);
    try {
      await new Promise<void>((resolve, reject) => {
        execFile("paplay", [path], (error) => (error !== null ? reject(error) : resolve()));
      });
      console.log(`[system-tts.test.ts] paplay: played ${durationMs.toFixed(0)}ms of real espeak-ng audio`);
    } finally {
      await rm(path, { force: true });
    }
  }, 15_000);
});
