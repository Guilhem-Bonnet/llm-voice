import { describe, expect, it } from "vitest";
import type { NarrationRequest, SourceSegment } from "../../src/core/index.js";
import { FakeNarratorProvider } from "../fakes/FakeNarratorProvider.js";

function segment(id: string, rawText: string): SourceSegment {
  return { id, type: "sentence", rawText };
}

function request(segments: SourceSegment[]): NarrationRequest {
  return {
    segments,
    profileId: "test-profile",
    language: "fr-FR",
    mode: "narrated",
    outputContract: "narration-segments"
  };
}

describe("FakeNarratorProvider", () => {
  it("maps segments 1:1 and prefixes spokenText", async () => {
    const provider = new FakeNarratorProvider();
    const result = await provider.transform(request([segment("BLOCK_001", "Bonjour"), segment("BLOCK_002", "Le monde")]));

    expect(result.degraded).toBe(false);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({
      spokenText: "[narrated] Bonjour",
      sourceSegmentIds: ["BLOCK_001"]
    });
    expect(result.segments[1]).toMatchObject({
      spokenText: "[narrated] Le monde",
      sourceSegmentIds: ["BLOCK_002"]
    });
  });

  it("merges all segments into a single N:1 NarrationSegment when merge=true", async () => {
    const provider = new FakeNarratorProvider({ merge: true });
    const result = await provider.transform(
      request([segment("BLOCK_001", "Un."), segment("BLOCK_002", "Deux."), segment("BLOCK_003", "Trois.")])
    );

    expect(result.degraded).toBe(false);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.sourceSegmentIds).toEqual(["BLOCK_001", "BLOCK_002", "BLOCK_003"]);
    expect(result.segments[0]?.spokenText).toBe("[narrated] Un. Deux. Trois.");
  });

  it("resolves with a degraded, faithful result once when invalidJsonOnce is set, then behaves normally", async () => {
    const provider = new FakeNarratorProvider({ invalidJsonOnce: true });
    const req = request([segment("BLOCK_001", "Test")]);

    const first = await provider.transform(req);
    expect(first.degraded).toBe(true);
    expect(first.degradedReason).toBe("invalid-structured-output");
    // Faithful fallback: no narrator rewriting applied.
    expect(first.segments).toHaveLength(1);
    expect(first.segments[0]?.spokenText).toBe("Test");

    const second = await provider.transform(req);
    expect(second.degraded).toBe(false);
    expect(second.segments).toHaveLength(1);
    expect(second.segments[0]?.spokenText).toBe("[narrated] Test");
  });

  it("resolves with a degraded, faithful result rather than rejecting when the signal is already aborted", async () => {
    const provider = new FakeNarratorProvider();
    const controller = new AbortController();
    controller.abort();

    const result = await provider.transform(request([segment("BLOCK_001", "Test")]), controller.signal);

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("cancelled");
    expect(result.segments[0]?.spokenText).toBe("Test");
  });

  it("resolves with a degraded, faithful result when aborted during latency", async () => {
    const provider = new FakeNarratorProvider({ latencyMs: 200 });
    const controller = new AbortController();
    const pending = provider.transform(request([segment("BLOCK_001", "Test")]), controller.signal);

    setTimeout(() => controller.abort(), 10);

    const result = await pending;
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("cancelled");
  });

  it("records requests in an internal journal", async () => {
    const provider = new FakeNarratorProvider();
    await provider.transform(request([segment("BLOCK_001", "Un")]));
    await provider.transform(request([segment("BLOCK_002", "Deux")]));

    expect(provider.requests).toHaveLength(2);
  });
});
