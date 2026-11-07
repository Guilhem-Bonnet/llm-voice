/**
 * GAO-qwen3-dans-l-001, step 1: the Qwen3 engine (`deploy/qwen3/server.py`) behind the
 * Kyutai contract, its voice, its place in the automatic choice, and its fallback.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProviderHealth } from "../../../src/core/health.js";
import type { EgressGuardHandle } from "../../../src/net/EgressGuard.js";
import {
  chooseQwen3OrFallback,
  isHealthyEnough,
  qwen3FallbackMessage,
  resolveTtsConfig,
  selectAutoTtsProvider
} from "../../../src/pipeline/resolveProviderConfig.js";
import { friendlyTtsProviderLabel } from "../../../src/profiles/ttsProviderLabel.js";
import { describeVoice } from "../../../src/profiles/voiceResolution.js";
import { QWEN3_DEFAULT_VOICE, QWEN3_VOICE_CATALOG } from "../../../src/tts/qwen3VoiceCatalog.js";
import { QWEN3_LOCAL_PRESET, createTtsProvider, findTtsProviderPreset, presetKindForProviderId } from "../../../src/tts/presets.js";
import {
  QWEN3_COMPOSE_COMMAND,
  activeEntryId,
  activeLabel,
  bindingForEntry,
  buildCards,
  galleryEntry,
  knownGalleryIds,
  parseGalleryMessage,
  startCommand
} from "../../../src/views/voiceGallery/galleryModel.js";

const REPO = resolve(__dirname, "../../../..");
const SETTINGS = { provider: "auto", baseUrl: "http://localhost:8004" };

function recordingEgress(respond: (url: string, init: RequestInit | undefined) => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  });
  return { calls, egress: { fetch } as unknown as EgressGuardHandle };
}

function qwen3(respond: (url: string, init: RequestInit | undefined) => Response) {
  const { calls, egress } = recordingEgress(respond);
  return { calls, tts: createTtsProvider(QWEN3_LOCAL_PRESET, { egress }) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const WAV = new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]);

function health(status: ProviderHealth["status"], detail?: string): ProviderHealth {
  return { providerId: "x", status, checkedAt: 0, ...(detail !== undefined ? { detail } : {}) };
}

describe("the Qwen3 voice", () => {
  it("is the server's default voice, under the name the server gives it", () => {
    const served = JSON.parse(readFileSync(resolve(REPO, "deploy/qwen3/voices.json"), "utf8")) as {
      default: string;
      voices: Record<string, { name: string }>;
    };
    expect(QWEN3_DEFAULT_VOICE).toBe(served.default);
    expect(QWEN3_VOICE_CATALOG).toEqual([{ id: served.default, label: served.voices[served.default]?.name, language: "fr" }]);
    expect(describeVoice({ providerId: "qwen3", voice: QWEN3_DEFAULT_VOICE })).toBe("Voix des essais 21 et 22");
  });

  it("is a preset of its own, on the port of the compose service, with a plain French label", () => {
    const compose = readFileSync(resolve(REPO, "deploy/docker-compose.tts.yml"), "utf8");
    expect(compose).toContain('"127.0.0.1:8021:8021"');
    expect(findTtsProviderPreset("qwen3-local")).toBe(QWEN3_LOCAL_PRESET);
    expect(QWEN3_LOCAL_PRESET).toMatchObject({ kind: "qwen3", baseUrl: "http://localhost:8021", voice: QWEN3_DEFAULT_VOICE, remote: false });
    expect(presetKindForProviderId("qwen3")).toBe("qwen3");
    expect(friendlyTtsProviderLabel("qwen3")).toBe("Voix Qwen3 (carte graphique)");
    expect(`${friendlyTtsProviderLabel("qwen3")} ${QWEN3_VOICE_CATALOG[0]?.label}`).not.toMatch(/profil/i);
  });

  it("keeps its own port when a profile names it without a URL", () => {
    expect(resolveTtsConfig({ providerId: "qwen3" }, SETTINGS)).toEqual({ providerId: "qwen3", baseUrl: "http://localhost:8021" });
  });
});

describe("the Qwen3 provider", () => {
  it("declares that it prepares the whole reading first, and one voice", async () => {
    const { tts } = qwen3(() => json({}));
    expect(tts.id).toBe("qwen3");
    const capabilities = await tts.getCapabilities();
    expect(capabilities.wholeReadingFirst).toBe(true);
    expect(capabilities.voices.map((voice) => voice.id)).toEqual([QWEN3_DEFAULT_VOICE]);
    expect(capabilities.multiVoice).toBeUndefined();
  });

  it("sends the frozen voice by default, and no direction when the segment has none", async () => {
    const { calls, tts } = qwen3(() => new Response(WAV, { status: 200 }));
    await tts.synthesize({ text: "Bonjour." });
    const form = calls[0]?.init?.body as FormData;
    expect(calls[0]?.url).toBe("http://localhost:8021/tts");
    expect(form.get("text")).toBe("Bonjour.");
    expect(form.get("voice_url")).toBe(QWEN3_DEFAULT_VOICE);
    expect(form.has("direction")).toBe(false);
  });

  it("forwards a segment's direction, ready for step 2; a blank one is not sent", async () => {
    const { calls, tts } = qwen3(() => new Response(WAV, { status: 200 }));
    await tts.synthesize({ text: "Viens.", direction: "whispering, urgent" });
    await tts.synthesize({ text: "Viens.", direction: "   " });
    expect((calls[0]?.init?.body as FormData).get("direction")).toBe("whispering, urgent");
    expect((calls[1]?.init?.body as FormData).has("direction")).toBe(false);
  });

  it("asks the server to load with POST /load, without a parameter: the frozen voice", async () => {
    const { calls, tts } = qwen3(() => json({ state: "loading", mode: "frozen" }, 202));
    await tts.prepare?.();
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([["http://localhost:8021/load", "POST"]]);
  });

  it("reads game mode in /health: it answers, but is not usable", async () => {
    const { tts } = qwen3(() => json({ status: "healthy", state: "yielded", model_loaded: true, gpu_yield: true }));
    const result = await tts.health();
    expect(result).toMatchObject({ status: "degraded", detail: "gpu-yield", modelLoaded: true });
    expect(isHealthyEnough(result)).toBe(false);
  });

  it("reports a loading model, and a ready one", async () => {
    const loading = qwen3(() => json({ status: "healthy", state: "loading", model_loaded: false, gpu_yield: false, loading_since_s: 3 }));
    expect(await loading.tts.health()).toMatchObject({ status: "degraded", detail: "loading", loadingSinceMs: 3000 });
    const ready = qwen3(() => json({ status: "healthy", state: "ready", model_loaded: true, gpu_yield: false }));
    expect(await ready.tts.health()).toMatchObject({ status: "ok", modelLoaded: true });
  });

  it("turns a 503 gpu_yield into a hold, never a skipped passage", async () => {
    const { tts } = qwen3(() => json({ detail: "Mode jeu actif : la carte graphique est au jeu.", reason: "gpu_yield" }, 503));
    await expect(tts.synthesize({ text: "Bonjour." })).rejects.toMatchObject({ name: "TtsHoldError", reason: "gpu-yield" });
  });
});

describe("Qwen3 in the automatic choice", () => {
  const candidate = (providerId: string, result: ProviderHealth) => ({ providerId, baseUrl: `http://${providerId}`, health: async () => result });
  const SYSTEM = { providerId: "system", baseUrl: "" };

  it("wins when it answers", async () => {
    const chosen = await selectAutoTtsProvider([candidate("qwen3", health("ok")), candidate("kyutai-1-6b", health("ok"))], SYSTEM);
    expect(chosen.providerId).toBe("qwen3");
  });

  it("is skipped in game mode and when unreachable", async () => {
    const yielded = await selectAutoTtsProvider([candidate("qwen3", health("degraded", "gpu-yield")), candidate("kyutai-1-6b", health("ok"))], SYSTEM);
    expect(yielded.providerId).toBe("kyutai-1-6b");
    const down = await selectAutoTtsProvider([candidate("qwen3", health("unreachable")), candidate("kyutai-1-6b", health("unreachable"))], SYSTEM);
    expect(down).toEqual(SYSTEM);
  });
});

describe("the fallback of a reading asked of Qwen3", () => {
  it("keeps Qwen3 when it answers, even while it loads", () => {
    expect(chooseQwen3OrFallback({ gameMode: false, qwen3: health("ok") })).toEqual({ use: "qwen3" });
    expect(chooseQwen3OrFallback({ gameMode: false, qwen3: health("degraded", "loading") })).toEqual({ use: "qwen3" });
  });

  it("falls back on Camille (Kyutai) when Qwen3 does not answer and Kyutai does", () => {
    const choice = chooseQwen3OrFallback({ gameMode: false, qwen3: health("unreachable"), kyutai16: health("ok") });
    expect(choice).toEqual({ use: "kyutai-1-6b", reason: "unreachable" });
    expect(qwen3FallbackMessage(choice as Exclude<typeof choice, { use: "qwen3" }>)).toMatch(/ne répond pas.*Camille \(Kyutai\)/);
  });

  it("falls back on the system voice when neither answers, or when nothing was probed", () => {
    expect(chooseQwen3OrFallback({ gameMode: false, qwen3: health("unreachable"), kyutai16: health("unreachable") })).toEqual({ use: "system", reason: "unreachable" });
    expect(chooseQwen3OrFallback({ gameMode: false })).toEqual({ use: "system", reason: "unreachable" });
  });

  it("goes straight to the system voice in game mode: Kyutai is on the same card", () => {
    const local = chooseQwen3OrFallback({ gameMode: true, kyutai16: health("ok") });
    expect(local).toEqual({ use: "system", reason: "game-mode" });
    const served = chooseQwen3OrFallback({ gameMode: false, qwen3: health("degraded", "gpu-yield"), kyutai16: health("ok") });
    expect(served).toEqual({ use: "system", reason: "game-mode" });
    expect(qwen3FallbackMessage({ use: "system", reason: "game-mode" })).toMatch(/mode jeu.*la voix système/);
  });
});

describe("the Qwen3 voice in the gallery", () => {
  const ID = `qwen3:${QWEN3_DEFAULT_VOICE}`;
  const status = { kyutai: "unknown", kyutai16: "unknown", qwen3: "unknown", kokoro: "unknown", chatterbox: "unknown" } as const;

  it("is an entry of its own, which writes Qwen3 and its voice, and is then shown as chosen", () => {
    const entry = galleryEntry(ID);
    expect(entry).toMatchObject({ label: "Voix des essais 21 et 22", engine: "qwen3", voice: QWEN3_DEFAULT_VOICE });
    const binding = bindingForEntry(entry!, { providerId: "kyutai-1-6b", baseUrl: "http://localhost:8020", voice: "cml-577_394" });
    expect(binding).toEqual({ providerId: "qwen3", baseUrl: "http://localhost:8021", voice: QWEN3_DEFAULT_VOICE });
    expect(activeEntryId(binding)).toBe(ID);
    expect(activeLabel(binding)).toBe("Voix des essais 21 et 22");
  });

  it("has its own section, can be chosen once its server is started, and can always be tried", () => {
    const stopped = buildCards({ status, piperInstalled: false, sampleUri: (path) => path }).find((card) => card.id === ID);
    expect(stopped).toMatchObject({ section: "qwen3", engine: "qwen3", ready: false, canChoose: false, canListen: true, state: "Non prête" });
    const started = buildCards({ status: { ...status, qwen3: "started" }, piperInstalled: false, sampleUri: (path) => path }).find((card) => card.id === ID);
    expect(started).toMatchObject({ ready: true, canChoose: true, state: "Prête" });
  });

  it("gives the command that starts its service, without the word V9 removes", () => {
    expect(startCommand("qwen3", "http://localhost:8021")).toBe(QWEN3_COMPOSE_COMMAND);
    expect(QWEN3_COMPOSE_COMMAND).toContain("docker compose -f deploy/docker-compose.tts.yml up -d qwen3");
    expect(QWEN3_COMPOSE_COMMAND).not.toMatch(/profil/i);
    expect(parseGalleryMessage({ type: "copyCommand", engine: "qwen3" }, knownGalleryIds())).toEqual({ type: "copyCommand", engine: "qwen3" });
    expect(parseGalleryMessage({ type: "choose", voiceId: ID }, knownGalleryIds())).toEqual({ type: "choose", voiceId: ID });
  });
});
