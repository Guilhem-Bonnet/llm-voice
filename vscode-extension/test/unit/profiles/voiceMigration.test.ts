/**
 * ADR-017 §2: V6 (classification, backup, three sample cases, replay after a stop at
 * each step), V7 (way back to 0.3, replay), V13, and the writes of the store that
 * must keep the mark and `hidden`. On a real folder.
 */
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProfileCollection, TtsBinding, VoiceProfile } from "../../../src/core/profile.js";
import { ProfileCollectionSchema } from "../../../src/core/profile.schema.js";
import { runVoiceMigration } from "../../../src/profiles/globalVoiceStore.js";
import { classifyModes, computeInitialVoice, SHIPPED_REFERENCE_AUDIO } from "../../../src/profiles/migrations.js";
import { CHATTERBOX_LOCAL_PRESET } from "../../../src/tts/presets.js";
import { FrozenProfileCollectionV2 } from "../../fixtures/profiles/frozenSchemaV2.js";
import { createHarness, LAST_SELECTED_KEY, SETTINGS, type Harness } from "./support/voiceStoreHarness.js";

const LEGACY_V1 = readFileSync(resolve(__dirname, "../../fixtures/profiles/legacy-profiles-v1.json"), "utf8");
const SHIPPED_CHATTERBOX: TtsBinding = {
  providerId: "chatterbox",
  baseUrl: CHATTERBOX_LOCAL_PRESET.baseUrl,
  format: "wav",
  parameters: { exaggeration: 0.4, cfg_weight: 0.5, temperature: 0.6 }
};

function mode(id: string, tts: TtsBinding, overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id,
    label: `Libellé ${id}`,
    mode: "faithful",
    language: "fr-FR",
    tts,
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
    playback: { rate: 1, volume: 1 },
    ...overrides
  };
}

function file(profiles: VoiceProfile[], defaultProfileId = profiles[0]!.id): ProfileCollection {
  return { schemaVersion: 2, defaultProfileId, profiles };
}

const KYUTAI: TtsBinding = { providerId: "kyutai-pocket", baseUrl: "http://localhost:8000", voice: "estelle" };

