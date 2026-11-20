import { describe, expect, it } from "vitest";
import { formatProfileDescription, formatProfileQuickPickItem } from "../../../src/profiles/profileQuickPick.js";
import { DEFAULT_PROFILE } from "../../../src/core/profile.schema.js";
import type { VoiceProfile } from "../../../src/core/profile.js";
import { isRemoteProfile } from "../../../src/core/profile.schema.js";
import { withEffectiveVoice } from "../../../src/profiles/voiceResolution.js";

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
  it("describes a faithful mode as 'lecture fidèle · voix', the voice in words (ADR-017 §1.3)", () => {
    expect(formatProfileDescription(DEFAULT_PROFILE)).toBe("lecture fidèle · Chatterbox (qualité maximale)");
    expect(formatProfileDescription({ ...DEFAULT_PROFILE, tts: { providerId: "auto" } })).toBe(
      "lecture fidèle · Voix automatique"
    );
  });

  it("says when the voice is the mode's own", () => {
    expect(formatProfileDescription(narrated, "mode")).toBe("qwen2.5:7b · Voix propre : teacher-fr");
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

describe("the badge judges the voice heard (ADR-017 §1.3, V16)", () => {
  const inheriting: VoiceProfile = { ...DEFAULT_PROFILE, tts: {} };
  const remoteVoice = {
    providerId: "openai-compatible",
    baseUrl: "https://tts.corp.example.com",
    speed: 1
  };

  it("a remote global voice shows $(cloud) on a mode that inherits, which alone would look local", () => {
    expect(formatProfileQuickPickItem(inheriting, false).label).toContain("$(lock)");
    const item = formatProfileQuickPickItem(withEffectiveVoice(inheriting, remoteVoice), false);
    expect(item.label).toContain("$(cloud)");
  });

  it("importing a mode `tts: {}` warns of nothing: what it brings has no destination", () => {
    expect(isRemoteProfile(inheriting)).toBe(false);
  });

  it("a local voice of its own stays local under a remote global voice", () => {
    const own: VoiceProfile = { ...DEFAULT_PROFILE, tts: { providerId: "chatterbox", baseUrl: "http://localhost:8004" } };
    expect(formatProfileQuickPickItem(withEffectiveVoice(own, remoteVoice), false, "mode").label).toContain("$(lock)");
  });
});
