import { afterEach, describe, expect, it } from "vitest";
import { createEgressGuard } from "../../../src/net/EgressGuard.js";
import { OllamaNarrator } from "../../../src/narrator/OllamaNarrator.js";
import type { NarrationRequest } from "../../../src/core/index.js";
import { MockOllamaServer } from "../../fakes/mockOllamaServer.js";
import { makeSourceSegments } from "../playback/helpers.js";

function baseRequest(overrides: Partial<NarrationRequest> = {}): NarrationRequest {
  return {
    segments: makeSourceSegments(2),
    profileId: "technical-teacher",
    language: "fr-FR",
    mode: "narrated",
    outputContract: "narration-segments",
    ...overrides
  };
}

describe("OllamaNarrator (CdC §21, ADR-005, ADR-010)", () => {
  let server: MockOllamaServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("transform() maps BLOCK_xxx segments returned by the model (AC-10: real request, profile prompt included)", async () => {
    server = new MockOllamaServer();
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OllamaNarrator({ baseUrl, model: "qwen2.5:7b", egress });

    const result = await narrator.transform(baseRequest({ style: "Transforme en explication pédagogique." }));

    expect(result.degraded).toBe(false);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.spokenText).toContain("[narrated]");

    expect(server.requests).toHaveLength(1);
    const sentBody = JSON.parse(server.requests[0]?.body ?? "{}") as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(sentBody.model).toBe("qwen2.5:7b");
    expect(sentBody.stream).toBe(false);
    expect(sentBody.messages[0]?.content).toContain("Transforme en explication pédagogique.");
    expect(sentBody.messages[1]?.content).toContain("BLOCK_001");
  });

  it("health() reports ok when the configured model is present in /api/tags", async () => {
    server = new MockOllamaServer({ models: ["qwen2.5:7b"] });
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OllamaNarrator({ baseUrl, model: "qwen2.5:7b", egress });

    const health = await narrator.health();
    expect(health.status).toBe("ok");
  });

  it("health() warns when the configured model is not pulled", async () => {
    server = new MockOllamaServer({ models: ["llama3.1:latest"] });
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OllamaNarrator({ baseUrl, model: "qwen2.5:7b", egress });

    const health = await narrator.health();
    expect(health.status).toBe("degraded");
    expect(health.detail).toContain("model not pulled");
  });

  it("health() reports unreachable when the server cannot be contacted", async () => {
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OllamaNarrator({ baseUrl: "http://127.0.0.1:1", model: "qwen2.5:7b", egress });

    const health = await narrator.health();
    expect(health.status).toBe("unreachable");
  });

  it("transform() degrades with a faithful fallback when the server fails (500)", async () => {
    server = new MockOllamaServer({ fail500: true });
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OllamaNarrator({ baseUrl, model: "qwen2.5:7b", egress });

    const request = baseRequest();
    const result = await narrator.transform(request);

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("provider-unavailable");
    expect(result.segments).toHaveLength(request.segments.length);
    expect(result.segments[0]?.id).toBe(`faithful-${request.segments[0]?.id}`);
  });

  it("transform() degrades with reason cancelled when the caller aborts", async () => {
    server = new MockOllamaServer({ chatDelayMs: 200 });
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OllamaNarrator({ baseUrl, model: "qwen2.5:7b", egress });

    const controller = new AbortController();
    const request = baseRequest();
    const pending = narrator.transform(request, controller.signal);
    controller.abort();

    const result = await pending;
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("cancelled");
  });

  it("transform() degrades with reason timeout when the model exceeds timeoutMs", async () => {
    server = new MockOllamaServer({ chatDelayMs: 300 });
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OllamaNarrator({ baseUrl, model: "qwen2.5:7b", egress });

    const request = baseRequest({ timeoutMs: 30 });
    const result = await narrator.transform(request);

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("timeout");
  });

  it("transform() degrades instead of reaching a remote host when localOnly is enforced (ADR-010)", async () => {
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    // Not loopback: rejected lexically by EgressGuard before any DNS lookup or socket.
    const narrator = new OllamaNarrator({ baseUrl: "http://example.com:11434", model: "qwen2.5:7b", egress });

    const result = await narrator.transform(baseRequest());

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("provider-unavailable");
  });

  it("getCapabilities() reports structured-output support", async () => {
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OllamaNarrator({ baseUrl: "http://127.0.0.1:11434", model: "qwen2.5:7b", egress });
    await expect(narrator.getCapabilities()).resolves.toEqual({ structuredOutput: true });
  });
});