describe("classification of each mode (ADR-017 §2, V6)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness("source");
  });
  afterEach(async () => {
    await h.dispose();
  });

  async function classified(tts: TtsBinding, extra: VoiceProfile[] = []): Promise<TtsBinding | undefined> {
    await h.writeProfiles(file([mode("source", KYUTAI), mode("target", tts), ...extra]));
    const collection = await h.store().load();
    return collection.profiles.find((candidate) => candidate.id === "target")?.tts;
  }

  it.each<[string, TtsBinding]>([
    ["already empty", {}],
    ["the same voice as the global one", KYUTAI],
    ["the same voice, another format", { ...KYUTAI, format: "wav" }],
    ["shipped chatterbox", SHIPPED_CHATTERBOX],
    ["chatterbox at the shipped URL, nothing else", { providerId: "chatterbox", baseUrl: "http://localhost:8004" }],
    ["auto", { providerId: "auto" }],
    ["no engine, shipped parameters", { parameters: { exaggeration: 0.4, cfg_weight: 0.5, temperature: 0.6 } }],
    ["format wav alone", { format: "wav" }],
    ["the old shipped sample", { providerId: "auto", referenceAudio: SHIPPED_REFERENCE_AUDIO, format: "wav" }]
  ])("%s: emptied, it inherits", async (_name, tts) => {
    expect(await classified(tts)).toEqual({});
  });

  it.each<[string, TtsBinding]>([
    ["auto, parameters of someone", { providerId: "auto", parameters: { exaggeration: 0.9 } }],
    ["parameters alone, set otherwise", { parameters: { exaggeration: 0.9 } }],
    ["format alone, set otherwise", { format: "mp3" }],
    ["a chosen voice on the shipped engine", { ...SHIPPED_CHATTERBOX, voice: "Emily.wav" }],
    ["another chatterbox URL", { providerId: "chatterbox", baseUrl: "http://192.168.1.50:8004" }],
    ["127.0.0.1 is not the shipped URL", { providerId: "chatterbox", baseUrl: "http://127.0.0.1:8004" }],
    ["an API key", { providerId: "auto", apiKeyRef: "llmVoice.apiKey.auto" }],
    ["a model", { providerId: "auto", model: "m" }],
    ["a personal sample", { providerId: "chatterbox", baseUrl: "http://localhost:8004", referenceAudio: "/home/me/v.wav" }],
    ["auto with a URL", { providerId: "auto", baseUrl: "http://localhost:9000" }],
    ["another engine", { providerId: "kokoro", voice: "ff_siwis" }],
    ["system, on any other id", { providerId: "system" }]
  ])("%s: kept at equal JSON value, a voice of its own", async (_name, tts) => {
    expect(await classified(tts)).toEqual(tts);
  });

  it("ids and every field outside tts stay at equal JSON value, custom label and description included", async () => {
    const custom = mode(
      "custom",
      {},
      {
        label: "Mon mode",
        description: "Ma description",
        narrator: { providerId: "ollama", model: "m", temperature: 0.2 },
        style: "Style",
        markdown: {
          headings: "skip",
          links: "labelOnly",
          images: "altText",
          code: "read",
          tables: "read",
          frontmatter: "read"
        },
        synchronization: { mode: "off" },
        playback: { rate: 1.3, volume: 0.4 },
        chunking: { unit: "block", maxSentences: 2, prefetchChunks: 0 },
        language: "en-US"
      }
    );
    await h.writeProfiles(file([mode("source", KYUTAI), custom]));
    const { profiles } = await h.store().load();
    expect(profiles[1]).toEqual(custom);
  });

  it("a shipped label and description change only while they are shipped ones", async () => {
    await h.writeProfiles(
      file([
        mode("source", KYUTAI),
        mode("faithful-local", {}, {
          label: "Lecture fidèle (local)",
          description: "Chatterbox sur la machine locale, aucune sortie réseau."
        }),
        mode("technical-teacher", {}, { label: "Professeur technique", description: "Inchangée" }),
        mode("llm-summary", {}, { label: "Mon résumé" }),
        mode("quick-review", {}, { label: "Révision rapide" })
      ])
    );
    const { profiles } = await h.store().load();
    expect(profiles.map((candidate) => candidate.label).slice(1)).toEqual([
      "Fidèle",
      "Professeur",
      "Mon résumé",
      "Révision"
    ]);
    expect(profiles[1]?.description).toBe("Lit le texte tel qu'il est écrit, sans réécriture.");
    expect(profiles[2]?.description).toBe("Inchangée");
  });

  it("the migrated file passes a frozen copy of the v2 schema; schemaVersion stays 2", async () => {
    await h.writeProfiles(file([mode("source", KYUTAI), mode("own", { format: "mp3" })]));
    await h.store().load();
    const disk = await h.readProfiles();
    expect(disk.schemaVersion).toBe(2);
    expect(disk.voiceMigration).toBe(1);
    expect(() => FrozenProfileCollectionV2.parse(disk)).not.toThrow();
  });
});

describe("legacy-profiles-v1.json (V6)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
    await h.writeProfiles(LEGACY_V1);
  });
  afterEach(async () => {
    await h.dispose();
  });

  it("the backup is the v1 file, to the byte, before v1 to v2 changes anything", async () => {
    await h.store().load();
    expect(await h.readRaw("profiles.pre-adr-017.json")).toBe(LEGACY_V1);
  });

  it("v1 to v2 and the classification land in one write: same ids, all inherit, a voice on auto", async () => {
    const legacy = JSON.parse(LEGACY_V1) as ProfileCollection;
    const store = h.store();
    const collection = await store.load();
    expect(collection.schemaVersion).toBe(2);
    expect(collection.profiles.map((candidate) => candidate.id)).toEqual(legacy.profiles.map((p) => p.id));
    for (const migrated of collection.profiles) {
      expect(migrated.tts, migrated.id).toEqual({});
    }
    expect((await store.getGlobalVoice()).providerId).toBe("auto");
  });

  it("the shipped sample with no voice named is kept in the voice: same sound as today", async () => {
    const store = h.store();
    await store.load();
    expect((await store.getGlobalVoice()).referenceAudio).toBe(SHIPPED_REFERENCE_AUDIO);
    expect(h.notices).toEqual([]);
  });
});

