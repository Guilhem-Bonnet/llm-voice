import { afterEach, describe, expect, it } from "vitest";
import { createEgressGuard } from "../../../src/net/EgressGuard.js";
import { OpenAICompatibleTtsProvider } from "../../../src/tts/OpenAICompatibleTtsProvider.js";
import { MockTtsServer } from "../../fakes/mockTtsServer.js";
import { readWavHeader } from "../../fakes/wav.js";

describe("OpenAICompatibleTtsProvider (ADR-005)", () => {
  let server: MockTtsServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("health() reports ok from /health", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const provider = new OpenAICompatibleTtsProvider({ baseUrl, egress });

    const health = await provider.health();
    expect(health.status).toBe("ok");
    expect(health.providerId).toBe("openai-compatible");
  });

  it("health() reports unreachable when the server refuses the connection", async () => {
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const provider = new OpenAICompatibleTtsProvider({ baseUrl: "http://127.0.0.1:1", egress });

    const health = await provider.health();
    expect(health.status).toBe("unreachable");
  });

  it("synthesize() posts to /v1/audio/speech and returns a valid wav", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const provider = new OpenAICompatibleTtsProvider({ baseUrl, egress });

    const result = await provider.synthesize({ text: "Bonjour", voice: "default" });
    expect(result.format).toBe("wav");
    const header = readWavHeader(Buffer.from(result.data));
    expect(header.dataSize).toBeGreaterThan(0);
    expect(server.requests[0]?.url).toBe("/v1/audio/speech");
  });

  it("synthesize() rejects when the server always fails", async () => {
    server = new MockTtsServer({ fail500: true });
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const provider = new OpenAICompatibleTtsProvider({ baseUrl, egress });

    await expect(provider.synthesize({ text: "Bonjour" })).rejects.toThrow(/HTTP 500/);
  });

  it("synthesize() rejects instead of following a cross-host redirect (D10)", async () => {
    server = new MockTtsServer({ redirectExternal: true });
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const provider = new OpenAICompatibleTtsProvider({ baseUrl, egress });

    await expect(provider.synthesize({ text: "Bonjour" })).rejects.toThrow();
  });

  it("listVoices() parses the server's voice list", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const provider = new OpenAICompatibleTtsProvider({ baseUrl, egress });

    const voices = await provider.listVoices();
    expect(voices.length).toBeGreaterThan(0);
    expect(voices[0]).toHaveProperty("id");
  });

  it("getCapabilities() never streams in this slice", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const provider = new OpenAICompatibleTtsProvider({ baseUrl, egress });

    const capabilities = await provider.getCapabilities();
    expect(capabilities.streaming).toBe(false);
    expect(capabilities.formats).toEqual(["wav"]);
  });
});
