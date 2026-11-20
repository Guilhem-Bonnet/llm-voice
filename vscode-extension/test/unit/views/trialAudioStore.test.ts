/** The gallery's local cache of trial phrases, on a real folder. */
import { mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findTrial, storeTrial, trialKey } from "../../../src/views/voiceGallery/trialAudioStore.js";

const BINDING = { providerId: "kyutai-pocket", baseUrl: "http://localhost:8000", voice: "alba" };
const DATA = new Uint8Array([1, 2, 3]);

describe("trial audio store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "llm-voice-trials-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("a key changes with anything that changes the audio, and only names hex", () => {
    const base = trialKey(BINDING, "fr-FR", "Bonjour");
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    for (const other of [
      trialKey({ ...BINDING, voice: "vera" }, "fr-FR", "Bonjour"),
      trialKey({ ...BINDING, baseUrl: "http://localhost:9000" }, "fr-FR", "Bonjour"),
      trialKey({ ...BINDING, parameters: { temperature: 1 } }, "fr-FR", "Bonjour"),
      trialKey(BINDING, "en-US", "Bonjour"),
      trialKey(BINDING, "fr-FR", "Salut")
    ]) {
      expect(other).not.toBe(base);
    }
    expect(trialKey(BINDING, "fr-FR", "../../etc/passwd")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("finds what it stored, under the format's extension", async () => {
    const key = trialKey(BINDING, "fr-FR", "Bonjour");
    expect(await findTrial(dir, key)).toBeUndefined();

    const stored = await storeTrial(dir, key, "wav", DATA);

    expect(basename(stored)).toBe(`${key}.wav`);
    expect(await findTrial(dir, key)).toBe(stored);
    expect(readdirSync(dir)).toEqual([`${key}.wav`]);
  });

  it("refuses raw audio the page could not read", async () => {
    await expect(storeTrial(dir, "k", "pcm", DATA)).rejects.toThrow(/illisible/);
  });

  it("keeps only the most recent files", async () => {
    const first = await storeTrial(dir, "old", "wav", DATA);
    utimesSync(first, new Date(1000), new Date(1000));

    for (let index = 0; index < 30; index += 1) {
      await storeTrial(dir, `new-${index}`, "wav", DATA);
    }

    expect(readdirSync(dir)).toHaveLength(30);
    expect(await findTrial(dir, "old")).toBeUndefined();
  });
});