describe("a sample already present: the migration does not freeze cause A (V6)", () => {
  const collectionWith = (tts: TtsBinding): ProfileCollection => file([mode("source", tts)]);

  it("shipped path and a named voice: the sample leaves the voice, the mode empties", () => {
    const tts = { providerId: "chatterbox", voice: "Emily.wav", referenceAudio: SHIPPED_REFERENCE_AUDIO };
    const { voice, notice } = computeInitialVoice(collectionWith(tts), { lastSelectedId: undefined, settings: SETTINGS });
    expect(voice.referenceAudio).toBeUndefined();
    expect(voice.voice).toBe("Emily.wav");
    expect(notice).toBeUndefined();
    const { collection } = classifyModes(collectionWith(tts), {
      voice,
      settings: SETTINGS,
      lastSelectedId: undefined,
      sourceTargets: []
    });
    expect(collection.profiles[0]?.tts).toEqual({});
  });

  it("shipped path without a voice: kept, same sound as today", () => {
    const tts = { providerId: "chatterbox", referenceAudio: SHIPPED_REFERENCE_AUDIO };
    const { voice, notice } = computeInitialVoice(collectionWith(tts), { lastSelectedId: undefined, settings: SETTINGS });
    expect(voice.referenceAudio).toBe(SHIPPED_REFERENCE_AUDIO);
    expect(notice).toBeUndefined();
  });

  it("personal sample and a named voice: kept, and said once, with the choice left to the user", () => {
    const tts = { providerId: "chatterbox", voice: "Emily.wav", referenceAudio: "/home/me/voice.wav" };
    const { voice, notice } = computeInitialVoice(collectionWith(tts), { lastSelectedId: undefined, settings: SETTINGS });
    expect(voice.referenceAudio).toBe("/home/me/voice.wav");
    expect(voice.voice).toBe("Emily.wav");
    expect(notice).toEqual({ kind: "sample-over-voice", voice: "Emily.wav" });
  });

  it("the message comes from the run that posed the voice: a replay says nothing", async () => {
    const h = await createHarness();
    try {
      await h.writeProfiles(collectionWith({ providerId: "chatterbox", voice: "Emily.wav", referenceAudio: "/home/me/v.wav" }));
      await h.store().load();
      await h.store().load();
      expect(h.notices).toEqual([{ kind: "sample-over-voice", voice: "Emily.wav" }]);
    } finally {
      await h.dispose();
    }
  });
});

describe("the initial voice", () => {
  it("the mode last chosen, else the default, without bySource; completed without resolving auto", () => {
    const collection = file(
      [mode("a", { providerId: "chatterbox" }), mode("b", { voice: "x", providerId: "kokoro" }), mode("c", { providerId: "auto" })],
      "b"
    );
    expect(computeInitialVoice(collection, { lastSelectedId: "a", settings: SETTINGS }).voice).toEqual({
      providerId: "chatterbox",
      baseUrl: SETTINGS.baseUrl,
      speed: 1
    });
    expect(computeInitialVoice(collection, { lastSelectedId: "gone", settings: SETTINGS }).voice.providerId).toBe("kokoro");
    expect(computeInitialVoice(collection, { lastSelectedId: "c", settings: SETTINGS }).voice).toEqual({
      providerId: "auto",
      speed: 1
    });
  });

  it("system takes no URL from the settings, it would only mislead the badge", () => {
    const collection = file([mode("a", { providerId: "system" })]);
    expect(computeInitialVoice(collection, { lastSelectedId: undefined, settings: SETTINGS }).voice).toEqual({
      providerId: "system",
      speed: 1
    });
  });

  it("a `tts: {}` written under 0.3 keeps reading through the settings, whichever they name", () => {
    const collection = file([mode("a", {})]);
    expect(
      computeInitialVoice(collection, {
        lastSelectedId: undefined,
        settings: { provider: "chatterbox", baseUrl: "http://localhost:9000" }
      }).voice
    ).toEqual({ providerId: "chatterbox", baseUrl: "http://localhost:9000", speed: 1 });
  });
});

