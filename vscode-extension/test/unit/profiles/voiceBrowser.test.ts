import { describe, expect, it } from "vitest";
import type { Voice } from "../../../src/core/tts.js";
import { buildVoiceQuickPickItems, isEnglishVoice, previewButton } from "../../../src/profiles/voiceBrowser.js";

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

describe("previewButton", () => {
  it("carries a play icon and a French tooltip", () => {
    const button = previewButton();
    expect(button.iconPath.id).toBe("play");
    expect(button.tooltip.length).toBeGreaterThan(0);
  });
});
