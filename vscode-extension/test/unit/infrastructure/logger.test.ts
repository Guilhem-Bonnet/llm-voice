import { describe, expect, it } from "vitest";
import { Logger, MAX_REDACTED_FIELD_LENGTH, parseLogLevel, redact, type LogSink } from "../../../src/infrastructure/logger.js";

describe("redact (CdC §81, AC-SEC-07)", () => {
  it("never lets a 5000-character document through in full, whatever the key", () => {
    const document = "x".repeat(5000);
    const result = redact({ content: document });
    const value = result.content as string;
    expect(value.length).toBeLessThan(200);
    expect(value).not.toContain("x".repeat(5000));
  });

  it("drops text/spokenText/message/prompt entirely rather than truncate them", () => {
    const document = "y".repeat(5000);
    const result = redact({ text: document, spokenText: document, message: document, prompt: document });
    expect(result).toEqual({});
  });

  it("drops an API key regardless of casing or field name", () => {
    const result = redact({ apiKey: "sk-abcdefghijklmnopqrstuvwxyz", Authorization: "Bearer sk-secret" });
    expect(result.apiKey).toBeUndefined();
    expect(result.Authorization).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("sk-");
  });

  it("truncates a long string field longer than MAX_REDACTED_FIELD_LENGTH", () => {
    const value = "a".repeat(MAX_REDACTED_FIELD_LENGTH + 50);
    const result = redact({ detail: value });
    expect((result.detail as string).length).toBeLessThan(value.length);
    expect(result.detail as string).toContain("truncated");
  });

  it("leaves a short, harmless field untouched", () => {
    expect(redact({ chunkId: "c1", index: 3 })).toEqual({ chunkId: "c1", index: 3 });
  });

  it("redacts nested objects and arrays at any depth", () => {
    const result = redact({
      nested: { apiKey: "sk-nested", ok: "fine" },
      items: [{ text: "y".repeat(500) }, "plain"]
    });
    expect(result.nested).toEqual({ ok: "fine" });
    expect(result.items).toEqual([{}, "plain"]);
  });

  it("reduces an Error to its (possibly truncated) message", () => {
    const result = redact({ error: new Error("boom") });
    expect(result.error).toBe("boom");
  });

  it("never throws on a value it cannot introspect", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => redact({ cyclic })).not.toThrow();
  });
});

describe("parseLogLevel", () => {
  it("accepts the four known levels", () => {
    expect(parseLogLevel("error")).toBe("error");
    expect(parseLogLevel("warn")).toBe("warn");
    expect(parseLogLevel("info")).toBe("info");
    expect(parseLogLevel("debug")).toBe("debug");
  });

  it("defaults to info for anything else", () => {
    expect(parseLogLevel(undefined)).toBe("info");
    expect(parseLogLevel("verbose")).toBe("info");
    expect(parseLogLevel(42)).toBe("info");
  });
});

class RecordingSink implements LogSink {
  lines: string[] = [];
  appendLine(value: string): void {
    this.lines.push(value);
  }
}

describe("Logger", () => {
  it("filters out a level more verbose than the configured one", () => {
    const sink = new RecordingSink();
    const logger = new Logger(sink, "warn");
    logger.debug("should not appear");
    logger.info("should not appear either");
    logger.warn("should appear");
    logger.error("should appear too");
    expect(sink.lines).toHaveLength(2);
    expect(sink.lines[0]).toContain("should appear");
    expect(sink.lines[1]).toContain("should appear too");
  });

  it("setLevel changes the filter at runtime", () => {
    const sink = new RecordingSink();
    const logger = new Logger(sink, "error");
    logger.debug("hidden");
    expect(sink.lines).toHaveLength(0);
    logger.setLevel("debug");
    logger.debug("visible");
    expect(sink.lines).toHaveLength(1);
  });

  it("never lets a 5000-character document appear in full in an appendLine sink, even at debug", () => {
    const sink = new RecordingSink();
    const logger = new Logger(sink, "debug");
    const document = "z".repeat(5000);
    logger.debug("captured document", { content: document });
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).not.toContain("z".repeat(5000));
    expect(sink.lines[0]!.length).toBeLessThan(500);
  });

  it("never lets an API key appear, even at debug", () => {
    const sink = new RecordingSink();
    const logger = new Logger(sink, "debug");
    logger.debug("tts request", { apiKey: "sk-should-never-appear" });
    expect(sink.lines.join("\n")).not.toContain("sk-should-never-appear");
  });

  it("prefers native leveled methods when the sink exposes them (LogOutputChannel)", () => {
    const calls: Array<[string, string]> = [];
    const sink: LogSink = {
      appendLine: () => calls.push(["appendLine", "unexpected"]),
      error: (m) => calls.push(["error", m]),
      warn: (m) => calls.push(["warn", m]),
      info: (m) => calls.push(["info", m]),
      debug: (m) => calls.push(["debug", m])
    };
    const logger = new Logger(sink, "debug");
    logger.info("hello");
    expect(calls).toEqual([["info", "hello"]]);
  });

  // AC-SEC-07/08 (S5.2 unification): trackSecret + core/redact.ts's
  // redactSecrets catch a known secret value even in a free-text message
  // or an unlisted meta field, on top of redact()'s field-name dropping.
  it("trackSecret redacts a known secret value out of a free-text message", () => {
    const sink = new RecordingSink();
    const logger = new Logger(sink, "info");
    logger.trackSecret("sk-tracked-secret");
    logger.error(`request failed: Authorization: Bearer sk-tracked-secret`);
    expect(sink.lines.join("\n")).not.toContain("sk-tracked-secret");
    expect(sink.lines[0]).toContain("[REDACTED]");
  });

  it("trackSecret redacts a known secret value out of an unlisted meta field", () => {
    const sink = new RecordingSink();
    const logger = new Logger(sink, "info");
    logger.trackSecret("sk-tracked-secret");
    logger.info("provider health", { detail: "sk-tracked-secret rejected" });
    expect(sink.lines.join("\n")).not.toContain("sk-tracked-secret");
  });

  it("an empty string tracked as a secret never redacts unrelated log lines", () => {
    const sink = new RecordingSink();
    const logger = new Logger(sink, "info");
    logger.trackSecret("");
    logger.info("hello world");
    expect(sink.lines).toEqual(["[info] hello world"]);
  });
});
