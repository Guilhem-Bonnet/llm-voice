import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEgressGuard } from "../../../src/net/EgressGuard.js";
import { ChatterboxProvider } from "../../../src/tts/ChatterboxProvider.js";
import { MockTtsServer } from "../../fakes/mockTtsServer.js";
import { makeSilentWav } from "../../fakes/wav.js";

function egress() {
  return createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
}

describe("ChatterboxProvider (ADR-005/ADR-009, CdC §24-25, §28, §55) — native POST /tts", () => {
  let server: MockTtsServer | undefined;
  let tmpDir: string | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (tmpDir !== undefined) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  async function writeReferenceFile(name = "reference.wav"): Promise<string> {
    tmpDir = await mkdtemp(join(tmpdir(), "chatterbox-ref-"));
    const path = join(tmpDir, name);
    await writeFile(path, makeSilentWav(50, 16000));
    return path;
  }

  it("synthesize() posts to /tts (not /v1/audio/speech), voice_mode 'predefined' without a reference", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const provider = new ChatterboxProvider({ baseUrl, egress: egress() });

    await provider.synthesize({
      text: "Bonjour",
      language: "fr-FR",
      voice: "Emily.wav",
      parameters: { exaggeration: 0.7, cfg_weight: 0.3, temperature: 0.9 }
    });

    const requestsToTts = server.requests.filter((request) => request.url === "/tts");
    expect(requestsToTts).toHaveLength(1);
    expect(server.requests.some((request) => request.url === "/v1/audio/speech")).toBe(false);

    const body = JSON.parse(requestsToTts[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body["text"]).toBe("Bonjour");
    expect(body["voice_mode"]).toBe("predefined");
    expect(body["predefined_voice_id"]).toBe("Emily.wav");
    expect(body["reference_audio_filename"]).toBeUndefined();
    // "fr-FR" -> "fr": the server's `language` wants the short code (verified
    // against the real server's /openapi.json, CustomTTSRequest).
    expect(body["language"]).toBe("fr");
    expect(body["exaggeration"]).toBe(0.7);
    expect(body["cfg_weight"]).toBe(0.3);
    expect(body["temperature"]).toBe(0.9);
    expect(body["output_format"]).toBe("wav");
  });

  it("omits engine-specific fields when no parameters/language are given", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const provider = new ChatterboxProvider({ baseUrl, egress: egress() });

    await provider.synthesize({ text: "Bonjour" });

    const body = JSON.parse(server.requests[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body).not.toHaveProperty("exaggeration");
    expect(body).not.toHaveProperty("cfg_weight");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("language");
    expect(body).not.toHaveProperty("predefined_voice_id");
    expect(body["voice_mode"]).toBe("predefined");
  });

  it("uploads the reference once (voice cloning, CdC §55) then sends voice_mode 'clone' with reference_audio_filename", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const referenceAudioPath = await writeReferenceFile("fr-female-siwis.wav");
    const provider = new ChatterboxProvider({ baseUrl, egress: egress(), referenceAudioPath });

    await provider.synthesize({ text: "Bonjour" });
    await provider.synthesize({ text: "Au revoir" });

    // Two syntheses, only one upload (memoised).
    expect(server.uploadedReferenceFilenames).toEqual(["fr-female-siwis.wav"]);
    const ttsRequests = server.requests.filter((request) => request.url === "/tts");
    expect(ttsRequests).toHaveLength(2);
    for (const request of ttsRequests) {
      const body = JSON.parse(request.body) as Record<string, unknown>;
      expect(body["voice_mode"]).toBe("clone");
      expect(body["reference_audio_filename"]).toBe("fr-female-siwis.wav");
      expect(body).not.toHaveProperty("predefined_voice_id");
    }
  });

  it("shares one in-flight upload across concurrent synthesize() calls", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const referenceAudioPath = await writeReferenceFile();
    const provider = new ChatterboxProvider({ baseUrl, egress: egress(), referenceAudioPath });

    await Promise.all([provider.synthesize({ text: "A" }), provider.synthesize({ text: "B" })]);

    expect(server.uploadedReferenceFilenames).toHaveLength(1);
  });

  it("synthesize() rejects when the reference upload fails, instead of silently falling back to a predefined voice", async () => {
    server = new MockTtsServer({ uploadReference500: true });
    const baseUrl = await server.listen();
    const referenceAudioPath = await writeReferenceFile();
    const provider = new ChatterboxProvider({ baseUrl, egress: egress(), referenceAudioPath });

    await expect(provider.synthesize({ text: "Bonjour" })).rejects.toThrow(/upload_reference/);
  });

  it("falls back to voice_mode 'predefined' and warns, instead of failing synthesis, when the reference file cannot be read (bug: stale profile with an unresolvable referenceAudio must still speak)", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const warnings: string[] = [];
    const provider = new ChatterboxProvider({
      baseUrl,
      egress: egress(),
      referenceAudioPath: "/nonexistent/path/does-not-exist.wav",
      onReferenceAudioWarning: (message) => warnings.push(message)
    });

    const result = await provider.synthesize({ text: "Bonjour", voice: "Emily.wav" });

    expect(result.format).toBe("wav");
    const ttsRequests = server.requests.filter((request) => request.url === "/tts");
    expect(ttsRequests).toHaveLength(1);
    const body = JSON.parse(ttsRequests[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body["voice_mode"]).toBe("predefined");
    expect(body["predefined_voice_id"]).toBe("Emily.wav");
    expect(body).not.toHaveProperty("reference_audio_filename");
    expect(server.uploadedReferenceFilenames).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/does-not-exist\.wav/);
  });

  it("only attempts the missing local reference file once across concurrent/subsequent synthesize() calls", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    let warningCount = 0;
    const provider = new ChatterboxProvider({
      baseUrl,
      egress: egress(),
      referenceAudioPath: "/nonexistent/path/does-not-exist.wav",
      onReferenceAudioWarning: () => {
        warningCount += 1;
      }
    });

    await provider.synthesize({ text: "Bonjour" });
    await provider.synthesize({ text: "Au revoir" });

    expect(warningCount).toBe(1);
  });

  it("synthesize() rejects on a non-2xx /tts response", async () => {
    server = new MockTtsServer({ fail500: true });
    const baseUrl = await server.listen();
    const provider = new ChatterboxProvider({ baseUrl, egress: egress() });

    await expect(provider.synthesize({ text: "Bonjour" })).rejects.toThrow(/HTTP 500/);
  });

  it("listVoices() uses /v1/audio/voices when available", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const provider = new ChatterboxProvider({ baseUrl, egress: egress() });

    const voices = await provider.listVoices();
    expect(voices.map((voice) => voice.id)).toContain("mock-voice-fr");
  });

  it("falls back to GET /get_predefined_voices when /v1/audio/voices 404s", async () => {
    server = new MockTtsServer({
      voices404: true,
      predefinedVoices: [
        { voice_id: "fr-teacher", display_name: "Professeur FR", language: "fr" },
        { voice_id: "en-default" }
      ]
    });
    const baseUrl = await server.listen();
    const provider = new ChatterboxProvider({ baseUrl, egress: egress() });

    const voices = await provider.listVoices();
    expect(voices).toEqual([
      { id: "fr-teacher", label: "Professeur FR", language: "fr" },
      { id: "en-default", label: "en-default" }
    ]);
  });

  it("getCapabilities() advertises the Chatterbox tuning parameters", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const provider = new ChatterboxProvider({ baseUrl, egress: egress() });

    const capabilities = await provider.getCapabilities();
    const names = capabilities.parameters.map((param) => param.name);
    expect(names).toEqual(["exaggeration", "cfg_weight", "temperature"]);
  });

  it("health() reports ok when /health answers without a loading status", async () => {
    server = new MockTtsServer({ healthBody: { status: "ready" } });
    const baseUrl = await server.listen();
    const provider = new ChatterboxProvider({ baseUrl, egress: egress() });

    const health = await provider.health();
    expect(health.status).toBe("ok");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("health() reports degraded while the model reports loading", async () => {
    server = new MockTtsServer({ healthBody: { status: "loading" } });
    const baseUrl = await server.listen();
    const provider = new ChatterboxProvider({ baseUrl, egress: egress() });

    const health = await provider.health();
    expect(health.status).toBe("degraded");
    expect(health.detail).toBe("loading");
  });

  it("health() falls back to /v1/audio/voices when the server is unreachable", async () => {
    const provider = new ChatterboxProvider({ baseUrl: "http://127.0.0.1:1", egress: egress() });

    const health = await provider.health();
    expect(health.status).toBe("unreachable");
  });

  it('id defaults to "chatterbox"', () => {
    const provider = new ChatterboxProvider({ baseUrl: "http://127.0.0.1:8004", egress: egress() });
    expect(provider.id).toBe("chatterbox");
  });
});