describe("system-voice (ADR-017 §2)", () => {
  const SHIPPED_SYSTEM = mode(
    "system-voice",
    { providerId: "system" },
    { label: "Voix système (aucune installation)" }
  );
  let h: Harness;
  afterEach(async () => {
    await h.dispose();
  });

  it("on what the user last chose: same voice, then lastSelectedId and the default move to faithful-local", async () => {
    h = await createHarness("system-voice");
    await h.writeProfiles(file([SHIPPED_SYSTEM, mode("faithful-local", {})], "system-voice"));
    const store = h.store();
    const collection = await store.load();
    expect((await store.getGlobalVoice()).providerId).toBe("system");
    expect(collection.defaultProfileId).toBe("faithful-local");
    expect(h.state.values.get(LAST_SELECTED_KEY)).toBe("faithful-local");
    expect(collection.profiles[0]).toMatchObject({ id: "system-voice", hidden: true, tts: {} });
  });

  it("a source naming it: it keeps its voice and stays offered", async () => {
    h = await createHarness("source");
    await h.writeProfiles(file([mode("source", KYUTAI), SHIPPED_SYSTEM, mode("faithful-local", {})]));
    const collection = await h.store({ modesBySource: { "claude-code": "system-voice" } }).load();
    const system = collection.profiles.find((candidate) => candidate.id === "system-voice");
    expect(system?.tts).toEqual({ providerId: "system" });
    expect(system?.hidden).toBeUndefined();
  });

  it("modified: it stays a mode like any other", async () => {
    h = await createHarness("source");
    await h.writeProfiles(file([mode("source", KYUTAI), { ...SHIPPED_SYSTEM, label: "Ma voix système" }, mode("faithful-local", {})]));
    const system = (await h.store().load()).profiles.find((candidate) => candidate.id === "system-voice");
    expect(system?.hidden).toBeUndefined();
  });

  it("no faithful-local to send anyone to: not hidden", async () => {
    h = await createHarness("system-voice");
    await h.writeProfiles(file([SHIPPED_SYSTEM], "system-voice"));
    const collection = await h.store().load();
    expect(collection.defaultProfileId).toBe("system-voice");
    expect(collection.profiles[0]?.hidden).toBeUndefined();
  });
});

describe("llmVoice.defaultProfile, retired", () => {
  it("taken over once if it names an existing mode, ignored otherwise", async () => {
    const h = await createHarness("a");
    try {
      await h.writeProfiles(file([mode("a", KYUTAI), mode("b", {})]));
      const taken = await h.store({ legacyDefaultProfile: "b" }).load();
      expect(taken.defaultProfileId).toBe("b");
      await h.store({ legacyDefaultProfile: "a" }).setDefault("b");
      expect((await h.store({ legacyDefaultProfile: "a" }).load()).defaultProfileId).toBe("b");
    } finally {
      await h.dispose();
    }
    const other = await createHarness("a");
    try {
      await other.writeProfiles(file([mode("a", KYUTAI)]));
      expect((await other.store({ legacyDefaultProfile: "gone" }).load()).defaultProfileId).toBe("a");
    } finally {
      await other.dispose();
    }
  });
});

