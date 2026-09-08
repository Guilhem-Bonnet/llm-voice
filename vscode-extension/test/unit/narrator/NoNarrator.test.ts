import { describe, expect, it, vi } from "vitest";
import { NoNarrator } from "../../../src/narrator/NoNarrator.js";
import { makeSourceSegments } from "../playback/helpers.js";

describe("NoNarrator (AC-09)", () => {
  it("maps segments 1:1 without issuing any request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const narrator = new NoNarrator();
    const group = makeSourceSegments(2);

    const result = await narrator.transform({
      segments: group,
      profileId: "p",
      language: "fr",
      mode: "narrated",
      outputContract: "narration-segments"
    });

    expect(result.degraded).toBe(false);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.spokenText).toBe(group[0]?.rawText);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("health() reports ok without any network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const narrator = new NoNarrator();
    const health = await narrator.health();
    expect(health.status).toBe("ok");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("getCapabilities() reports no structured output", async () => {
    const narrator = new NoNarrator();
    await expect(narrator.getCapabilities()).resolves.toEqual({ structuredOutput: false });
  });
});
