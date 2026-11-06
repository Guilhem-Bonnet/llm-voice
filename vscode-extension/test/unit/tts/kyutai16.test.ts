import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveTtsConfig, ttsInstanceKey } from "../../../src/pipeline/resolveProviderConfig.js";
import { describeVoice, declaredVoiceLanguage } from "../../../src/profiles/voiceResolution.js";
import { friendlyTtsProviderLabel } from "../../../src/profiles/ttsProviderLabel.js";
import { createEgressGuard, type EgressGuardHandle } from "../../../src/net/EgressGuard.js";
import { KyutaiPocketProvider } from "../../../src/tts/KyutaiPocketProvider.js";
import { KYUTAI16_DEFAULT_VOICE, KYUTAI16_VOICE_CATALOG, KYUTAI16_VOICE_CAVEAT } from "../../../src/tts/kyutai16VoiceCatalog.js";
import {
  KYUTAI16_LOCAL_PRESET,
  TTS_PROVIDER_PRESETS,
  createTtsProvider,
  findTtsProviderPreset,
  presetKindForProviderId
} from "../../../src/tts/presets.js";

const REPO = resolve(__dirname, "../../../..");
const SETTINGS = { provider: "auto", baseUrl: "http://localhost:8004" };

function readNames(path: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(REPO, path), "utf8")) as Record<string, string>;
}

function recordingEgress(respond: (url: string, init: RequestInit | undefined) => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  });
  return { calls, egress: { fetch } as unknown as EgressGuardHandle };
}

function provider(respond: (url: string, init: RequestInit | undefined) => Response) {
  const { calls, egress } = recordingEgress(respond);
  const tts = createTtsProvider({ kind: "kyutai-1-6b", baseUrl: KYUTAI16_LOCAL_PRESET.baseUrl }, { egress });
  return { calls, tts };
}

