import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROFILE,
  VoiceProfileSchema,
  isLoopbackUrl,
  isRemoteProfile,
  parseVoiceProfile
} from "../../../src/core/profile.schema.js";
import type { VoiceProfile } from "../../../src/core/profile.js";

describe("VoiceProfileSchema", () => {
  it("accepts the shipped default profile", () => {
    const result = VoiceProfileSchema.safeParse(DEFAULT_PROFILE);
    expect(result.success).toBe(true);
  });

  it("round-trips the default profile through parseVoiceProfile", () => {
    expect(parseVoiceProfile(DEFAULT_PROFILE)).toEqual(DEFAULT_PROFILE);
  });

  it("rejects an invalid profile", () => {
    const invalid = {
      ...DEFAULT_PROFILE,
      mode: "storytelling",
      chunking: { ...DEFAULT_PROFILE.chunking, prefetchChunks: -1 }
    };
    const result = VoiceProfileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects a profile whose baseUrl is not an http(s) URL", () => {
    const invalid = {
      ...DEFAULT_PROFILE,
      tts: { ...DEFAULT_PROFILE.tts, baseUrl: "not-a-url" }
    };
    expect(VoiceProfileSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("isRemoteProfile", () => {
  it("reports the default local profile as not remote", () => {
    expect(isRemoteProfile(DEFAULT_PROFILE)).toBe(false);
  });

  it("accepts a non-loopback baseUrl but reports it as remote", () => {
    const remote: VoiceProfile = {
      ...DEFAULT_PROFILE,
      id: "enterprise",
      tts: { ...DEFAULT_PROFILE.tts, baseUrl: "https://tts.corp.example.com" }
    };

    expect(VoiceProfileSchema.safeParse(remote).success).toBe(true);
    expect(isRemoteProfile(remote)).toBe(true);
  });

  it("reports a profile as remote when only the narrator leaves loopback", () => {
    const mixed: VoiceProfile = {
      ...DEFAULT_PROFILE,
      id: "mixed",
      narrator: {
        providerId: "openai-compatible",
        baseUrl: "https://llm.corp.example.com",
        model: "qwen2.5"
      }
    };

    expect(isRemoteProfile(mixed)).toBe(true);
  });

  it("treats every loopback form as local", () => {
    expect(isLoopbackUrl("http://127.0.0.1:8004")).toBe(true);
    expect(isLoopbackUrl("http://127.5.4.3")).toBe(true);
    expect(isLoopbackUrl("http://localhost:11434")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:8004")).toBe(true);
    expect(isLoopbackUrl("https://example.com")).toBe(false);
    expect(isLoopbackUrl("not-a-url")).toBe(false);
  });
});