describe("idempotence, stops included (V6)", () => {
  const INPUTS: [string, string, string | undefined][] = [
    ["legacy v1", LEGACY_V1, undefined],
    [
      "v2 with voices of their own",
      JSON.stringify(
        file([
          mode("source", KYUTAI),
          mode("own", { providerId: "auto", parameters: { exaggeration: 0.9 } }),
          mode("alone", { parameters: { temperature: 0.1 } }),
          mode("shipped", SHIPPED_CHATTERBOX),
          mode("system-voice", { providerId: "system" }, { label: "Voix système (aucune installation)" }),
          mode("faithful-local", {}, { label: "Lecture fidèle (local)" })
        ])
      ),
      "source"
    ]
  ];

  async function runOnce(raw: string, lastSelectedId: string | undefined, stopAt?: "backup" | "voice" | "classify") {
    const h = await createHarness(lastSelectedId);
    await h.writeProfiles(raw);
    if (stopAt !== undefined) {
      await expect(
        runVoiceMigration(h.dir, {
          rawProfiles: Buffer.from(raw),
          collection: ProfileCollectionSchema.parse(JSON.parse(raw)) as ProfileCollection,
          lastSelectedId,
          settings: SETTINGS,
          sourceTargets: [],
          afterStep: (step) => {
            if (step === stopAt) {
              throw new Error("panne");
            }
          }
        })
      ).rejects.toThrow("panne");
    }
    const store = h.store({ modesBySource: {} });
    await store.load();
    const result = {
      profiles: await h.readRaw("profiles.json"),
      voice: await h.readRaw("global-voice.json"),
      backup: await h.readRaw("profiles.pre-adr-017.json")
    };
    await h.dispose();
    return result;
  }

  it.each(INPUTS)("%s: a stop after each step ends where a clean run ends", async (_name, raw, last) => {
    const clean = await runOnce(raw, last);
    expect(clean.backup).toBe(raw);
    for (const step of ["backup", "voice", "classify"] as const) {
      expect(await runOnce(raw, last, step), step).toEqual(clean);
    }
  });

  it.each(INPUTS)("%s: rerunning changes nothing, in the files or in the state", async (_name, raw, last) => {
    const h = await createHarness(last);
    try {
      await h.writeProfiles(raw);
      await h.store().load();
      const once = [await h.readRaw("profiles.json"), await h.readRaw("global-voice.json")];
      const state = new Map(h.state.values);
      // Even with the mark gone, what a classified file contains is stable.
      const disk = await h.readProfiles();
      delete disk.voiceMigration;
      await h.writeProfiles(disk);
      const collection = await h.store().load();
      expect(`${JSON.stringify(collection, null, 2)}\n`).toBe(once[0]);
      expect(await h.readRaw("global-voice.json")).toBe(once[1]);
      expect(h.state.values).toEqual(state);
    } finally {
      await h.dispose();
    }
  });

  it("lastSelectedId not yet written: an id hidden but resolved the same, with no effect on the reading", async () => {
    const h = await createHarness("system-voice");
    try {
      await h.writeProfiles(
        file(
          [mode("system-voice", { providerId: "system" }, { label: "Voix système (aucune installation)" }), mode("faithful-local", {})],
          "system-voice"
        )
      );
      await h.store().load();
      h.state.values.set(LAST_SELECTED_KEY, "system-voice");
      const reading = await h.store().resolveReading();
      expect(reading.mode.id).toBe("system-voice");
      expect(reading.effective.tts).toEqual({ providerId: "system" });
    } finally {
      await h.dispose();
    }
  });
});

