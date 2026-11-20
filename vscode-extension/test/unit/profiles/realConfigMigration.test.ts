/**
 * Brief of card GAO-refonte-ux-0-004, step 5: an exact, frozen copy of the
 * configuration reported by guilhem-bonnet, not read from `~/.config/Code`. Only `tts`,
 * `lastSelectedId`, `defaultProfileId` and `playback.rate` of `quick-review` were
 * given; every other field is what 0.3 ships for these ids (`git show HEAD`).
 *
 * Expected: global voice Estelle; every mode inherits; a reading resolved through
 * `bySource` from `claude-code` to `llm-summary` uses Estelle; a replay does nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VoiceProfile } from "../../../src/core/profile.js";
import { describeVoice } from "../../../src/profiles/voiceResolution.js";
import { createHarness, LAST_SELECTED_KEY, type Harness } from "./support/voiceStoreHarness.js";

const CHATTERBOX_TTS = {
  providerId: "chatterbox",
  baseUrl: "http://localhost:8004",
  format: "wav",
  parameters: { exaggeration: 0.4, cfg_weight: 0.5, temperature: 0.6 }
};
const NARRATOR = { providerId: "ollama", baseUrl: "http://127.0.0.1:11434" };
const SENTENCES = { unit: "sentence", maxSentences: 3, prefetchChunks: 2 } as const;
const BLOCKS = { unit: "block", maxSentences: 3, prefetchChunks: 2 } as const;
const NORMAL = { rate: 1, volume: 1 };

const REAL_PROFILES: VoiceProfile[] = [
  {
    id: "system-voice",
    label: "Voix système (aucune installation)",
    mode: "faithful",
    language: "fr-FR",
    tts: { providerId: "system" },
    chunking: SENTENCES,
    playback: NORMAL,
    description:
      "Lecture fidèle avec la voix déjà installée sur votre système (espeak-ng, Piper local, say, SAPI…), " +
      "sans serveur ni configuration. « LLM Voice: Install Local Voice (Piper) » pour une meilleure qualité."
  },
  {
    id: "faithful-local",
    label: "Lecture fidèle (local)",
    mode: "faithful",
    language: "fr-FR",
    tts: {
      providerId: "kyutai-pocket",
      baseUrl: "http://localhost:8000",
      voice: "estelle",
      parameters: { speed: 1 }
    },
    chunking: SENTENCES,
    playback: NORMAL,
    description: "Chatterbox sur la machine locale, aucune sortie réseau."
  },
  {
    id: "technical-teacher",
    label: "Professeur technique",
    mode: "narrated",
    language: "fr-FR",
    tts: CHATTERBOX_TTS,
    narrator: NARRATOR,
    chunking: BLOCKS,
    playback: NORMAL,
    description: "Explication orale pédagogique, avec analogies quand elles aident.",
    style: "Transforme la section en explication orale pédagogique et naturelle."
  },
  {
    id: "llm-summary",
    label: "Résumé LLM",
    mode: "narrated",
    language: "fr-FR",
    tts: CHATTERBOX_TTS,
    narrator: NARRATOR,
    chunking: BLOCKS,
    playback: NORMAL,
    description: "Résumé oral façon collègue développeur : fait, limites, reste à faire.",
    style: "Présente oralement le résultat comme un collègue développeur."
  },
  {
    id: "quick-review",
    label: "Révision rapide",
    mode: "narrated",
    language: "fr-FR",
    tts: CHATTERBOX_TTS,
    narrator: NARRATOR,
    chunking: BLOCKS,
    playback: { rate: 1.1, volume: 1 },
    description: "Ne garde que les concepts, pièges et éléments essentiels à retenir.",
    style: "Transforme le contenu en révision orale."
  }
];

const REAL_FILE = `${JSON.stringify(
  { schemaVersion: 2, defaultProfileId: "system-voice", profiles: REAL_PROFILES },
  null,
  2
)}\n`;

describe("the real configuration of guilhem-bonnet, frozen", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness("faithful-local");
    await h.writeProfiles(REAL_FILE);
  });

  afterEach(async () => {
    await h.dispose();
  });

  it("the global voice is Estelle, whole", async () => {
    const store = h.store();
    await store.load();
    const voice = await store.getGlobalVoice();
    expect(voice).toEqual({
      providerId: "kyutai-pocket",
      baseUrl: "http://localhost:8000",
      voice: "estelle",
      parameters: { speed: 1 },
      speed: 1
    });
    expect(describeVoice(voice)).toBe("Estelle");
  });

  it("every mode inherits, and every field outside tts, label and description is at equal value", async () => {
    const { profiles } = await h.store().load();
    expect(profiles.map((mode) => mode.id)).toEqual(REAL_PROFILES.map((mode) => mode.id));
    for (const mode of profiles) {
      expect(mode.tts, mode.id).toEqual({});
      const { tts: _t, label: _l, description: _d, hidden: _h, ...rest } = mode;
      const origin = REAL_PROFILES.find((candidate) => candidate.id === mode.id)!;
      const { tts: _ot, label: _ol, description: _od, ...originRest } = origin;
      expect(rest, mode.id).toEqual(originRest);
    }
    expect(profiles.find((mode) => mode.id === "quick-review")?.playback.rate).toBe(1.1);
  });

  it("a reading resolved through bySource, claude-code to llm-summary, speaks with Estelle", async () => {
    const store = h.store();
    const reading = await store.resolveReading("claude-code", { "claude-code": "llm-summary" });
    expect(reading.mode.id).toBe("llm-summary");
    expect(reading.mode.tts).toEqual({});
    expect(reading.voiceOrigin).toBe("global");
    expect(reading.effective.tts.providerId).toBe("kyutai-pocket");
    expect(reading.effective.tts.voice).toBe("estelle");
    expect(reading.effective.tts.baseUrl).toBe("http://localhost:8000");
    expect(reading.effective.narrator).toEqual(NARRATOR);
  });

  it("every other way of reading speaks with Estelle too: documents, selections, the last chosen mode", async () => {
    const store = h.store();
    for (const source of ["markdown", "text", "clipboard", undefined] as const) {
      const reading = await store.resolveReading(source, { "claude-code": "llm-summary" });
      expect(reading.mode.id).toBe("faithful-local");
      expect(reading.effective.tts.voice).toBe("estelle");
    }
  });

  it("system-voice is hidden, the default moves to faithful-local, lastSelectedId stays", async () => {
    const store = h.store();
    const collection = await store.load();
    expect(collection.defaultProfileId).toBe("faithful-local");
    expect(collection.profiles.find((mode) => mode.id === "system-voice")?.hidden).toBe(true);
    expect(h.state.values.get(LAST_SELECTED_KEY)).toBe("faithful-local");
    const offered = (await store.listEffective()).map((row) => row.mode.id);
    expect(offered).toEqual(["faithful-local", "technical-teacher", "llm-summary", "quick-review"]);
    const named = await store.resolveReading("text", { text: "system-voice" });
    expect(named.mode.id).toBe("system-voice");
    expect(named.effective.tts.voice).toBe("estelle");
  });

  it("the backup is the file, to the byte; no message: nothing was lost and nothing is in doubt", async () => {
    await h.store().load();
    expect(await h.readRaw("profiles.pre-adr-017.json")).toBe(REAL_FILE);
    expect(h.notices).toEqual([]);
  });

  it("a replay does nothing: same bytes in the three files, same state", async () => {
    await h.store().load();
    const before = [
      await h.readRaw("profiles.json"),
      await h.readRaw("global-voice.json"),
      await h.readRaw("profiles.pre-adr-017.json")
    ];
    await h.store().load();
    await h.store().resolveReading("claude-code", { "claude-code": "llm-summary" });
    expect([
      await h.readRaw("profiles.json"),
      await h.readRaw("global-voice.json"),
      await h.readRaw("profiles.pre-adr-017.json")
    ]).toEqual(before);
    expect(h.state.values.get(LAST_SELECTED_KEY)).toBe("faithful-local");
  });
});
