import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHATTERBOX_LOCAL_PRESET, KOKORO_LOCAL_PRESET } from "../../../src/tts/presets.js";
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

  it("gives kyutai-pocket its own port when the profile has no baseUrl, not the setting's Chatterbox one", () => {
    expect(resolveTtsConfig({ providerId: "kyutai-pocket" }, TTS_SETTINGS)).toEqual({
      providerId: "kyutai-pocket",
      baseUrl: "http://localhost:8000"
    });
  });

  it("still lets a profile's own baseUrl win for kyutai-pocket", () => {
    const tts: TtsBinding = { providerId: "kyutai-pocket", baseUrl: "http://127.0.0.1:9000" };
    expect(resolveTtsConfig(tts, TTS_SETTINGS).baseUrl).toBe("http://127.0.0.1:9000");
  });
});

describe("resolveTtsConfig: piper-local never inherits Chatterbox's port", () => {
  const shipped = { provider: "auto", baseUrl: "http://127.0.0.1:8004" };

  it("uses Piper's port for a profile naming piper-local with an empty baseUrl", () => {
    expect(resolveTtsConfig({ providerId: "piper-local" }, shipped).baseUrl).toBe("http://localhost:5000");
  });

  it("uses Piper's port when piper-local comes from llmVoice.tts.provider", () => {
    expect(resolveTtsConfig({}, { provider: "piper-local", baseUrl: "http://localhost:8004/" }).baseUrl).toBe(
      "http://localhost:5000"
    );
  });

  it("keeps a custom endpoint chosen in llmVoice.tts.baseUrl", () => {
    expect(resolveTtsConfig({}, { provider: "piper-local", baseUrl: "http://127.0.0.1:5999" }).baseUrl).toBe(
      "http://127.0.0.1:5999"
    );
  });
});

describe("resolveTtsConfig: Kokoro never inherits Chatterbox's port", () => {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, "../../../package.json"), "utf8")) as {
    contributes: { configuration: { properties: Record<string, { default?: string }> } };
  };
  const shippedBaseUrl = manifest.contributes.configuration.properties["llmVoice.tts.baseUrl"]?.default as string;

  it("the shipped setting really is Chatterbox's port, the premise of everything below", () => {
    expect(shippedBaseUrl).toBe("http://127.0.0.1:8004");
    expect(CHATTERBOX_LOCAL_PRESET.baseUrl).toBe("http://localhost:8004");
  });

  it("uses Kokoro's port for a profile naming kokoro with an empty baseUrl", () => {
    const resolved = resolveTtsConfig({ providerId: "kokoro" }, { provider: "auto", baseUrl: shippedBaseUrl });
    expect(resolved).toEqual({ providerId: "kokoro", baseUrl: KOKORO_LOCAL_PRESET.baseUrl });
  });

  it("uses Kokoro's port when kokoro comes from llmVoice.tts.provider, not from the profile", () => {
    const resolved = resolveTtsConfig({}, { provider: "kokoro", baseUrl: shippedBaseUrl });
    expect(resolved).toEqual({ providerId: "kokoro", baseUrl: KOKORO_LOCAL_PRESET.baseUrl });
  });

  it.each(["http://localhost:8004", "http://LOCALHOST:8004/", "http://127.0.0.1:8004/"])(
    "treats %s as Chatterbox's port whatever its spelling",
    (baseUrl) => {
      expect(resolveTtsConfig({ providerId: "kokoro" }, { provider: "auto", baseUrl }).baseUrl).toBe(
        KOKORO_LOCAL_PRESET.baseUrl
      );
    }
  );

  it.each(["", "   "])("uses Kokoro's port when the setting is blank (%j)", (baseUrl) => {
    expect(resolveTtsConfig({ providerId: "kokoro" }, { provider: "auto", baseUrl }).baseUrl).toBe(
      KOKORO_LOCAL_PRESET.baseUrl
    );
  });

  it("keeps a custom endpoint chosen in llmVoice.tts.baseUrl", () => {
    const resolved = resolveTtsConfig({}, { provider: "kokoro", baseUrl: "http://127.0.0.1:9000" });
    expect(resolved.baseUrl).toBe("http://127.0.0.1:9000");
  });

  it("lets a profile's own baseUrl win, even on Chatterbox's port", () => {
    const tts: TtsBinding = { providerId: "kokoro", baseUrl: "http://127.0.0.1:8004" };
    const resolved = resolveTtsConfig(tts, { provider: "auto", baseUrl: shippedBaseUrl });
    expect(resolved.baseUrl).toBe("http://127.0.0.1:8004");
  });

  it("leaves Chatterbox on the setting's value", () => {
    const resolved = resolveTtsConfig({ providerId: "chatterbox" }, { provider: "auto", baseUrl: shippedBaseUrl });
    expect(resolved.baseUrl).toBe(shippedBaseUrl);
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