describe("property: the classification is stable and loses nothing (V6, seeded)", () => {
  // Same seeded PRNG as `translate.property.test.ts`: a failure is reproducible from its seed.
  function mulberry32(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const POOL: TtsBinding[] = [
    {},
    KYUTAI,
    SHIPPED_CHATTERBOX,
    { providerId: "auto" },
    { providerId: "auto", parameters: { exaggeration: 0.9 } },
    { parameters: { temperature: 0.1 } },
    { format: "mp3" },
    { format: "wav" },
    { providerId: "system" },
    { providerId: "kokoro", voice: "ff_siwis" },
    { providerId: "chatterbox", baseUrl: "http://localhost:8004", referenceAudio: "/home/me/v.wav" },
    { providerId: "auto", referenceAudio: SHIPPED_REFERENCE_AUDIO },
    { providerId: "chatterbox", voice: "x", referenceAudio: SHIPPED_REFERENCE_AUDIO }
  ];
  const IDS = ["faithful-local", "system-voice", "technical-teacher", "custom-a", "custom-b"];

  for (let seed = 1; seed <= 300; seed += 1) {
    it(`seed ${seed}`, () => {
      const random = mulberry32(seed);
      const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
      const profiles = IDS.filter(() => random() > 0.3).map((id) => mode(id, pick(POOL)));
      if (profiles.length === 0) {
        profiles.push(mode("custom-a", pick(POOL)));
      }
      const collection = file(profiles);
      const { voice } = computeInitialVoice(collection, { lastSelectedId: undefined, settings: SETTINGS });
      const input = { voice, settings: SETTINGS, lastSelectedId: undefined, sourceTargets: [] };
      const once = classifyModes(collection, input);
      expect(classifyModes(once.collection, input).collection).toEqual(once.collection);
      expect(once.collection.profiles.map((candidate) => candidate.id)).toEqual(profiles.map((p) => p.id));
      once.collection.profiles.forEach((classified, index) => {
        const original = profiles[index]!;
        if (Object.keys(classified.tts).length > 0) {
          expect(classified.tts).toEqual(original.tts);
        }
        expect(classified.chunking).toEqual(original.chunking);
        expect(classified.playback).toEqual(original.playback);
        expect(classified.language).toEqual(original.language);
      });
      expect(() => FrozenProfileCollectionV2.parse(once.collection)).not.toThrow();
    });
  }
});

describe("the way back, and replays (V7)", () => {
  let h: Harness;
  const PERSONAL: TtsBinding = { providerId: "kokoro", voice: "ff_siwis", baseUrl: "http://localhost:8880" };

  async function migrated(): Promise<void> {
    await h.writeProfiles(
      file([
        mode("faithful-local", KYUTAI, { label: "Lecture fidèle (local)" }),
        mode("system-voice", { providerId: "system" }, { label: "Voix système (aucune installation)" }),
        mode("shipped", SHIPPED_CHATTERBOX),
        mode("personal", PERSONAL)
      ])
    );
    await h.store().load();
  }

  beforeEach(async () => {
    h = await createHarness("faithful-local");
  });
  afterEach(async () => {
    await h.dispose();
  });

  it("through 0.3 (mark and hidden lost), then up again: system-voice hidden again, the voice unchanged", async () => {
    await migrated();
    const voice = await h.readRaw("global-voice.json");
    const rewritten = FrozenProfileCollectionV2.parse(await h.readProfiles());
    expect(rewritten).not.toHaveProperty("voiceMigration");
    expect(rewritten.profiles.some((candidate) => "hidden" in candidate)).toBe(false);
    await h.writeProfiles(rewritten as ProfileCollection);

    const collection = await h.store().load();
    expect(collection.voiceMigration).toBe(1);
    expect(collection.profiles.find((candidate) => candidate.id === "system-voice")?.hidden).toBe(true);
    expect(await h.readRaw("global-voice.json")).toBe(voice);
    expect(h.notices).toEqual([]);
  });

  it("what 0.3 chose in a mode stays a voice of its own, against the voice kept", async () => {
    await migrated();
    const rewritten = FrozenProfileCollectionV2.parse(await h.readProfiles()) as ProfileCollection;
    rewritten.profiles[0]!.tts = { providerId: "kokoro", voice: "chosen-in-0.3" };
    await h.writeProfiles(rewritten);
    const collection = await h.store().load();
    expect(collection.profiles[0]?.tts).toEqual({ providerId: "kokoro", voice: "chosen-in-0.3" });
  });

  it("backup restored, then up again: shipped modes empty again, no personal tts lost, the backup untouched", async () => {
    await migrated();
    const backup = await h.readRaw("profiles.pre-adr-017.json");
    await writeFile(join(h.dir, "profiles.json"), backup);

    const collection = await h.store().load();
    const byId = (id: string) => collection.profiles.find((candidate) => candidate.id === id);
    expect(byId("shipped")?.tts).toEqual({});
    expect(byId("faithful-local")?.tts).toEqual({});
    expect(byId("personal")?.tts).toEqual(PERSONAL);
    expect(await h.readRaw("profiles.pre-adr-017.json")).toBe(backup);
    expect(h.notices).toEqual([]);
  });

  it("global-voice.json deleted, mark present: the system voice, tts intact, the message once", async () => {
    await migrated();
    const before = await h.readRaw("profiles.json");
    await unlink(join(h.dir, "global-voice.json"));

    const voice = await h.store().getGlobalVoice();
    expect(voice).toEqual({ providerId: "system", speed: 1 });
    expect(await h.readRaw("profiles.json")).toBe(before);
    expect(h.notices).toEqual([{ kind: "voice-reset" }]);

    await h.store().getGlobalVoice();
    expect(h.notices).toHaveLength(1);
  });

  it("mark absent, no voice, the mode emptied by an earlier migration: never recomputed, the system voice and the message", async () => {
    await migrated();
    const rewritten = FrozenProfileCollectionV2.parse(await h.readProfiles());
    await h.writeProfiles(rewritten as ProfileCollection);
    await unlink(join(h.dir, "global-voice.json"));

    const store = h.store();
    await store.load();
    expect(await store.getGlobalVoice()).toEqual({ providerId: "system", speed: 1 });
    expect(h.notices).toEqual([{ kind: "voice-reset" }]);
    expect((await h.readProfiles()).profiles.find((candidate) => candidate.id === "personal")?.tts).toEqual(PERSONAL);
  });

  it("voice deleted and backup restored: computed from the restored file, the full reset", async () => {
    await migrated();
    await writeFile(join(h.dir, "profiles.json"), await h.readRaw("profiles.pre-adr-017.json"));
    await unlink(join(h.dir, "global-voice.json"));
    const store = h.store();
    await store.load();
    expect((await store.getGlobalVoice()).voice).toBe("estelle");
    expect(h.notices).toEqual([]);
  });

  it("a mode made a voice of its own after the migration is never emptied: the classification no longer runs", async () => {
    await migrated();
    const store = h.store();
    await store.setModeVoice("shipped", SHIPPED_CHATTERBOX);
    await store.load();
    expect((await h.readProfiles()).profiles.find((candidate) => candidate.id === "shipped")?.tts).toEqual(
      SHIPPED_CHATTERBOX
    );
  });
});

describe("the writes of the store keep the mark and hidden (V7)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness("faithful-local");
    await h.writeProfiles(
      file([
        mode("faithful-local", KYUTAI),
        mode("system-voice", { providerId: "system" }, { label: "Voix système (aucune installation)" }),
        mode("other", {})
      ])
    );
    await h.store().load();
  });
  afterEach(async () => {
    await h.dispose();
  });

  async function expectKept(): Promise<void> {
    const disk = await h.readProfiles();
    expect(disk.voiceMigration).toBe(1);
    expect(disk.profiles.find((candidate) => candidate.id === "system-voice")?.hidden).toBe(true);
  }

  it("setDefault, update, duplicate, then a fresh read", async () => {
    const store = h.store();
    await store.setDefault("other");
    await expectKept();
    await store.update("other", (current) => ({ ...current, label: "Autre" }));
    await expectKept();
    await store.update("system-voice", (current) => ({ ...current, description: "x" }));
    await expectKept();
    await store.duplicate("other");
    await expectKept();
    await h.store().load();
    await expectKept();
  });

  it("a copy of a hidden mode is offered; an imported file cannot hide what it adds", async () => {
    const store = h.store();
    const copy = await store.duplicate("system-voice");
    expect(copy.hidden).toBeUndefined();
    const imported = await store.import(JSON.stringify(mode("from-file", {}, { hidden: true })));
    expect(imported.hidden).toBeUndefined();
    const offered = (await store.listEffective()).map((row) => row.mode.id);
    expect(offered).toContain(copy.id);
    expect(offered).toContain("from-file");
    expect(offered).not.toContain("system-voice");
  });

  it("the last offered mode cannot be deleted; the default never lands on a hidden one", async () => {
    const store = h.store();
    await store.delete("faithful-local");
    expect((await h.readProfiles()).defaultProfileId).toBe("other");
    await expect(store.delete("other")).rejects.toThrow(/dernier/);
  });
});

