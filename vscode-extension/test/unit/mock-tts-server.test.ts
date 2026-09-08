import { afterEach, describe, expect, it } from "vitest";
import { MockTtsServer } from "../fakes/mockTtsServer.js";
import { readWavHeader } from "../fakes/wav.js";

describe("MockTtsServer (smoke)", () => {
  let server: MockTtsServer;
  let baseUrl: string;

  afterEach(async () => {
    await server.close();
  });

  it("GET /health returns ok", async () => {
    server = new MockTtsServer();
    baseUrl = await server.listen();

    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("GET /v1/audio/voices returns a voice list", async () => {
    server = new MockTtsServer();
    baseUrl = await server.listen();

    const response = await fetch(`${baseUrl}/v1/audio/voices`);
    const body = (await response.json()) as { voices: unknown[] };
    expect(response.status).toBe(200);
    expect(Array.isArray(body.voices)).toBe(true);
    expect(body.voices.length).toBeGreaterThan(0);
  });

  it("POST /v1/audio/speech returns a valid WAV buffer", async () => {
    server = new MockTtsServer();
    baseUrl = await server.listen();

    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Bonjour" })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");

    const wav = Buffer.from(await response.arrayBuffer());
    const header = readWavHeader(wav);
    expect(header.dataSize).toBeGreaterThan(0);
  });

  it("returns 500 when fail500 is set", async () => {
    server = new MockTtsServer({ fail500: true });
    baseUrl = await server.listen();

    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      body: JSON.stringify({ text: "test" })
    });
    expect(response.status).toBe(500);
  });

  it("redirects to an external host when redirectExternal is set", async () => {
    server = new MockTtsServer({ redirectExternal: true });
    baseUrl = await server.listen();

    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      redirect: "manual",
      body: JSON.stringify({ text: "test" })
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/v1/audio/speech");
  });
});
