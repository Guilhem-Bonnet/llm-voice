import { describe, expect, it } from "vitest";
import {
  isHealthyEnough,
  resolveNarratorConfig,
  resolveTtsConfig,
  selectAutoTtsProvider,
  type AutoTtsCandidate
} from "../../../src/pipeline/resolveProviderConfig.js";
import type { NarratorBinding, TtsBinding } from "../../../src/core/profile.js";
import type { ProviderHealth } from "../../../src/core/health.js";

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

function healthOf(status: ProviderHealth["status"]): ProviderHealth {
  return { providerId: "x", status, checkedAt: Date.now() };
}

function candidate(providerId: string, baseUrl: string, health: () => Promise<ProviderHealth>): AutoTtsCandidate {
  return { providerId, baseUrl, health };
}

const SYSTEM_FALLBACK = { providerId: "system", baseUrl: "" };

describe("isHealthyEnough", () => {
  it("ok and degraded both count as usable now", () => {
    expect(isHealthyEnough(healthOf("ok"))).toBe(true);
    expect(isHealthyEnough(healthOf("degraded"))).toBe(true);
  });

  it("unreachable/unauthorized/unverified do not", () => {
    expect(isHealthyEnough(healthOf("unreachable"))).toBe(false);
    expect(isHealthyEnough(healthOf("unauthorized"))).toBe(false);
    expect(isHealthyEnough(healthOf("unverified"))).toBe(false);
  });
});

describe("selectAutoTtsProvider (S7.1, ADR-009 auto order)", () => {
  it("picks the first candidate whose health() is usable now", async () => {
    const chatterbox = candidate("chatterbox", "http://localhost:8004", async () => healthOf("ok"));
    const piperLocal = candidate("piper-local", "http://localhost:5000", async () => healthOf("ok"));
    const result = await selectAutoTtsProvider([chatterbox, piperLocal], SYSTEM_FALLBACK);
    expect(result).toEqual({ providerId: "chatterbox", baseUrl: "http://localhost:8004" });
  });

  it("falls through to the next candidate when the first is unreachable", async () => {
    const chatterbox = candidate("chatterbox", "http://localhost:8004", async () => healthOf("unreachable"));
    const piperLocal = candidate("piper-local", "http://localhost:5000", async () => healthOf("ok"));
    const result = await selectAutoTtsProvider([chatterbox, piperLocal], SYSTEM_FALLBACK);
    expect(result).toEqual({ providerId: "piper-local", baseUrl: "http://localhost:5000" });
  });

  it("falls back to system voices when every candidate is unusable", async () => {
    const chatterbox = candidate("chatterbox", "http://localhost:8004", async () => healthOf("unreachable"));
    const piperLocal = candidate("piper-local", "http://localhost:5000", async () => healthOf("unreachable"));
    const result = await selectAutoTtsProvider([chatterbox, piperLocal], SYSTEM_FALLBACK);
    expect(result).toEqual(SYSTEM_FALLBACK);
  });

  it("treats a health() that throws exactly like unreachable, and still tries the next candidate", async () => {
    const chatterbox = candidate("chatterbox", "http://localhost:8004", async () => {
      throw new Error("ECONNREFUSED");
    });
    const piperLocal = candidate("piper-local", "http://localhost:5000", async () => healthOf("ok"));
    const result = await selectAutoTtsProvider([chatterbox, piperLocal], SYSTEM_FALLBACK);
    expect(result).toEqual({ providerId: "piper-local", baseUrl: "http://localhost:5000" });
  });

  it("degraded (e.g. still loading) is accepted, not skipped", async () => {
    const chatterbox = candidate("chatterbox", "http://localhost:8004", async () => healthOf("degraded"));
    const result = await selectAutoTtsProvider([chatterbox], SYSTEM_FALLBACK);
    expect(result).toEqual({ providerId: "chatterbox", baseUrl: "http://localhost:8004" });
  });

  it("returns the fallback immediately given no candidates", async () => {
    const result = await selectAutoTtsProvider([], SYSTEM_FALLBACK);
    expect(result).toEqual(SYSTEM_FALLBACK);
  });
});
