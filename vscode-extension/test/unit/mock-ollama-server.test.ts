import { afterEach, describe, expect, it } from "vitest";
import { MockOllamaServer } from "../fakes/mockOllamaServer.js";

interface ChatResponse {
  message: { content: string };
}

interface StructuredSegments {
  segments: { sourceIds: string[]; spokenText: string }[];
}

describe("MockOllamaServer (smoke)", () => {
  let server: MockOllamaServer;

  afterEach(async () => {
    await server.close();
  });

  it("POST /api/chat maps BLOCK_xxx markers to structured segments", async () => {
    server = new MockOllamaServer();
    const baseUrl = await server.listen();

    const prompt = "BLOCK_001\nBonjour le monde\n\nBLOCK_002\nDeuxième bloc de texte";
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "llama3.1",
        messages: [{ role: "user", content: prompt }],
        format: { type: "object", properties: { segments: { type: "array" } } }
      })
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as ChatResponse;
    const parsed = JSON.parse(body.message.content) as StructuredSegments;

    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0]?.sourceIds).toEqual(["BLOCK_001"]);
    expect(parsed.segments[0]?.spokenText).toContain("Bonjour le monde");
    expect(parsed.segments[1]?.sourceIds).toEqual(["BLOCK_002"]);
  });

  it("returns 500 when fail500 is set", async () => {
    server = new MockOllamaServer({ fail500: true });
    const baseUrl = await server.listen();

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      body: JSON.stringify({ messages: [] })
    });
    expect(response.status).toBe(500);
  });

  it("redirects to an external host when redirectExternal is set", async () => {
    server = new MockOllamaServer({ redirectExternal: true });
    const baseUrl = await server.listen();

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      redirect: "manual",
      body: JSON.stringify({ messages: [] })
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/api/chat");
  });
});