describe("the voices of Kyutai TTS 1.6B", () => {
  it("are the 36 named voices of the bench and of the server, Camille first", () => {
    const bench = readNames("scripts/voice-lab/voice-names.json");
    expect(readNames("deploy/kyutai16/voices.json")).toEqual(bench);
    expect(Object.fromEntries(KYUTAI16_VOICE_CATALOG.map((voice) => [voice.id, voice.label]))).toEqual(bench);
    expect(KYUTAI16_VOICE_CATALOG).toHaveLength(36);
    expect(KYUTAI16_VOICE_CATALOG[0]).toMatchObject({ id: "cml-577_394", label: "Camille" });
    expect(KYUTAI16_DEFAULT_VOICE).toBe("cml-577_394");
    expect(new Set(KYUTAI16_VOICE_CATALOG.map((voice) => voice.label)).size).toBe(36);
  });

  it("say where they come from and under which licence: CML-TTS CC BY 4.0, Estelle CC0", () => {
    for (const voice of KYUTAI16_VOICE_CATALOG) {
      expect(voice.language, voice.id).toBe("fr");
      expect(voice.licence?.dataset, voice.id).toContain("kyutai/tts-voices");
      expect(voice.licence?.sourceUrl, voice.id).toMatch(/^https:\/\/huggingface\.co\/kyutai\/tts-voices\//);
      expect(voice.licence?.spdx, voice.id).toBe(voice.id === "estelle" ? "CC0-1.0" : "CC-BY-4.0");
      expect(voice.licence?.attributionRequired, voice.id).toBe(voice.id !== "estelle");
    }
  });

  it("say that accent and consent to cloning are not documented", () => {
    expect(KYUTAI16_VOICE_CAVEAT).toContain("accent");
    expect(KYUTAI16_VOICE_CAVEAT).toContain("consentement");
    expect(KYUTAI16_VOICE_CAVEAT).toContain("français");
  });

  it("ship no sample: consent is not established", () => {
    for (const voice of KYUTAI16_VOICE_CATALOG) {
      expect(voice.preview, voice.id).toBeUndefined();
    }
    const samples = readdirSync(resolve(__dirname, "../../../media/voices"));
    expect(samples.filter((name) => name.startsWith("cml-") || name.includes("577_394"))).toEqual([]);
  });

  it("carry their names wherever the interface speaks of a voice", () => {
    expect(describeVoice({ providerId: "kyutai-1-6b", voice: "cml-577_394" })).toBe("Camille");
    expect(declaredVoiceLanguage({ providerId: "kyutai-1-6b", voice: "cml-7601_7727" })).toBe("fr");
    expect(describeVoice({ providerId: "kyutai-pocket", voice: "estelle" })).toBe("Estelle");
  });
});

describe("the preset and its port", () => {
  it("targets port 8020, stays local and opt-in", () => {
    expect(KYUTAI16_LOCAL_PRESET).toMatchObject({
      kind: "kyutai-1-6b",
      baseUrl: "http://localhost:8020",
      languages: ["fr"],
      voice: "cml-577_394",
      remote: false
    });
    expect(TTS_PROVIDER_PRESETS).toContain(KYUTAI16_LOCAL_PRESET);
    expect(findTtsProviderPreset("kyutai-1-6b-local")).toBe(KYUTAI16_LOCAL_PRESET);
    expect(KYUTAI16_LOCAL_PRESET.label).not.toMatch(/profil/i);
  });

  it("matches the port the compose service publishes, on loopback only", () => {
    const compose = readFileSync(resolve(REPO, "deploy/docker-compose.tts.yml"), "utf8");
    expect(compose).toContain('"127.0.0.1:8020:8020"');
    expect(new URL(KYUTAI16_LOCAL_PRESET.baseUrl).port).toBe("8020");
  });

  it("maps the provider id to its kind, never the preset id", () => {
    expect(presetKindForProviderId("kyutai-1-6b")).toBe("kyutai-1-6b");
    expect(presetKindForProviderId("kyutai-1-6b-local")).toBe("openai-compatible");
  });

  it("keeps its own port when the binding names none, and lets a binding's own URL win", () => {
    expect(resolveTtsConfig({ providerId: "kyutai-1-6b" }, SETTINGS)).toEqual({
      providerId: "kyutai-1-6b",
      baseUrl: "http://localhost:8020"
    });
    expect(resolveTtsConfig({ providerId: "kyutai-1-6b", baseUrl: "http://127.0.0.1:9020" }, SETTINGS).baseUrl).toBe(
      "http://127.0.0.1:9020"
    );
  });

  it("has a cache key of its own, whatever URL Pocket and it are given (ADR-017)", () => {
    const url = "http://localhost:8020";
    const narration = ttsInstanceKey({ providerId: "kyutai-1-6b", baseUrl: url }, undefined);
    const pocket = ttsInstanceKey({ providerId: "kyutai-pocket", baseUrl: url }, undefined);
    expect(narration).toBe("kyutai-1-6b@http://localhost:8020");
    expect(narration).not.toBe(pocket);
  });

  it("has a label of its own, in plain words", () => {
    expect(friendlyTtsProviderLabel("kyutai-1-6b")).toBe("Kyutai narration (carte graphique)");
  });
});

describe("the provider: KyutaiPocketProvider, with another catalogue", () => {
  it("is the same class, not a copy", () => {
    const tts = createTtsProvider(
      { kind: "kyutai-1-6b", baseUrl: "http://localhost:8020" },
      { egress: createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false }) }
    );
    expect(tts).toBeInstanceOf(KyutaiPocketProvider);
    expect(tts.id).toBe("kyutai-1-6b");
  });

  it("takes the id it is given: the key above reaches the audio cache", () => {
    const tts = createTtsProvider(
      { kind: "kyutai-1-6b", baseUrl: "http://localhost:8020" },
      { id: "kyutai-1-6b@http://localhost:8020", egress: createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false }) }
    );
    expect(tts.id).toBe("kyutai-1-6b@http://localhost:8020");
  });

  it("lists its 36 voices without a call, Camille first, and declares French", async () => {
    const { calls, tts } = provider(() => new Response());
    const voices = await tts.listVoices?.();
    expect(voices).toHaveLength(36);
    expect(voices?.[0]?.id).toBe("cml-577_394");
    const capabilities = await tts.getCapabilities();
    expect(capabilities.languages).toEqual(["fr"]);
    expect(capabilities.voices).toBe(KYUTAI16_VOICE_CATALOG);
    expect(calls).toEqual([]);
  });

  it("leaves Pocket's catalogue as it was", async () => {
    const { egress } = recordingEgress(() => new Response());
    const pocket = createTtsProvider({ kind: "kyutai-pocket", baseUrl: "http://localhost:8000" }, { egress });
    expect((await pocket.listVoices?.())?.[0]?.id).toBe("estelle");
    expect(await pocket.listVoices?.()).toHaveLength(20);
  });

  it("sends the text and the voice id to /tts, and reads the WAV", async () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const { calls, tts } = provider(() => new Response(wav, { status: 200 }));
    const audio = await tts.synthesize({ text: "Bonjour", language: "fr", voice: "cml-577_394" });
    expect(calls[0]?.url).toBe("http://localhost:8020/tts");
    const form = calls[0]?.init?.body as FormData;
    expect(form.get("text")).toBe("Bonjour");
    expect(form.get("voice_url")).toBe("cml-577_394");
    expect(form.get("voice_wav")).toBeNull();
    expect(audio.format).toBe("wav");
  });

  it("reports the server's own words for a game in progress, under its own name", async () => {
    const { tts } = provider(
      () => new Response(JSON.stringify({ detail: "Mode jeu actif (gpu-yield)" }), { status: 503 })
    );
    await expect(tts.synthesize({ text: "Bonjour", language: "fr" })).rejects.toThrow(
      /^Kyutai narration: HTTP 503 from localhost\/tts — Mode jeu actif \(gpu-yield\)$/
    );
  });

  it("reads health as Pocket does: only `healthy` is ok", async () => {
    const up = provider(() => new Response(JSON.stringify({ status: "healthy", gpu_yield: false })));
    expect((await up.tts.health()).status).toBe("ok");
    expect(up.calls[0]?.url).toBe("http://localhost:8020/health");
    const other = provider(() => new Response(JSON.stringify({ status: "starting" })));
    expect((await other.tts.health()).status).toBe("unreachable");
  });
});
