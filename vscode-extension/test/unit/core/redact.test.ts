import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../../src/core/redact.js";

describe("redactSecrets (AC-SEC-07/08)", () => {
  it("replaces every occurrence of a known secret", () => {
    expect(redactSecrets("Authorization: Bearer sk-abc123 failed", ["sk-abc123"])).toBe(
      "Authorization: Bearer [REDACTED] failed"
    );
  });

  it("replaces multiple distinct secrets", () => {
    expect(redactSecrets("key1=sk-one key2=sk-two", ["sk-one", "sk-two"])).toBe(
      "key1=[REDACTED] key2=[REDACTED]"
    );
  });

  it("leaves the message untouched when no secret matches", () => {
    expect(redactSecrets("[egress] allow GET localhost /health", ["sk-abc123"])).toBe(
      "[egress] allow GET localhost /health"
    );
  });

  it("ignores empty secret values instead of redacting everything", () => {
    expect(redactSecrets("hello world", [""])).toBe("hello world");
  });

  it("handles an empty secret list as a no-op", () => {
    expect(redactSecrets("hello world", [])).toBe("hello world");
  });
});
