import { describe, expect, it } from "vitest";
import { resolveNarratorConfig, resolveTtsConfig } from "../../../src/pipeline/resolveProviderConfig.js";
import type { NarratorBinding, TtsBinding } from "../../../src/core/profile.js";

const TTS_SETTINGS = { provider: "chatterbox", baseUrl: "http://127.0.0.1:8880" };
const NARRATOR_SETTINGS = { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "llama3.1" };

describe("resolveTtsConfig (fix(review): llmVoice.tts.baseUrl/tts.provider orphan setting)", () => {
  it("falls back to the settings when the profile states neither field", () => {
    const tts: TtsBinding = {};
    expect(resolveTtsConfig(tts, TTS_SETTINGS)).toEqual({
      providerId: "chatterbox",
      baseUrl: "http://127.0.0.1:8880"
    });
  });

  it("lets the profile override the setting's baseUrl", () => {
    const tts: TtsBinding = { baseUrl: "http://127.0.0.1:8004" };
    expect(resolveTtsConfig(tts, TTS_SETTINGS)).toEqual({
      providerId: "chatterbox",
      baseUrl: "http://127.0.0.1:8004"
    });
  });

  it("lets the profile override the setting's providerId", () => {
    const tts: TtsBinding = { providerId: "openai-compatible" };
    expect(resolveTtsConfig(tts, TTS_SETTINGS)).toEqual({
      providerId: "openai-compatible",
      baseUrl: "http://127.0.0.1:8880"
    });
  });

  it("resolves both fields independently when the profile sets only one of each", () => {
    const tts: TtsBinding = { providerId: "openai-compatible", baseUrl: "http://127.0.0.1:8004" };
    expect(resolveTtsConfig(tts, TTS_SETTINGS)).toEqual({
      providerId: "openai-compatible",
      baseUrl: "http://127.0.0.1:8004"
    });
  });
});

describe("resolveNarratorConfig", () => {
  it("returns undefined when the profile has no narrator binding at all", () => {
    expect(resolveNarratorConfig(undefined, NARRATOR_SETTINGS)).toBeUndefined();
  });

  it("falls back to settings for every field the binding omits", () => {
    const narrator: NarratorBinding = {};
    expect(resolveNarratorConfig(narrator, NARRATOR_SETTINGS)).toEqual({
      providerId: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.1"
    });
  });

  it("lets the profile override individual fields", () => {
    const narrator: NarratorBinding = { model: "mistral" };
    expect(resolveNarratorConfig(narrator, NARRATOR_SETTINGS)).toEqual({
      providerId: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "mistral"
    });
  });
});
