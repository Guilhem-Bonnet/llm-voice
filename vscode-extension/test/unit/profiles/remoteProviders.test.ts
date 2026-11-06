import { describe, expect, it } from "vitest";
import { apiKeySecretKey, collectRemoteProviderIds } from "../../../src/profiles/remoteProviders.js";
import { OPENAI_COMPATIBLE_PRESET } from "../../../src/tts/presets.js";
import { DEFAULT_PROFILE } from "../../../src/core/profile.schema.js";
import type { VoiceProfile } from "../../../src/core/profile.js";

describe("apiKeySecretKey", () => {
  it("namespaces the SecretStorage key under llmVoice.apiKey.* (AC-17, AC-SEC-08)", () => {
    expect(apiKeySecretKey("openai-compatible")).toBe("llmVoice.apiKey.openai-compatible");
  });
});

describe("collectRemoteProviderIds", () => {
  it("falls back to the generic OpenAI-compatible preset when no profile is remote", () => {
    expect(collectRemoteProviderIds([DEFAULT_PROFILE])).toEqual([OPENAI_COMPATIBLE_PRESET.id]);
  });

  it("collects distinct remote TTS and narrator providerIds", () => {
    const enterprise: VoiceProfile = {
      ...DEFAULT_PROFILE,
      id: "enterprise",
      tts: { providerId: "openai-compatible", baseUrl: "https://tts.corp.example.com" },
      narrator: { providerId: "openai-narrator", baseUrl: "https://llm.corp.example.com", model: "gpt-4o-mini" }
    };
    expect(collectRemoteProviderIds([DEFAULT_PROFILE, enterprise])).toEqual([
      "openai-compatible",
      "openai-narrator"
    ]);
  });

  it("ignores a remote endpoint whose profile omits providerId", () => {
    const noProviderId: VoiceProfile = {
      ...DEFAULT_PROFILE,
      id: "no-provider-id",
      tts: { baseUrl: "https://tts.corp.example.com" }
    };
    expect(collectRemoteProviderIds([noProviderId])).toEqual([OPENAI_COMPATIBLE_PRESET.id]);
  });
});

describe("collectRemoteProviderIds with the global voice (ADR-017 §1.3, V16)", () => {
  it("proposes a remote global voice, even when every mode inherits", () => {
    const inheriting: VoiceProfile = { ...DEFAULT_PROFILE, tts: {} };
    expect(
      collectRemoteProviderIds([inheriting], {
        providerId: "corp-tts",
        baseUrl: "https://tts.corp.example.com",
        speed: 1
      })
    ).toEqual(["corp-tts"]);
  });

  it("a local global voice adds nothing", () => {
    expect(
      collectRemoteProviderIds([{ ...DEFAULT_PROFILE, tts: {} }], {
        providerId: "chatterbox",
        baseUrl: "http://localhost:8004",
        speed: 1
      })
    ).toEqual([OPENAI_COMPATIBLE_PRESET.id]);
  });
});
