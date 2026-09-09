import { describe, expect, it } from "vitest";
import { resolveDefaultProfileId, type BySourceSetting } from "../../../src/profiles/bySource.js";

describe("resolveDefaultProfileId (CdC §47)", () => {
  it("prefers an explicit bySource default for the captured source", () => {
    const bySource: BySourceSetting = { markdown: "faithful-local" };
    expect(resolveDefaultProfileId("markdown", bySource, "llm-summary", "faithful-local")).toBe(
      "faithful-local"
    );
  });

  it("falls back to the last selected profile when bySource has no entry for the source", () => {
    const bySource: BySourceSetting = { markdown: "faithful-local" };
    expect(resolveDefaultProfileId("clipboard", bySource, "llm-summary", "faithful-local")).toBe(
      "llm-summary"
    );
  });

  it("falls back to the collection default when neither bySource nor lastSelectedId apply", () => {
    expect(resolveDefaultProfileId("clipboard", undefined, undefined, "faithful-local")).toBe(
      "faithful-local"
    );
  });

  it("ignores bySource entirely when the source type is unknown", () => {
    const bySource: BySourceSetting = { markdown: "faithful-local" };
    expect(resolveDefaultProfileId(undefined, bySource, "llm-summary", "faithful-local")).toBe(
      "llm-summary"
    );
  });

  it("resolves the claude-code key (CdC §47's Claude Inbox example)", () => {
    const bySource: BySourceSetting = { "claude-code": "llm-summary" };
    expect(resolveDefaultProfileId("claude-code", bySource, undefined, "faithful-local")).toBe(
      "llm-summary"
    );
  });
});