describe("resolution (V5, V13)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness("a");
    await h.writeProfiles(file([mode("a", KYUTAI), mode("b", {}), mode("own", { providerId: "kokoro", voice: "v" })]));
    await h.store().load();
    h.state.values.set(LAST_SELECTED_KEY, "b");
  });
  afterEach(async () => {
    await h.dispose();
  });

  it("V5: choosing a mode leaves global-voice.json alone; a voice change leaves profiles.json alone", async () => {
    const store = h.store();
    const voice = await h.readRaw("global-voice.json");
    await store.select("own");
    await store.resolveReading();
    expect(await h.readRaw("global-voice.json")).toBe(voice);

    const profiles = await h.readRaw("profiles.json");
    await store.setGlobalVoice({ providerId: "kokoro", voice: "x" });
    expect(await h.readRaw("profiles.json")).toBe(profiles);
  });

  it("setGlobalVoice replaces everything but the speed; setGlobalSpeed changes nothing else", async () => {
    const store = h.store();
    await store.setGlobalSpeed(1.5);
    await store.setGlobalVoice({ providerId: "kokoro", voice: "x" });
    expect(await store.getGlobalVoice()).toEqual({ providerId: "kokoro", voice: "x", speed: 1.5 });
    await expect(store.setGlobalSpeed(3)).rejects.toThrow();
    expect((await store.getGlobalVoice()).speed).toBe(1.5);
  });

  it("setModeVoice: the edit of one mode, and back to inheriting", async () => {
    const store = h.store();
    await store.setModeVoice("b", { providerId: "kokoro" });
    expect((await store.resolveReading()).voiceOrigin).toBe("mode");
    await store.setModeVoice("b", undefined);
    expect((await store.resolveReading()).voiceOrigin).toBe("global");
  });

  it("V13: `auto` in modes.bySource, without an implementation: a real mode, the effective voice, no error", async () => {
    const reading = await h.store().resolveReading("markdown", { markdown: "auto" });
    expect(reading.mode.id).toBe("b");
    expect(reading.effective.tts.voice).toBe("estelle");
  });

  it("a mode that no longer exists falls back the same way", async () => {
    const reading = await h.store().resolveReading("markdown", { markdown: "gone" });
    expect(reading.mode.id).toBe("b");
  });

  it("V16: a remote global voice is what the list judges, not the empty tts", async () => {
    const store = h.store();
    await store.setGlobalVoice({ providerId: "openai-compatible", baseUrl: "https://tts.corp.example.com" });
    const row = (await store.listEffective()).find((candidate) => candidate.mode.id === "b");
    expect(row?.effective.tts.baseUrl).toBe("https://tts.corp.example.com");
    expect(row?.mode.tts).toEqual({});
  });
});

