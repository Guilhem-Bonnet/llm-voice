import { describe, expect, it } from "vitest";
import { formatProfileDescription, formatProfileQuickPickItem } from "../../../src/profiles/profileQuickPick.js";
import { DEFAULT_PROFILE } from "../../../src/core/profile.schema.js";
import type { VoiceProfile } from "../../../src/core/profile.js";

const narrated: VoiceProfile = {
  ...DEFAULT_PROFILE,
  id: "teacher",
  mode: "narrated",
  narrator: { providerId: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen2.5:7b" },
  tts: { ...DEFAULT_PROFILE.tts, voice: "teacher-fr" }
};

const remote: VoiceProfile = {
  ...DEFAULT_PROFILE,
  id: "enterprise",
  tts: { ...DEFAULT_PROFILE.tts, baseUrl: "https://tts.corp.example.com" }
};

describe("formatProfileDescription", () => {
  it("describes a faithful profile as 'lecture fidèle · voix' (falling back to providerId)", () => {
    expect(formatProfileDescription(DEFAULT_PROFILE)).toBe(
      `lecture fidèle · ${DEFAULT_PROFILE.tts.providerId}`
    );
  });

  it("describes a narrated profile as 'narrateur · voix'", () => {
    expect(formatProfileDescription(narrated)).toBe("qwen2.5:7b · teacher-fr");
  });
});

describe("formatProfileQuickPickItem", () => {
  it("badges a local profile with $(lock)", () => {
    const item = formatProfileQuickPickItem(DEFAULT_PROFILE, false);
    expect(item.label).toBe(`$(lock) ${DEFAULT_PROFILE.label}`);
    expect(item.id).toBe(DEFAULT_PROFILE.id);
  });

  it("badges a remote profile with $(cloud) (AC-SEC-05)", () => {
    const item = formatProfileQuickPickItem(remote, false);
    expect(item.label).toBe(`$(cloud) ${remote.label}`);
  });

  it("prefixes the currently selected profile with $(check)", () => {
    const item = formatProfileQuickPickItem(DEFAULT_PROFILE, true);
    expect(item.label).toBe(`$(lock) $(check) ${DEFAULT_PROFILE.label}`);
  });
});
