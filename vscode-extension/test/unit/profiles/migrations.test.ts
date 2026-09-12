import { describe, expect, it } from "vitest";
import { CURRENT_PROFILE_SCHEMA_VERSION, migrateProfileCollection } from "../../../src/profiles/migrations.js";
import type { ProfileCollection, VoiceProfile } from "../../../src/core/profile.js";
import { CHATTERBOX_LOCAL_PRESET } from "../../../src/tts/presets.js";

function chatterboxProfile(id: string, overrides: Partial<VoiceProfile["tts"]> = {}): VoiceProfile {
  return {
    id,
    label: id,
    mode: "faithful",
    language: "fr-FR",
    tts: {
      providerId: "chatterbox",
      baseUrl: CHATTERBOX_LOCAL_PRESET.baseUrl,
      referenceAudio: "../deploy/tts/reference-audio/fr-female-siwis.wav",
      ...overrides
    },
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
    playback: { rate: 1, volume: 1 }
  };
}

describe("migrateProfileCollection (bug fix: voice-selection-not-applied, defect 2)", () => {
  it("reproduces the reported bug on an unmigrated schemaVersion 1 collection: the stale Chatterbox pin survives untouched", () => {
    // This assertion is the "before" of the fix-loop: it documents what the
    // real user's profiles.json (schemaVersion 1, default 'chatterbox') looks
    // like pre-migration — every other test below exercises the fix itself.
    const collection: ProfileCollection = {
      schemaVersion: 1,
      defaultProfileId: "faithful-local",
      profiles: [chatterboxProfile("faithful-local")]
    };
    expect(collection.schemaVersion).toBe(1);
    expect(collection.profiles[0]?.tts.providerId).toBe("chatterbox");
  });

  it("rewrites a stale default Chatterbox pin (schemaVersion 1) to providerId 'auto' and bumps schemaVersion", () => {
    const collection: ProfileCollection = {
      schemaVersion: 1,
      defaultProfileId: "faithful-local",
      profiles: [chatterboxProfile("faithful-local"), chatterboxProfile("technical-teacher")]
    };

    const { collection: migrated, migrated: didMigrate } = migrateProfileCollection(collection);

    expect(didMigrate).toBe(true);
    expect(migrated.schemaVersion).toBe(CURRENT_PROFILE_SCHEMA_VERSION);
    for (const profile of migrated.profiles) {
      expect(profile.tts.providerId).toBe("auto");
      expect(profile.tts.baseUrl).toBeUndefined();
    }
  });

  it("leaves a profile pointed at a customised (non-default) Chatterbox baseUrl untouched — an explicit user choice is never overridden", () => {
    const collection: ProfileCollection = {
      schemaVersion: 1,
      defaultProfileId: "custom",
      profiles: [chatterboxProfile("custom", { baseUrl: "http://192.168.1.50:8004" })]
    };

    const { collection: migrated } = migrateProfileCollection(collection);

    expect(migrated.profiles[0]?.tts.providerId).toBe("chatterbox");
    expect(migrated.profiles[0]?.tts.baseUrl).toBe("http://192.168.1.50:8004");
  });

  it("leaves a profile already on a different explicit providerId untouched", () => {
    const collection: ProfileCollection = {
      schemaVersion: 1,
      defaultProfileId: "cloud",
      profiles: [chatterboxProfile("cloud", { providerId: "openai-compatible" })]
    };

    const { collection: migrated } = migrateProfileCollection(collection);

    expect(migrated.profiles[0]?.tts.providerId).toBe("openai-compatible");
  });

  it("is a no-op (migrated: false, unchanged) on a collection already at CURRENT_PROFILE_SCHEMA_VERSION", () => {
    const collection: ProfileCollection = {
      schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
      defaultProfileId: "faithful-local",
      profiles: [chatterboxProfile("faithful-local")]
    };

    const { collection: migrated, migrated: didMigrate } = migrateProfileCollection(collection);

    expect(didMigrate).toBe(false);
    expect(migrated).toEqual(collection);
    // Still 'chatterbox' — once already current, this migration never runs
    // again even if a profile happens to match the stale-default shape
    // (e.g. a user deliberately re-selected the stock local Chatterbox).
    expect(migrated.profiles[0]?.tts.providerId).toBe("chatterbox");
  });

  it("is idempotent: migrating an already-migrated collection a second time changes nothing further", () => {
    const collection: ProfileCollection = {
      schemaVersion: 1,
      defaultProfileId: "faithful-local",
      profiles: [chatterboxProfile("faithful-local")]
    };

    const once = migrateProfileCollection(collection);
    const twice = migrateProfileCollection(once.collection);

    expect(twice.migrated).toBe(false);
    expect(twice.collection).toEqual(once.collection);
  });

  it("preserves referenceAudio on a migrated profile (defect 3 is handled separately, at synthesis time)", () => {
    const collection: ProfileCollection = {
      schemaVersion: 1,
      defaultProfileId: "faithful-local",
      profiles: [chatterboxProfile("faithful-local")]
    };

    const { collection: migrated } = migrateProfileCollection(collection);

    expect(migrated.profiles[0]?.tts.referenceAudio).toBe("../deploy/tts/reference-audio/fr-female-siwis.wav");
  });
});
