import { describe, expect, it } from "vitest";
import { createEgressGuard } from "../../../src/net/EgressGuard.js";
import { ChatterboxProvider } from "../../../src/tts/ChatterboxProvider.js";
import { KokoroProvider } from "../../../src/tts/KokoroProvider.js";
import { OpenAICompatibleTtsProvider } from "../../../src/tts/OpenAICompatibleTtsProvider.js";
import { SystemTtsProvider } from "../../../src/tts/SystemTtsProvider.js";
import {
  CHATTERBOX_LOCAL_PRESET,
  KOKORO_LOCAL_PRESET,
  OPENAI_COMPATIBLE_PRESET,
  PIPER_LOCAL_PRESET,
  SYSTEM_LOCAL_PRESET,
  TTS_PROVIDER_PRESETS,
  createTtsProvider,
  findTtsProviderPreset,
  presetKindForProviderId
} from "../../../src/tts/presets.js";

function egress() {
  return createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
}

describe("TTS provider presets (ADR-009)", () => {
  it("chatterbox-local targets localhost:8004, not remote", () => {
    expect(CHATTERBOX_LOCAL_PRESET.baseUrl).toBe("http://localhost:8004");
    expect(CHATTERBOX_LOCAL_PRESET.remote).toBe(false);
  });

  it("chatterbox-local no longer defaults to a reference clone that cannot resolve in a packaged VSIX (bug fix, 2026-09-12)", () => {
    // `../deploy/tts/reference-audio/...` only ever resolves in a repository
    // checkout (`Pipeline.resolveReferenceAudioPath`'s doc comment) — a
    // packaged `.vsix` never bundles `deploy/`, so defaulting to it produced
    // an unsynthesizable profile on every real install. See this preset's own
    // doc comment for the full trace of the resulting infinite loop.
    expect(CHATTERBOX_LOCAL_PRESET.referenceAudio).toBeUndefined();
    expect(CHATTERBOX_LOCAL_PRESET.parameters).toEqual({
      exaggeration: 0.4,
      cfg_weight: 0.5,
      temperature: 0.6
    });
  });

  it("kokoro-local targets localhost:8880 with the French default voice", () => {
    expect(KOKORO_LOCAL_PRESET.baseUrl).toBe("http://localhost:8880");
    expect(KOKORO_LOCAL_PRESET.voice).toBe("ff_siwis");
    expect(KOKORO_LOCAL_PRESET.remote).toBe(false);
  });

  it("piper-local targets localhost:5000 and stays generic OpenAI-compatible", () => {
    expect(PIPER_LOCAL_PRESET.baseUrl).toBe("http://localhost:5000");
    expect(PIPER_LOCAL_PRESET.kind).toBe("openai-compatible");
    expect(PIPER_LOCAL_PRESET.remote).toBe(false);
  });

  it("openai-compatible is the only remote-by-default preset", () => {
    expect(OPENAI_COMPATIBLE_PRESET.remote).toBe(true);
    expect(TTS_PROVIDER_PRESETS.filter((preset) => preset.remote)).toEqual([OPENAI_COMPATIBLE_PRESET]);
  });

  it("findTtsProviderPreset() looks up by id", () => {
    expect(findTtsProviderPreset("chatterbox-local")).toBe(CHATTERBOX_LOCAL_PRESET);
    expect(findTtsProviderPreset("does-not-exist")).toBeUndefined();
  });

  it("system (S7.1) is zero-install, no baseUrl needed", () => {
    expect(SYSTEM_LOCAL_PRESET.kind).toBe("system");
    expect(SYSTEM_LOCAL_PRESET.remote).toBe(false);
    expect(TTS_PROVIDER_PRESETS).toContain(SYSTEM_LOCAL_PRESET);
  });

  it("presetKindForProviderId() maps known ids, defaults everything else to generic", () => {
    expect(presetKindForProviderId("chatterbox")).toBe("chatterbox");
    expect(presetKindForProviderId("kokoro")).toBe("kokoro");
    expect(presetKindForProviderId("system")).toBe("system");
    expect(presetKindForProviderId("openai-compatible")).toBe("openai-compatible");
    expect(presetKindForProviderId("some-enterprise-endpoint")).toBe("openai-compatible");
  });

  it("createTtsProvider() instantiates the class matching `kind`", () => {
    const options = { egress: egress() };
    expect(createTtsProvider({ kind: "chatterbox", baseUrl: "http://localhost:8004" }, options)).toBeInstanceOf(
      ChatterboxProvider
    );
    expect(createTtsProvider({ kind: "kokoro", baseUrl: "http://localhost:8880" }, options)).toBeInstanceOf(
      KokoroProvider
    );
    expect(
      createTtsProvider({ kind: "openai-compatible", baseUrl: "http://localhost:5000" }, options)
    ).toBeInstanceOf(OpenAICompatibleTtsProvider);
    expect(createTtsProvider({ kind: "system", baseUrl: "" }, options)).toBeInstanceOf(SystemTtsProvider);
  });

  it("createTtsProvider() forwards systemPiperInstallDir only to the system provider", () => {
    const provider = createTtsProvider(
      { kind: "system", baseUrl: "" },
      { egress: egress(), systemPiperInstallDir: "/tmp/piper" }
    );
    expect(provider).toBeInstanceOf(SystemTtsProvider);
  });

  it("createTtsProvider() lets an explicit baseUrl override the preset's own", () => {
    const provider = createTtsProvider(CHATTERBOX_LOCAL_PRESET, {
      baseUrl: "http://127.0.0.1:9999",
      egress: egress()
    });
    expect((provider as unknown as { baseUrl: string }).baseUrl).toBe("http://127.0.0.1:9999");
  });

  it("createTtsProvider() threads referenceAudioPath into ChatterboxProvider only", () => {
    const withRef = createTtsProvider(
      { kind: "chatterbox", baseUrl: "http://localhost:8004" },
      { egress: egress(), referenceAudioPath: "/tmp/ref.wav" }
    ) as unknown as { referenceAudioPath: string | undefined };
    expect(withRef.referenceAudioPath).toBe("/tmp/ref.wav");

    const kokoro = createTtsProvider(
      { kind: "kokoro", baseUrl: "http://localhost:8880" },
      { egress: egress(), referenceAudioPath: "/tmp/ref.wav" }
    ) as unknown as { referenceAudioPath: string | undefined };
    expect(kokoro.referenceAudioPath).toBeUndefined();
  });

  it("createTtsProvider() never puts an apiKey where nothing was given", () => {
    const provider = createTtsProvider(OPENAI_COMPATIBLE_PRESET, {
      baseUrl: "https://api.example.com",
      egress: egress()
    });
    expect((provider as unknown as { apiKey: string | undefined }).apiKey).toBeUndefined();
  });
});
