import { describe, expect, it } from "vitest";
import { blockLabel, buildBlockPrompt, parseNarration } from "../../../src/narrator/parseNarration.js";
import { makeSourceSegments } from "../playback/helpers.js";

describe("parseNarration (CdC §21)", () => {
  it("maps one narration segment per block (1:1)", () => {
    const group = makeSourceSegments(2);
    const raw = JSON.stringify({
      segments: [
        { sourceIds: [blockLabel(0)], spokenText: "Premier bloc." },
        { sourceIds: [blockLabel(1)], spokenText: "Second bloc." }
      ]
    });

    const { result, warnings } = parseNarration({ raw, group });

    expect(result.degraded).toBe(false);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.spokenText).toBe("Premier bloc.");
    expect(result.segments[0]?.sourceSegmentIds).toEqual(["src-0"]);
    expect(result.segments[1]?.sourceSegmentIds).toEqual(["src-1"]);
    expect(warnings).toHaveLength(0);
  });

  it("merges several blocks into one narration segment (N:1)", () => {
    const group = makeSourceSegments(3);
    const raw = JSON.stringify({
      segments: [{ sourceIds: [blockLabel(0), blockLabel(1), blockLabel(2)], spokenText: "Résumé des trois blocs." }]
    });

    const { result } = parseNarration({ raw, group });

    expect(result.degraded).toBe(false);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.sourceSegmentIds).toEqual(["src-0", "src-1", "src-2"]);
    expect(result.segments[0]?.sourceRanges).toHaveLength(3);
  });

  it("repairs JSON wrapped in prose, fenced code, and a trailing comma", () => {
    const group = makeSourceSegments(1);
    const raw =
      "Voici le résultat :\n```json\n" +
      `{"segments":[{"sourceIds":["${blockLabel(0)}"],"spokenText":"Texte réparé.",}]}` +
      "\n```\nMerci.";

    const { result } = parseNarration({ raw, group });

    expect(result.degraded).toBe(false);
    expect(result.segments[0]?.spokenText).toBe("Texte réparé.");
  });

  it("drops a segment whose every sourceId is unknown, with a warning, leaving other blocks narrated", () => {
    const group = makeSourceSegments(2);
    const raw = JSON.stringify({
      segments: [
        { sourceIds: [blockLabel(0)], spokenText: "Premier bloc narré." },
        { sourceIds: ["BLOCK_999"], spokenText: "Texte orphelin." }
      ]
    });

    const { result, warnings } = parseNarration({ raw, group });

    // The narrated segment survives; the orphaned one is dropped and its
    // block falls back to faithful reading instead of degrading the group.
    expect(result.degraded).toBe(false);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.spokenText).toBe("Premier bloc narré.");
    expect(result.segments[1]?.id).toBe("faithful-src-1");
    expect(warnings.some((w) => w.includes("unknown sourceId BLOCK_999"))).toBe(true);
    expect(warnings.some((w) => w.includes("dropped: no known sourceId"))).toBe(true);
  });

  it("degrades fully when the only returned segment's sourceIds are all unknown", () => {
    const group = makeSourceSegments(1);
    const raw = JSON.stringify({ segments: [{ sourceIds: ["BLOCK_999"], spokenText: "Texte orphelin." }] });

    const { result, warnings } = parseNarration({ raw, group });

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("invalid-structured-output");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.id).toBe("faithful-src-0");
    expect(warnings.some((w) => w.includes("unknown sourceId BLOCK_999"))).toBe(true);
  });

  it("falls back to faithful reading for a block not covered by any narration segment", () => {
    const group = makeSourceSegments(2);
    const raw = JSON.stringify({ segments: [{ sourceIds: [blockLabel(0)], spokenText: "Seulement le premier." }] });

    const { result, warnings } = parseNarration({ raw, group });

    expect(result.degraded).toBe(false);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[1]?.id).toBe("faithful-src-1");
    expect(result.segments[1]?.spokenText).toBe(group[1]?.rawText);
    expect(warnings.some((w) => w.includes("src-1"))).toBe(true);
  });

  it("degrades fully when the narrator output is not valid JSON at all", () => {
    const group = makeSourceSegments(2);

    const { result } = parseNarration({ raw: "ceci n'est pas du JSON", group });

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("invalid-structured-output");
    expect(result.segments).toHaveLength(2);
    expect(result.segments.every((segment) => segment.id.startsWith("faithful-"))).toBe(true);
  });

  it("degrades fully when parsed JSON does not match the narration-segments contract", () => {
    const group = makeSourceSegments(1);
    const raw = JSON.stringify({ notSegments: true });

    const { result } = parseNarration({ raw, group });

    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe("invalid-structured-output");
  });

  it("buildBlockPrompt formats each segment under its BLOCK_xxx label", () => {
    const group = makeSourceSegments(2);
    const prompt = buildBlockPrompt(group);
    expect(prompt).toContain("BLOCK_001\nBloc source 0.");
    expect(prompt).toContain("BLOCK_002\nBloc source 1.");
  });
});
