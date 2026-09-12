import { describe, expect, it } from "vitest";
import { validateProfileFormData } from "../../../src/profiles/profileForm.js";

function validProfile(): Record<string, unknown> {
  return {
    id: "p1",
    label: "Mon profil",
    mode: "faithful",
    language: "fr-FR",
    tts: { providerId: "chatterbox", baseUrl: "http://localhost:8004", voice: "siwis" },
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
    playback: { rate: 1, volume: 1 }
  };
}

describe("validateProfileFormData", () => {
  it("accepts a well-formed profile", () => {
    const result = validateProfileFormData(validProfile());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.label).toBe("Mon profil");
    }
  });

  it("accepts optional markdown/synchronization fields (CdC §18 names)", () => {
    const profile = {
      ...validProfile(),
      markdown: {
        headings: "read",
        links: "labelOnly",
        images: "skip",
        code: "skip",
        tables: "summarize",
        frontmatter: "skip"
      },
      synchronization: { mode: "highlight" }
    };
    const result = validateProfileFormData(profile);
    expect(result.ok).toBe(true);
  });

  it("migrates legacy markdownPolicy/syncMode field names transparently (pre-rename profiles.json)", () => {
    const profile = {
      ...validProfile(),
      markdownPolicy: {
        headings: "read",
        links: "labelOnly",
        images: "skip",
        code: "skip",
        tables: "summarize",
        frontmatter: "skip"
      },
      syncMode: "highlight"
    };
    const result = validateProfileFormData(profile);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.markdown?.code).toBe("skip");
      expect(result.profile.synchronization?.mode).toBe("highlight");
      expect(result.profile).not.toHaveProperty("markdownPolicy");
      expect(result.profile).not.toHaveProperty("syncMode");
    }
  });

  it("rejects a profile missing required fields, with a readable message", () => {
    const result = validateProfileFormData({ id: "p1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((message) => message.includes("label"))).toBe(true);
    }
  });

  it("rejects an out-of-range playback rate with a path-qualified message", () => {
    const profile = { ...validProfile(), playback: { rate: 99, volume: 1 } };
    const result = validateProfileFormData(profile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((message) => message.startsWith("playback.rate"))).toBe(true);
    }
  });

  it("rejects a hostile apiKeyRef outside the extension's namespace", () => {
    const profile = {
      ...validProfile(),
      tts: { ...(validProfile().tts as Record<string, unknown>), apiKeyRef: "github.token" }
    };
    const result = validateProfileFormData(profile);
    expect(result.ok).toBe(false);
  });

  it("rejects a completely malformed value without throwing", () => {
    expect(() => validateProfileFormData(null)).not.toThrow();
    expect(() => validateProfileFormData("not an object")).not.toThrow();
    const result = validateProfileFormData(undefined);
    expect(result.ok).toBe(false);
  });
});
