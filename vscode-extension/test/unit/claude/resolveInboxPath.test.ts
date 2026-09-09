import { describe, expect, it } from "vitest";
import { resolveInboxPath } from "../../../src/claude/resolveInboxPath.js";

describe("resolveInboxPath (ADR-004: réglage > env > défaut)", () => {
  it("uses the setting when present, even if the env var is also set", () => {
    const result = resolveInboxPath({
      settingValue: "/settings/inbox",
      env: { LLM_VOICE_INBOX: "/env/inbox" }
    });
    expect(result).toBe("/settings/inbox");
  });

  it("falls back to the env var when the setting is empty/unset", () => {
    expect(resolveInboxPath({ settingValue: "", env: { LLM_VOICE_INBOX: "/env/inbox" } })).toBe("/env/inbox");
    expect(resolveInboxPath({ env: { LLM_VOICE_INBOX: "/env/inbox" } })).toBe("/env/inbox");
  });

  it("falls back to ~/.llm-voice/inbox when neither is set", () => {
    const result = resolveInboxPath({ env: {}, homedir: () => "/home/tester" });
    expect(result).toBe("/home/tester/.llm-voice/inbox");
  });

  it("treats a whitespace-only setting/env value as unset", () => {
    const result = resolveInboxPath({ settingValue: "   ", env: { LLM_VOICE_INBOX: "  " }, homedir: () => "/home/tester" });
    expect(result).toBe("/home/tester/.llm-voice/inbox");
  });
});
