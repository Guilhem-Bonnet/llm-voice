import { afterEach, describe, expect, it } from "vitest";
import { createHarness, LAST_SELECTED_KEY, type Harness } from "./support/voiceStoreHarness.js";

const legacy = {
  schemaVersion: 2,
  defaultProfileId: "system-voice",
  profiles: [
    {
      id: "system-voice",
      label: "Voix système (aucune installation)",
      mode: "faithful",
      language: "fr-FR",
      tts: { providerId: "system" },
      chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
      playback: { rate: 1, volume: 1 },
      description:
        "Lecture fidèle avec la voix déjà installée sur votre système (espeak-ng, Piper local, say, SAPI…), " +
        "sans serveur ni configuration. « LLM Voice: Install Local Voice (Piper) » pour une meilleure qualité."
    },
    { id: "faithful-local", label: "Lecture fidèle (local)", mode: "faithful", language: "fr-FR", tts: {}, chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 }, playback: { rate: 1, volume: 1 } },
    { id: "technical-teacher", label: "Professeur", mode: "faithful", language: "fr-FR", tts: {}, chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 }, playback: { rate: 1, volume: 1 } }
  ]
};

describe("the migration and the user's selection", () => {
  let harness: Harness;
  afterEach(() => harness.dispose());

  it("does not overwrite a mode chosen while the migration was running", async () => {
    harness = await createHarness("system-voice");
    await harness.writeProfiles(JSON.stringify(legacy));
    const read = harness.state.get.bind(harness.state);
    let reads = 0;
    harness.state.get = <T>(key: string): T | undefined => {
      const value = read<T>(key);
      if (key === LAST_SELECTED_KEY && ++reads === 1) {
        harness.state.values.set(key, "technical-teacher");
      }
      return value;
    };

    await harness.store().load();

    expect(harness.state.values.get(LAST_SELECTED_KEY)).toBe("technical-teacher");
  });

  it("still moves a selection left on the hidden voice mode", async () => {
    harness = await createHarness("system-voice");
    await harness.writeProfiles(JSON.stringify(legacy));
    await harness.store().load();
    expect(harness.state.values.get(LAST_SELECTED_KEY)).toBe("faithful-local");
  });
});
