import { describe, expect, it } from "vitest";
import { readModesBySource, resolveDefaultProfileId, type BySourceConfiguration, type BySourceSetting } from "../../../src/profiles/bySource.js";

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

describe("readModesBySource (ADR-017 §2, V18)", () => {
  const DEFAULT = { "claude-code": "llm-summary" };

  function config(values: { modes?: BySourceSetting; legacy?: BySourceSetting }): BySourceConfiguration {
    return {
      get: <T>(section: string) =>
        (section === "modes.bySource" ? (values.modes ?? DEFAULT) : (values.legacy ?? DEFAULT)) as T,
      inspect: () => (values.modes !== undefined ? { globalValue: values.modes } : {})
    };
  }

  it("the new setting, explicit: it wins, even over an explicit old one", () => {
    expect(readModesBySource(config({ modes: { markdown: "new" }, legacy: { markdown: "old" } }))).toEqual({
      markdown: "new"
    });
  });

  it("only the old setting explicit: what the user last expressed is honoured", () => {
    expect(readModesBySource(config({ legacy: { "claude-code": "system-voice" } }))).toEqual({
      "claude-code": "system-voice"
    });
  });

  it("neither explicit: the shared default", () => {
    expect(readModesBySource(config({}))).toEqual(DEFAULT);
  });

  it("explicit at the workspace level counts too; a read that finds nothing is empty, not a throw", () => {
    const workspace: BySourceConfiguration = {
      get: <T>(section: string) => (section === "modes.bySource" ? ({ text: "w" } as T) : undefined),
      inspect: () => ({ workspaceValue: { text: "w" } })
    };
    expect(readModesBySource(workspace)).toEqual({ text: "w" });
    expect(readModesBySource({ get: () => undefined, inspect: () => undefined })).toEqual({});
  });
});
