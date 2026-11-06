/** `global-voice.json` on a real folder: reading rules, exclusive creation, V17 (races). */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProfileCollection, VoiceProfile } from "../../../src/core/profile.js";
import {
  createFileExclusive,
  createGlobalVoice,
  readGlobalVoice,
  runVoiceMigration,
  writeGlobalVoice,
  type VoiceMigrationInput
} from "../../../src/profiles/globalVoiceStore.js";
import { createHarness, SETTINGS, type Harness } from "./support/voiceStoreHarness.js";

const ESTELLE = { providerId: "kyutai-pocket", baseUrl: "http://localhost:8000", voice: "estelle", speed: 1 };

function mode(id: string, tts: VoiceProfile["tts"]): VoiceProfile {
  return {
    id,
    label: id,
    mode: "faithful",
    language: "fr-FR",
    tts,
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
    playback: { rate: 1, volume: 1 }
  };
}

describe("global-voice.json", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.dispose();
  });

  it("no file: undefined, not an error", async () => {
    expect(await readGlobalVoice(h.dir)).toBeUndefined();
  });

  it("round trip; the file holds the voice and nothing else", async () => {
    await writeGlobalVoice(h.dir, ESTELLE);
    expect(await readGlobalVoice(h.dir)).toEqual(ESTELLE);
    expect(Object.keys(JSON.parse(await h.readRaw("global-voice.json")))).toEqual(["schemaVersion", "voice"]);
  });

  it.each([
    ["broken JSON", "{ pas du json"],
    ["no engine", JSON.stringify({ schemaVersion: 1, voice: { speed: 1 } })],
    ["no speed", JSON.stringify({ schemaVersion: 1, voice: { providerId: "system" } })],
    ["speed out of bounds", JSON.stringify({ schemaVersion: 1, voice: { providerId: "system", speed: 3 } })],
    ["a URL that is not http", JSON.stringify({ schemaVersion: 1, voice: { providerId: "x", baseUrl: "file:///etc", speed: 1 } })],
    ["an API key ref out of namespace", JSON.stringify({ schemaVersion: 1, voice: { providerId: "x", apiKeyRef: "other", speed: 1 } })],
    ["a sample that is not audio", JSON.stringify({ schemaVersion: 1, voice: { providerId: "x", referenceAudio: "/etc/passwd", speed: 1 } })],
    ["an unknown version", JSON.stringify({ schemaVersion: 2, voice: { providerId: "system", speed: 1 } })]
  ])("%s: an error naming the file, and the file is left as it was", async (_name, content) => {
    await writeFile(join(h.dir, "global-voice.json"), content);
    await expect(readGlobalVoice(h.dir)).rejects.toThrow(/global-voice\.json/);
    expect(await h.readRaw("global-voice.json")).toBe(content);
    await expect(h.store().getGlobalVoice()).rejects.toThrow(/global-voice\.json/);
    expect(await h.readRaw("global-voice.json")).toBe(content);
  });

  it("an unreadable voice stops the migration before anything is classified", async () => {
    const raw = JSON.stringify({ schemaVersion: 2, defaultProfileId: "a", profiles: [mode("a", { providerId: "auto" })] });
    await h.writeProfiles(raw);
    await writeFile(join(h.dir, "global-voice.json"), "{ cassé");
    await expect(h.store().load()).rejects.toThrow(/global-voice\.json/);
    expect(await h.readRaw("profiles.json")).toBe(raw);
  });

  it("exclusive creation: the second keeps its hands off, and reads the first", async () => {
    expect(await createFileExclusive(join(h.dir, "f"), "un")).toBe(true);
    expect(await createFileExclusive(join(h.dir, "f"), "deux")).toBe(false);
    expect(await h.readRaw("f")).toBe("un");

    expect(await createGlobalVoice(h.dir, ESTELLE)).toEqual({ voice: ESTELLE, created: true });
    expect(await createGlobalVoice(h.dir, { providerId: "system", speed: 1 })).toEqual({ voice: ESTELLE, created: false });
  });

  it("no temporary file is left behind", async () => {
    await createFileExclusive(join(h.dir, "f"), "un");
    await createFileExclusive(join(h.dir, "f"), "deux");
    await writeGlobalVoice(h.dir, ESTELLE);
    expect((await readdir(h.dir)).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});

describe("V17: races on one folder", () => {
  let h: Harness;
  const COLLECTION: ProfileCollection = {
    schemaVersion: 2,
    defaultProfileId: "a",
    profiles: [
      mode("a", { providerId: "kyutai-pocket", baseUrl: "http://localhost:8000", voice: "estelle" }),
      mode("b", { providerId: "chatterbox", baseUrl: "http://localhost:8004" }),
      mode("own", { providerId: "kokoro", voice: "v" })
    ]
  };
  const RAW = JSON.stringify(COLLECTION);

  function input(): VoiceMigrationInput {
    return {
      rawProfiles: Buffer.from(RAW),
      collection: COLLECTION,
      lastSelectedId: "a",
      settings: SETTINGS,
      sourceTargets: []
    };
  }

  beforeEach(async () => {
    h = await createHarness("a");
    await mkdir(h.dir, { recursive: true });
    await h.writeProfiles(RAW);
  });
  afterEach(async () => {
    await h.dispose();
  });

  async function reference(): Promise<{ profiles: string; voice: string; backup: string }> {
    const clean = await createHarness("a");
    try {
      await clean.writeProfiles(RAW);
      await runVoiceMigration(clean.dir, input());
      return {
        profiles: await clean.readRaw("profiles.json"),
        voice: await clean.readRaw("global-voice.json"),
        backup: await clean.readRaw("profiles.pre-adr-017.json")
      };
    } finally {
      await clean.dispose();
    }
  }

  it("several concurrent migrations: one backup, one voice, the result of a single one", async () => {
    await Promise.all(Array.from({ length: 8 }, () => runVoiceMigration(h.dir, input())));
    expect({
      profiles: await h.readRaw("profiles.json"),
      voice: await h.readRaw("global-voice.json"),
      backup: await h.readRaw("profiles.pre-adr-017.json")
    }).toEqual(await reference());
    expect((await readdir(h.dir)).sort()).toEqual(["global-voice.json", "profiles.json", "profiles.pre-adr-017.json"]);
  });

  it("two stores, as in one window (views and pipeline): the same, through load()", async () => {
    await Promise.all([h.store().load(), h.store().load(), h.store().load()]);
    expect(await h.readRaw("profiles.json")).toBe((await reference()).profiles);
  });

  it("a notice is said by one run only", async () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      defaultProfileId: "a",
      profiles: [mode("a", { providerId: "chatterbox", voice: "Emily.wav", referenceAudio: "/home/me/v.wav" })]
    });
    await h.writeProfiles(raw);
    await Promise.all([h.store().load(), h.store().load(), h.store().load(), h.store().load()]);
    expect(h.notices).toEqual([{ kind: "sample-over-voice", voice: "Emily.wav" }]);
  });

  it("a setGlobalVoice during the migration survives, whichever comes first", async () => {
    const chosen = { providerId: "kokoro", voice: "choisie", speed: 1 };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const run = await createHarness("a");
      try {
        await run.writeProfiles(RAW);
        await Promise.all([
          runVoiceMigration(run.dir, input()),
          // After the voice was posed, or before: both orders have to hold.
          attempt % 2 === 0 ? writeGlobalVoice(run.dir, chosen) : Promise.resolve().then(() => writeGlobalVoice(run.dir, chosen))
        ]);
        expect(await readGlobalVoice(run.dir)).toEqual(chosen);
      } finally {
        await run.dispose();
      }
    }
  });

  it("the choice made in between is what the modes are classified against, never overwritten at the last step", async () => {
    const chosen = { providerId: "kokoro", voice: "v", speed: 1 };
    await runVoiceMigration(h.dir, {
      ...input(),
      afterStep: async (step) => {
        if (step === "backup") {
          await writeGlobalVoice(h.dir, chosen);
        }
      }
    });
    expect(await readGlobalVoice(h.dir)).toEqual(chosen);
    const disk = await h.readProfiles();
    expect(disk.profiles.find((candidate) => candidate.id === "own")?.tts).toEqual({});
    expect(disk.profiles.find((candidate) => candidate.id === "a")?.tts).toEqual(COLLECTION.profiles[0]?.tts);
  });

  it("another window classified first: its write stands, nothing is written over it", async () => {
    const marked = { ...COLLECTION, voiceMigration: 1, profiles: [mode("autre", {})], defaultProfileId: "autre" };
    await runVoiceMigration(h.dir, {
      ...input(),
      afterStep: async (step) => {
        if (step === "voice") {
          await h.writeProfiles(marked as ProfileCollection);
        }
      }
    });
    expect((await h.readProfiles()).profiles.map((candidate) => candidate.id)).toEqual(["autre"]);
  });
});