describe("a new install (ADR-017 §2)", () => {
  it("four modes that inherit, faithful-local by default, the system voice, the mark, no message", async () => {
    const h = await createHarness();
    try {
      const store = h.store();
      const collection = await store.load();
      expect(collection.voiceMigration).toBe(1);
      expect(collection.defaultProfileId).toBe("faithful-local");
      expect(collection.profiles.map((candidate) => candidate.id)).toEqual([
        "faithful-local",
        "technical-teacher",
        "llm-summary",
        "quick-review"
      ]);
      expect(collection.profiles.every((candidate) => Object.keys(candidate.tts).length === 0)).toBe(true);
      expect(await store.getGlobalVoice()).toEqual({ providerId: "system", speed: 1 });
      expect(h.notices).toEqual([]);
      await expect(h.readRaw("profiles.pre-adr-017.json")).rejects.toThrow();
    } finally {
      await h.dispose();
    }
  });

  it("profiles.json deleted, a voice present: the voice stays", async () => {
    const h = await createHarness();
    try {
      await h.store().setGlobalVoice({ providerId: "kokoro", voice: "x" });
      await unlink(join(h.dir, "profiles.json"));
      const store = h.store();
      await store.load();
      expect((await store.getGlobalVoice()).voice).toBe("x");
    } finally {
      await h.dispose();
    }
  });
});
