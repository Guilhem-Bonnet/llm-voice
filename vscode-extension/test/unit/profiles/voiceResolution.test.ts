/**
 * ADR-017 §1.3 to §1.5: V4 (cause D), V5 (priority), the pure part of V11 (speed)
 * and of V3 (`ttsInstanceKey`), `describeVoice`, V19 (language).
 */
import { describe, expect, it } from "vitest";
import type { GlobalVoice, ReadingMode, TtsBinding } from "../../../src/core/profile.js";
import { computeCacheKey } from "../../../src/playback/AudioCache.js";
import { ttsInstanceKey } from "../../../src/pipeline/resolveProviderConfig.js";
import {
  bindingForEngineVoice,
  declaredVoiceLanguage,
  describeSpeedGap,
  describeVoice,
  effectiveModeOf,
  formatVoiceLanguageWarning,
  hasOwnVoice,
  requestedSpeed,
  resolveEngineSpeed,
  withEffectiveVoice
} from "../../../src/profiles/voiceResolution.js";
import { voiceLanguageDiffers } from "../../../src/profiles/voiceBrowser.js";

const GLOBAL: GlobalVoice = {
  providerId: "kyutai-pocket",
  baseUrl: "http://localhost:8000",
  voice: "estelle",
  speed: 1.2
};

function mode(tts: TtsBinding): ReadingMode {
  return {
    id: "m",
    label: "M",
    mode: "faithful",
    language: "fr-FR",
    tts,
    chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
    playback: { rate: 1.1, volume: 1 }
  };
}

describe("V5: withEffectiveVoice, the table of the priority", () => {
  it("`tts: {}` inherits: the global voice replaces it whole, speed left out", () => {
    expect(withEffectiveVoice(mode({}), GLOBAL).tts).toEqual({
      providerId: "kyutai-pocket",
      baseUrl: "http://localhost:8000",
      voice: "estelle"
    });
    expect(effectiveModeOf(mode({}), GLOBAL).voiceOrigin).toBe("global");
  });

  it.each<[string, TtsBinding]>([
    ["a full voice", { providerId: "chatterbox", baseUrl: "http://localhost:8004", voice: "Emily.wav" }],
    ["`{ parameters }` alone", { parameters: { exaggeration: 0.9 } }],
    ["`{ format }` alone", { format: "mp3" }],
    ['`{ providerId: "auto" }`', { providerId: "auto" }]
  ])("%s is a voice of its own, rendered as it is", (_name, tts) => {
    const own = mode(tts);
    expect(hasOwnVoice(own)).toBe(true);
    expect(withEffectiveVoice(own, GLOBAL)).toBe(own);
    expect(effectiveModeOf(own, GLOBAL).voiceOrigin).toBe("mode");
  });

  it("undefined members are not a voice: what a JSON round trip would drop anyway", () => {
    expect(hasOwnVoice(mode({ voice: undefined } as unknown as TtsBinding))).toBe(false);
  });

  it("everything but `tts` is the mode's", () => {
    const { tts: _tts, ...rest } = withEffectiveVoice(mode({}), GLOBAL);
    const { tts: _own, ...expected } = mode({});
    expect(rest).toEqual(expected);
  });
});

describe("V4, cause D: an engine and its voice change together", () => {
  it("`auto` resolved to Chatterbox: the voice is saved with Chatterbox, not with `auto`", () => {
    expect(
      bindingForEngineVoice({ providerId: "auto" }, { providerId: "chatterbox", baseUrl: "http://localhost:8004" }, "x")
    ).toEqual({ providerId: "chatterbox", baseUrl: "http://localhost:8004", voice: "x" });
  });

  it("no state where the voice comes from another engine: settings of the previous engine do not follow", () => {
    const next = bindingForEngineVoice(
      { providerId: "chatterbox", baseUrl: "http://localhost:8004", parameters: { exaggeration: 0.9 }, format: "wav", model: "m" },
      { providerId: "kokoro", baseUrl: "http://localhost:8880" },
      "ff_siwis"
    );
    expect(next).toEqual({ providerId: "kokoro", baseUrl: "http://localhost:8880", voice: "ff_siwis" });
  });

  it("the same engine keeps its settings, never the sample (cause A)", () => {
    const next = bindingForEngineVoice(
      {
        providerId: "chatterbox",
        baseUrl: "http://localhost:8004",
        voice: "old",
        parameters: { exaggeration: 0.9 },
        referenceAudio: "/home/me/voice.wav"
      },
      { providerId: "chatterbox", baseUrl: "http://localhost:8004" },
      "new"
    );
    expect(next).toEqual({
      providerId: "chatterbox",
      baseUrl: "http://localhost:8004",
      voice: "new",
      parameters: { exaggeration: 0.9 }
    });
  });

  it("the system engine has no URL to save", () => {
    expect(bindingForEngineVoice({ providerId: "auto" }, { providerId: "system", baseUrl: "" }, "french")).toEqual({
      providerId: "system",
      voice: "french"
    });
  });
});

