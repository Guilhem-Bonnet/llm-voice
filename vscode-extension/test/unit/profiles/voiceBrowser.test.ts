import { describe, expect, it } from "vitest";
import type { Voice } from "../../../src/core/tts.js";
import {
  buildVoiceQuickPickItems,
  defaultVoiceFor,
  isEnglishVoice,
  previewButton
} from "../../../src/profiles/voiceBrowser.js";

describe("isEnglishVoice", () => {
  it("flags a voice declared en-US against a French profile", () => {
    const voice: Voice = { id: "v1", label: "Teacher", language: "en-US" };
    expect(isEnglishVoice(voice, "fr-FR")).toBe(true);
  });

  it("does not flag a voice matching the profile's own language", () => {
    const voice: Voice = { id: "v1", label: "Prof", language: "fr-FR" };
    expect(isEnglishVoice(voice, "fr-FR")).toBe(false);
  });

  it("never flags anything when the profile itself is English", () => {
    const voice: Voice = { id: "v1", label: "Anything", language: "en" };
    expect(isEnglishVoice(voice, "en-US")).toBe(false);
  });

  it("does not flag a voice with no declared language", () => {
    const voice: Voice = { id: "v1", label: "Mystery Voice" };
    expect(isEnglishVoice(voice, "fr-FR")).toBe(false);
  });

  it("falls back to the label/id when no language is declared but it says English", () => {
    const voice: Voice = { id: "en_female_01", label: "English (US) Narrator" };
    expect(isEnglishVoice(voice, "fr-FR")).toBe(true);
  });
});

describe("buildVoiceQuickPickItems", () => {
  const voices: Voice[] = [
    { id: "b", label: "Bravo", language: "fr-FR" },
    { id: "a", label: "Alpha", language: "en-US" },
    { id: "c", label: "Charlie", language: "fr-FR" }
  ];

  it("puts the current voice first", () => {
    const items = buildVoiceQuickPickItems(voices, "fr-FR", "c");
    expect(items[0]?.voiceId).toBe("c");
    expect(items[0]?.isCurrent).toBe(true);
  });

  it("sorts the rest alphabetically by label", () => {
    const items = buildVoiceQuickPickItems(voices, "fr-FR", undefined);
    expect(items.map((item) => item.voiceId)).toEqual(["a", "b", "c"]);
  });

  it("flags the English voice against a French profile", () => {
    const items = buildVoiceQuickPickItems(voices, "fr-FR", undefined);
    const alpha = items.find((item) => item.voiceId === "a");
    expect(alpha?.isEnglishMismatch).toBe(true);
    expect(alpha?.description).toContain("voix anglophone");
  });

  it("does not flag French voices", () => {
    const items = buildVoiceQuickPickItems(voices, "fr-FR", undefined);
    const bravo = items.find((item) => item.voiceId === "b");
    expect(bravo?.isEnglishMismatch).toBe(false);
    expect(bravo?.description).not.toContain("voix anglophone");
  });

  it("marks the current voice's label with a check", () => {
    const items = buildVoiceQuickPickItems(voices, "fr-FR", "b");
    const bravo = items.find((item) => item.voiceId === "b");
    expect(bravo?.label).toContain("$(check)");
  });
});

describe("defaultVoiceFor (bug fix: voice-selection-not-applied / infinite loop, no voice must never mean a request 'vouée à un 400')", () => {
  const voices: Voice[] = [
    { id: "gianna", label: "Gianna", language: "en-US" },
    { id: "siwis", label: "Siwis", language: "fr-FR" },
    { id: "robert", label: "Robert", language: "en-US" }
  ];

  it("picks the first voice whose language matches the profile's language", () => {
    expect(defaultVoiceFor(voices, "fr-FR")?.id).toBe("siwis");
  });

  it("falls back to the very first voice when none match the profile's language", () => {
    expect(defaultVoiceFor(voices, "de-DE")?.id).toBe("gianna");
  });

  it("returns undefined only when the provider has no voice at all", () => {
    expect(defaultVoiceFor([], "fr-FR")).toBeUndefined();
  });

  it("ignores voices with no declared language when a match exists", () => {
    const mixed: Voice[] = [{ id: "unknown", label: "Mystery" }, { id: "siwis", label: "Siwis", language: "fr-FR" }];
    expect(defaultVoiceFor(mixed, "fr-FR")?.id).toBe("siwis");
  });
});

describe("previewButton", () => {
  it("carries a play icon and a French tooltip", () => {
    const button = previewButton();
    expect(button.iconPath.id).toBe("play");
    expect(button.tooltip.length).toBeGreaterThan(0);
  });
});
