import { afterEach, describe, expect, it } from "vitest";
import { createEgressGuard } from "../../../src/net/EgressGuard.js";
import { KokoroProvider, KOKORO_DEFAULT_FR_VOICE } from "../../../src/tts/KokoroProvider.js";
import { MockTtsServer } from "../../fakes/mockTtsServer.js";

function egress() {
  return createEgressGuard({ mode: "local", trustedHosts: [], strictLocal: false });
}

describe("KokoroProvider (ADR-009 niveau 1, CdC §27-28)", () => {
  let server: MockTtsServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("defaults to ff_siwis for French when no voice is requested", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const provider = new KokoroProvider({ baseUrl, egress: egress() });

    await provider.synthesize({ text: "Bonjour", language: "fr" });

    const body = JSON.parse(server.requests[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body["voice"]).toBe(KOKORO_DEFAULT_FR_VOICE);
  });

  it("never overrides an explicit voice", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const provider = new KokoroProvider({ baseUrl, egress: egress() });

    await provider.synthesize({ text: "Hello", language: "en", voice: "af_bella" });

    const body = JSON.parse(server.requests[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body["voice"]).toBe("af_bella");
  });

  it("forwards speed", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const provider = new KokoroProvider({ baseUrl, egress: egress() });

    await provider.synthesize({ text: "Bonjour", speed: 1.3 });

    const body = JSON.parse(server.requests[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body["speed"]).toBe(1.3);
  });

  it("getCapabilities() advertises the speed parameter", async () => {
    server = new MockTtsServer();
    const baseUrl = await server.listen();
    const provider = new KokoroProvider({ baseUrl, egress: egress() });

    const capabilities = await provider.getCapabilities();
    expect(capabilities.parameters.map((param) => param.name)).toEqual(["speed"]);
  });

  it("id defaults to \"kokoro\"", () => {
    const provider = new KokoroProvider({ baseUrl: "http://127.0.0.1:8880", egress: egress() });
    expect(provider.id).toBe("kokoro");
  });
});