describe("V11: the speed", () => {
  const declared = [{ name: "speed", label: "Vitesse", type: "number" as const, min: 0.5, max: 2 }];

  it("asked = voice × mode", () => {
    expect(requestedSpeed({ speed: 1.5 }, { playback: { rate: 1.1, volume: 1 } })).toBeCloseTo(1.65);
  });

  it("an engine that declares it gets the product, within bounds, and the gap shows", () => {
    expect(resolveEngineSpeed(1.65, declared)).toEqual({ route: "engine", requested: 1.65, speed: 1.65, limited: false });
    expect(describeSpeedGap(resolveEngineSpeed(1.65, declared))).toBeUndefined();

    const high = resolveEngineSpeed(3, declared);
    expect(high).toMatchObject({ route: "engine", speed: 2, limited: true });
    expect(describeSpeedGap(high)).toBe("×2, maximum de cette voix");
    expect(describeSpeedGap(resolveEngineSpeed(0.25, declared))).toBe("×0.5, minimum de cette voix");
  });

  it("without a way, the reason shows as soon as the speed asked differs from 1, the factor of the mode alone included", () => {
    expect(describeSpeedGap(resolveEngineSpeed(1.1, []))).toBe("Vitesse non disponible avec cette voix");
    expect(describeSpeedGap(resolveEngineSpeed(1, []))).toBeUndefined();
  });

  it("a parameter of the name `speed` that is not a number is not that contract", () => {
    expect(resolveEngineSpeed(1.5, [{ name: "speed", label: "x", type: "string" }]).route).toBe("none");
  });
});

describe("V3 (pure part): ttsInstanceKey, cause B", () => {
  const chatterbox = { providerId: "chatterbox", baseUrl: "http://localhost:8004" };

  it("tells apart the sample, the URL and the resolved engine", () => {
    const keys = [
      ttsInstanceKey(chatterbox, undefined),
      ttsInstanceKey(chatterbox, "/a.wav"),
      ttsInstanceKey(chatterbox, "/b.wav"),
      ttsInstanceKey({ ...chatterbox, baseUrl: "http://localhost:9000" }, undefined),
      ttsInstanceKey({ providerId: "system", baseUrl: "" }, undefined)
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("system has no URL: the one left in the settings does not split its audio", () => {
    expect(ttsInstanceKey({ providerId: "system", baseUrl: "http://127.0.0.1:8004" }, undefined)).toBe(
      ttsInstanceKey({ providerId: "system", baseUrl: "" }, undefined)
    );
  });

  it("the speed of the engine enters the cache key, and no speed leaves it as it was", () => {
    const material = { providerId: "kokoro@u", voice: "v", spokenText: "t" };
    expect(computeCacheKey(material)).not.toBe(computeCacheKey({ ...material, speed: 1.5 }));
    expect(computeCacheKey({ ...material, speed: 1.5 })).not.toBe(computeCacheKey({ ...material, speed: 2 }));
  });
});

describe("describeVoice", () => {
  it("names a voice in the words of its catalogue", () => {
    expect(describeVoice({ providerId: "kyutai-pocket", voice: "estelle" })).toBe("Estelle");
    expect(describeVoice({ providerId: "kyutai-pocket", voice: "eponine" })).toBe("Éponine");
  });

  it("`auto` and an absent engine read the same, never raw", () => {
    expect(describeVoice({ providerId: "auto" })).toBe("Voix automatique");
    expect(describeVoice({})).toBe("Voix automatique");
  });

  it("tells the two system tiers apart", () => {
    expect(describeVoice({ providerId: "system" })).toBe("Voix système");
    expect(describeVoice({ providerId: "system", voice: "fr_FR-siwis-medium" })).toBe(
      "Voix française autonome (Piper)"
    );
  });

  it("an id no catalogue knows stays what it is; a sample outranks a voice name, as at synthesis", () => {
    expect(describeVoice({ providerId: "chatterbox", voice: "Emily.wav" })).toBe("Emily.wav");
    expect(describeVoice({ providerId: "chatterbox", voice: "Emily.wav", referenceAudio: "/a.wav" })).toBe(
      "Votre échantillon"
    );
  });
});

describe("V19: the language warns, it never decides", () => {
  it("a `fr` voice and an `en-US` mode: the warning, the voice unchanged", () => {
    const inherited = withEffectiveVoice({ ...mode({}), language: "en-US" }, GLOBAL);
    const language = declaredVoiceLanguage(inherited.tts);
    expect(language).toBe("fr");
    expect(voiceLanguageDiffers({ id: "estelle", label: "Estelle", language: "fr" }, "en-US")).toBe(true);
    expect(inherited.tts.voice).toBe("estelle");
    expect(formatVoiceLanguageWarning("Estelle", "fr", "en-US")).toContain("Estelle");
  });

  it("same language, dialect aside: nothing", () => {
    expect(voiceLanguageDiffers({ id: "estelle", label: "Estelle", language: "fr" }, "fr-CA")).toBe(false);
  });

  it("an unknown language: nothing to contradict the mode with", () => {
    expect(declaredVoiceLanguage({ providerId: "chatterbox", voice: "Emily.wav" })).toBeUndefined();
    expect(declaredVoiceLanguage({ providerId: "system" })).toBeUndefined();
    expect(voiceLanguageDiffers({ id: "x", label: "X" }, "en-US")).toBe(false);
  });

  it("a sample has no declared language, whatever voice is named next to it", () => {
    expect(declaredVoiceLanguage({ voice: "estelle", referenceAudio: "/a.wav" })).toBeUndefined();
  });
});
