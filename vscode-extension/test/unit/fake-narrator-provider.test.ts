import { describe, expect, it } from "vitest";
import { FakeNarratorProvider } from "../fakes/FakeNarratorProvider.js";

describe("FakeNarratorProvider", () => {
  it("maps segments 1:1 and prefixes spokenText", async () => {
    const provider = new FakeNarratorProvider();
    const result = await provider.transform({
      segments: [
        { id: "BLOCK_001", text: "Bonjour" },
        { id: "BLOCK_002", text: "Le monde" }
      ]
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      spokenText: "[narrated] Bonjour",
      sourceSegmentIds: ["BLOCK_001"]
    });
    expect(result[1]).toMatchObject({
      spokenText: "[narrated] Le monde",
      sourceSegmentIds: ["BLOCK_002"]
    });
  });

  it("merges all segments into a single N:1 NarrationSegment when merge=true", async () => {
    const provider = new FakeNarratorProvider({ merge: true });
    const result = await provider.transform({
      segments: [
        { id: "BLOCK_001", text: "Un." },
        { id: "BLOCK_002", text: "Deux." },
        { id: "BLOCK_003", text: "Trois." }
      ]
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.sourceSegmentIds).toEqual(["BLOCK_001", "BLOCK_002", "BLOCK_003"]);
    expect(result[0]?.spokenText).toBe("[narrated] Un. Deux. Trois.");
  });

  it("throws once when invalidJsonOnce is set, then behaves normally", async () => {
    const provider = new FakeNarratorProvider({ invalidJsonOnce: true });
    const request = { segments: [{ id: "BLOCK_001", text: "Test" }] };

    await expect(provider.transform(request)).rejects.toThrow(SyntaxError);
    await expect(provider.transform(request)).resolves.toHaveLength(1);
  });

  it("respects AbortSignal", async () => {
    const provider = new FakeNarratorProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.transform({ segments: [{ id: "BLOCK_001", text: "Test" }] }, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("records requests in an internal journal", async () => {
    const provider = new FakeNarratorProvider();
    await provider.transform({ segments: [{ id: "BLOCK_001", text: "Un" }] });
    await provider.transform({ segments: [{ id: "BLOCK_002", text: "Deux" }] });

    expect(provider.requests).toHaveLength(2);
  });
});
