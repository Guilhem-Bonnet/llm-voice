import { describe, expect, it } from "vitest";
import { ProfileCollectionSchema } from "../../../src/core/profile.schema.js";
import {
  DEFAULT_PROFILES,
  FAITHFUL_PROFILE,
  LLM_SUMMARY_PROFILE,
  QUICK_REVIEW_PROFILE,
  TECHNICAL_TEACHER_PROFILE
} from "../../../src/profiles/defaults.js";

describe("DEFAULT_PROFILES (CdC §19)", () => {
  it("ships exactly the four profiles from the cahier des charges", () => {
    expect(DEFAULT_PROFILES).toHaveLength(4);
    expect(DEFAULT_PROFILES.map((profile) => profile.label)).toEqual([
      "Lecture fidèle (local)",
      "Professeur technique",
      "Résumé LLM",
      "Révision rapide"
    ]);
  });

  it("has unique, non-empty ids", () => {
    const ids = DEFAULT_PROFILES.map((profile) => profile.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it("validates as a whole ProfileCollection (AC-SEC-05)", () => {
    const collection = {
      schemaVersion: 1 as const,
      defaultProfileId: FAITHFUL_PROFILE.id,
      profiles: [...DEFAULT_PROFILES]
    };
    expect(() => ProfileCollectionSchema.parse(collection)).not.toThrow();
  });

  it("'Lecture fidèle' reads faithfully at sentence granularity", () => {
    expect(FAITHFUL_PROFILE.mode).toBe("faithful");
    expect(FAITHFUL_PROFILE.chunking.unit).toBe("sentence");
  });

  it("the three narrated profiles carry a style prompt and block chunking (CdC §15.2)", () => {
    for (const profile of [TECHNICAL_TEACHER_PROFILE, LLM_SUMMARY_PROFILE, QUICK_REVIEW_PROFILE]) {
      expect(profile.mode).toBe("narrated");
      expect(profile.chunking.unit).toBe("block");
      expect(profile.style).toBeDefined();
      expect(profile.style?.length).toBeGreaterThan(0);
    }
  });

  it("every TTS endpoint stays loopback by default (D10)", () => {
    for (const profile of DEFAULT_PROFILES) {
      expect(new URL(profile.tts.baseUrl).hostname).toBe("127.0.0.1");
    }
  });
});
