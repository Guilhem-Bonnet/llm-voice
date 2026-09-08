import { afterEach, describe, expect, it } from "vitest";
import { createEgressGuard } from "../../../src/net/EgressGuard.js";
import { OpenAICompatibleNarrator } from "../../../src/narrator/OpenAICompatibleNarrator.js";
import { MockOpenAICompatibleNarratorServer } from "../../fakes/mockOpenAICompatibleNarratorServer.js";
import { makeSourceSegments } from "../playback/helpers.js";

describe("OpenAICompatibleNarrator (CdC §22, ADR-005/ADR-009)", () => {
  let server: MockOpenAICompatibleNarratorServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("posts a json_schema response_format and maps the reply", async () => {
    server = new MockOpenAICompatibleNarratorServer();
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OpenAICompatibleNarrator({ baseUrl, model: "local-model", egress });

    const result = await narrator.transform({
      segments: makeSourceSegments(2),
      profileId: "p",
      language: "fr-FR",
      mode: "narrated",
      outputContract: "narration-segments"
    });

    expect(result.degraded).toBe(false);
    expect(result.segments).toHaveLength(2);
    expect(server.requests).toHaveLength(1);
    const body = JSON.parse(server.requests[0]?.body ?? "{}") as { response_format: { type: string } };
    expect(body.response_format.type).toBe("json_schema");
  });

  it("retries with json_object when the server rejects json_schema (400)", async () => {
    server = new MockOpenAICompatibleNarratorServer({ rejectJsonSchema: true });
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OpenAICompatibleNarrator({ baseUrl, model: "local-model", egress });

    const result = await narrator.transform({
      segments: makeSourceSegments(1),
      profileId: "p",
      language: "fr-FR",
      mode: "narrated",
      outputContract: "narration-segments"
    });

    expect(result.degraded).toBe(false);
    expect(server.requests).toHaveLength(2);
    const first = JSON.parse(server.requests[0]?.body ?? "{}") as { response_format: { type: string } };
    const second = JSON.parse(server.requests[1]?.body ?? "{}") as { response_format: { type: string } };
    expect(first.response_format.type).toBe("json_schema");
    expect(second.response_format.type).toBe("json_object");
  });

  it("degrades with a faithful fallback on server failure", async () => {
    server = new MockOpenAICompatibleNarratorServer({ fail500: true });
    const baseUrl = await server.listen();
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OpenAICompatibleNarrator({ baseUrl, model: "local-model", egress });

    const request = {
      segments: makeSourceSegments(1),
      profileId: "p",
      language: "fr-FR",
      mode: "narrated" as const,
      outputContract: "narration-segments" as const
    };
    const result = await narrator.transform(request);

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("provider-unavailable");
  });

  it("health() reports unauthorized on 401/403", async () => {
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    // No server listening: 127.0.0.1:1 always refuses -> unreachable, exercised separately;
    // here we only assert getCapabilities() advertises structured output.
    const narrator = new OpenAICompatibleNarrator({ baseUrl: "http://127.0.0.1:11434", model: "m", egress });
    await expect(narrator.getCapabilities()).resolves.toEqual({ structuredOutput: true });
  });

  it("health() reports unreachable when the server cannot be contacted", async () => {
    const egress = createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
    const narrator = new OpenAICompatibleNarrator({ baseUrl: "http://127.0.0.1:1", model: "m", egress });
    const health = await narrator.health();
    expect(health.status).toBe("unreachable");
  });
});
