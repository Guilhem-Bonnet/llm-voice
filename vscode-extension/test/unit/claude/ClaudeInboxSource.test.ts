import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeInboxSource, inboxEntrySummary, inboxEntryTitle } from "../../../src/claude/ClaudeInboxSource.js";
import { InboxRepository } from "../../../src/claude/InboxRepository.js";
import type { InboxEntry } from "../../../src/core/inbox.js";

function entry(overrides: Partial<InboxEntry["message"]> = {}): InboxEntry {
  return {
    id: "entry-1",
    fileName: "entry-1.json",
    read: false,
    archived: false,
    bytes: 10,
    modifiedAt: Date.now(),
    message: {
      schemaVersion: 1,
      provider: "claude-code",
      sessionId: "s1",
      capturedAt: Date.now(),
      cwd: "/home/user/backend-api",
      message: "Ligne un.\nLigne deux.",
      ...overrides
    }
  };
}

describe("inboxEntrySummary / inboxEntryTitle", () => {
  it("summary is 'provider • basename(cwd)'", () => {
    expect(inboxEntrySummary(entry())).toBe("claude-code • backend-api");
  });

  it("summary omits the cwd part when cwd is absent", () => {
    const withoutCwd = entry();
    delete (withoutCwd.message as { cwd?: string }).cwd;
    expect(inboxEntrySummary(withoutCwd)).toBe("claude-code");
  });

  it("title appends the first line of the message", () => {
    expect(inboxEntryTitle(entry())).toBe("claude-code • backend-api — Ligne un.");
  });
});

describe("ClaudeInboxSource", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "llm-voice-inbox-source-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("canCapture only accepts scope 'inbox-message' with an id", () => {
    const source = new ClaudeInboxSource(new InboxRepository({ directory: dir }));
    expect(source.canCapture({ scope: "inbox-message", inboxMessageId: "x" })).toBe(true);
    expect(source.canCapture({ scope: "inbox-message" })).toBe(false);
    expect(source.canCapture({ scope: "document" })).toBe(false);
  });

  it("capture() turns a matching inbox entry into a SourceDocument", async () => {
    writeFileSync(
      join(dir, "msg.json"),
      JSON.stringify({
        schemaVersion: 1,
        provider: "claude-code",
        sessionId: "sess-1",
        capturedAt: 1000,
        cwd: "/home/user/backend-api",
        message: "Refactoring terminé.\nLes tests passent."
      })
    );
    const repository = new InboxRepository({ directory: dir });
    const [scanned] = await repository.list();
    const source = new ClaudeInboxSource(repository);

    const doc = await source.capture({ scope: "inbox-message", inboxMessageId: scanned!.id });

    expect(doc.sourceType).toBe("claude-code");
    expect(doc.rawText).toBe("Refactoring terminé.\nLes tests passent.");
    expect(doc.title).toBe("claude-code • backend-api — Refactoring terminé.");
    expect(doc.metadata?.provider).toBe("claude-code");
  });

  it("capture() throws (never invents content) when the entry no longer exists", async () => {
    const repository = new InboxRepository({ directory: dir });
    const source = new ClaudeInboxSource(repository);

    await expect(source.capture({ scope: "inbox-message", inboxMessageId: "missing" })).rejects.toThrow();
  });
});
