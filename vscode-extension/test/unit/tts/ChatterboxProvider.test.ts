import { afterEach, describe, expect, it } from "vitest";
import { createEgressGuard } from "../../../src/net/EgressGuard.js";
import { ChatterboxProvider } from "../../../src/tts/ChatterboxProvider.js";
import { MockTtsServer } from "../../fakes/mockTtsServer.js";

function egress() {
  return createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
}

describe("ChatterboxProvider (ADR-005/ADR-009, CdC §24-25, §28)", () => {
  let server: MockTtsServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("sends exaggeration/cfg_weight/temperature/language_id in the JSON body", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const provider = new ChatterboxProvider({ baseUrl, egress: egress() });

    await provider.synthesize({
      text: "Bonjour",
      language: "fr",
      parameters: { exaggeration: 0.7, cfg_weight: 0.3, temperature: 0.9 }
    });

    const body = JSON.parse(server.requests[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body["language_id"]).toBe("fr");
    expect(body["exaggeration"]).toBe(0.7);
    expect(body["cfg_weight"]).toBe(0.3);
    expect(body["temperature"]).toBe(0.9);
    expect(body["input"]).toBe("Bonjour");
  });

  it("omits engine-specific fields when no parameters are given", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const provider = new ChatterboxProvider({ baseUrl, egress: egress() });

    await provider.synthesize({ text: "Bonjour" });

    const body = JSON.parse(server.requests[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body).not.toHaveProperty("exaggeration");
    expect(body).not.toHaveProperty("cfg_weight");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("language_id");
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
    expect(names).toEqual(["exaggeration", "cfg_weight", "temperature", "language_id"]);
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

  it("id defaults to \"chatterbox\"", () => {
    const provider = new ChatterboxProvider({ baseUrl: "http://127.0.0.1:8004", egress: egress() });
    expect(provider.id).toBe("chatterbox");
  });
});
