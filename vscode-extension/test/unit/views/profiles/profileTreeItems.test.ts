/**
 * `buildProfileTreeItems` (S9, ADR-011 revision 2026-09-12): construction of
 * the "Profils" Tree View rows — which one is marked active, and the
 * lock/cloud badge on the others.
 */
import { describe, expect, it } from "vitest";
import { buildProfileTreeItems } from "../../../../src/views/profiles/profileTreeItems.js";
import type { VoiceProfile } from "../../../../src/core/profile.js";

function profile(overrides: Partial<VoiceProfile> & { id: string; label: string }): VoiceProfile {
  return {
    mode: "faithful",
    language: "fr-FR",
    tts: { providerId: "system" },
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
    playback: { rate: 1, volume: 1 },
    ...overrides
  };
}

describe("buildProfileTreeItems", () => {
  it("marks the active profile with the check icon and an 'Actif' prefix", () => {
    const profiles = [
      profile({ id: "faithful", label: "Lecture fidèle" }),
      profile({ id: "teacher", label: "Professeur technique" })
    ];

    const items = buildProfileTreeItems(profiles, "teacher");

    const active = items.find((item) => item.id === "teacher");
    const inactive = items.find((item) => item.id === "faithful");
    expect(active?.isActive).toBe(true);
    expect(active?.icon).toBe("check");
    expect(active?.description).toMatch(/^Actif — /);
    expect(inactive?.isActive).toBe(false);
    expect(inactive?.description).not.toMatch(/^Actif/);
  });

  it("badges a profile with a remote endpoint as 'cloud', a local one as 'lock'", () => {
    const profiles = [
      profile({ id: "local", label: "Local", tts: { providerId: "system" } }),
      profile({ id: "remote", label: "Remote", tts: { providerId: "openai-compatible", baseUrl: "https://api.example.com" } })
    ];

    const items = buildProfileTreeItems(profiles, undefined);

    expect(items.find((item) => item.id === "local")?.icon).toBe("lock");
    expect(items.find((item) => item.id === "remote")?.icon).toBe("cloud");
  });

  it("returns one row per profile, preserving `profiles.json` order", () => {
    const profiles = [
      profile({ id: "a", label: "A" }),
      profile({ id: "b", label: "B" }),
      profile({ id: "c", label: "C" })
    ];

    const items = buildProfileTreeItems(profiles, undefined);

    expect(items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(items.every((item) => !item.isActive)).toBe(true);
  });

  it("falls back to the label as tooltip when the profile has no description", () => {
    const items = buildProfileTreeItems([profile({ id: "a", label: "A" })], undefined);
    expect(items[0]?.tooltip).toBe("A");
  });

  it("uses the profile's own description as tooltip when present", () => {
    const items = buildProfileTreeItems(
      [profile({ id: "a", label: "A", description: "Une description." })],
      undefined
    );
    expect(items[0]?.tooltip).toBe("Une description.");
  });
});
