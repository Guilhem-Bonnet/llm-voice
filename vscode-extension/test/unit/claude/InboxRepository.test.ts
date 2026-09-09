import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InboxRepository } from "../../../src/claude/InboxRepository.js";
import { InMemoryReadStateStore } from "../../../src/claude/ReadStateStore.js";

function validMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    provider: "claude-code",
    sessionId: "session-1",
    capturedAt: Date.now(),
    cwd: "/home/user/project",
    message: "Résultat de la tâche.",
    ...overrides
  };
}

describe("InboxRepository", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "llm-voice-inbox-repo-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the inbox directory with mode 0700 on first scan", async () => {
    const repo = new InboxRepository({ directory: join(dir, "nested", "inbox") });
    await repo.list();
    const mode = statSync(join(dir, "nested", "inbox")).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it("lists valid entries sorted by capturedAt desc", async () => {
    writeFileSync(join(dir, "a.json"), JSON.stringify(validMessage({ sessionId: "a", capturedAt: 1000 })));
    writeFileSync(join(dir, "b.json"), JSON.stringify(validMessage({ sessionId: "b", capturedAt: 3000 })));
    writeFileSync(join(dir, "c.json"), JSON.stringify(validMessage({ sessionId: "c", capturedAt: 2000 })));

    const repo = new InboxRepository({ directory: dir });
    const entries = await repo.list();

    expect(entries.map((entry) => entry.message.sessionId)).toEqual(["b", "c", "a"]);
  });

  it("ignores .tmp-* files and non-.json files", async () => {
    writeFileSync(join(dir, ".tmp-partial.json"), JSON.stringify(validMessage()));
    writeFileSync(join(dir, "notes.txt"), "irrelevant");
    writeFileSync(join(dir, "valid.json"), JSON.stringify(validMessage()));

    const repo = new InboxRepository({ directory: dir });
    const entries = await repo.list();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.fileName).toBe("valid.json");
  });

  it("rejects invalid JSON without throwing, and reports a warning", async () => {
    writeFileSync(join(dir, "broken.json"), "{not valid json");
    const warnings: string[] = [];
    const repo = new InboxRepository({ directory: dir, onWarning: (r) => warnings.push(r.reason) });

    const result = await repo.scan();

    expect(result.entries).toEqual([]);
    expect(result.rejections).toEqual([{ fileName: "broken.json", reason: "invalid-json" }]);
    expect(warnings).toEqual(["invalid-json"]);
  });

  it("rejects an unknown schemaVersion", async () => {
    writeFileSync(join(dir, "future.json"), JSON.stringify(validMessage({ schemaVersion: 2 })));
    const repo = new InboxRepository({ directory: dir });

    const result = await repo.scan();

    expect(result.entries).toEqual([]);
    expect(result.rejections).toEqual([{ fileName: "future.json", reason: "unknown-schema-version" }]);
  });

  it("rejects a file missing a required field", async () => {
    writeFileSync(join(dir, "incomplete.json"), JSON.stringify({ schemaVersion: 1, provider: "claude-code" }));
    const repo = new InboxRepository({ directory: dir });

    const result = await repo.scan();

    expect(result.rejections).toEqual([{ fileName: "incomplete.json", reason: "missing-required-field" }]);
  });

  it("rejects a message that is empty after trimming", async () => {
    writeFileSync(join(dir, "empty.json"), JSON.stringify(validMessage({ message: "   " })));
    const repo = new InboxRepository({ directory: dir });

    const result = await repo.scan();

    expect(result.rejections).toEqual([{ fileName: "empty.json", reason: "empty-message" }]);
  });

  it("accepts an ISO-8601 capturedAt and normalises it to epoch ms", async () => {
    const iso = "2026-09-08T12:00:00.000Z";
    writeFileSync(join(dir, "iso.json"), JSON.stringify(validMessage({ capturedAt: iso })));
    const repo = new InboxRepository({ directory: dir });

    const entries = await repo.list();

    expect(entries[0]?.message.capturedAt).toBe(Date.parse(iso));
  });

  it("delete() removes the file", async () => {
    writeFileSync(join(dir, "gone.json"), JSON.stringify(validMessage()));
    const repo = new InboxRepository({ directory: dir });
    const [entry] = await repo.list();

    await repo.remove(entry!.id);

    expect(await repo.list()).toEqual([]);
  });

  it("archive() moves the file into inbox/archive/ and out of list()", async () => {
    writeFileSync(join(dir, "archived.json"), JSON.stringify(validMessage()));
    const repo = new InboxRepository({ directory: dir });
    const [entry] = await repo.list();

    await repo.archive(entry!.id);

    expect(await repo.list()).toEqual([]);
    const archivedPath = join(dir, "archive", "archived.json");
    expect(() => statSync(archivedPath)).not.toThrow();
  });

  it("markRead() flips read state via the injected ReadStateStore", async () => {
    writeFileSync(join(dir, "one.json"), JSON.stringify(validMessage()));
    const readState = new InMemoryReadStateStore();
    const repo = new InboxRepository({ directory: dir, readState });

    const [before] = await repo.list();
    expect(before?.read).toBe(false);

    await repo.markRead(before!.id, true);
    const [after] = await repo.list();
    expect(after?.read).toBe(true);
  });

  it("cleans up orphaned read-state keys for files that no longer exist", async () => {
    writeFileSync(join(dir, "one.json"), JSON.stringify(validMessage()));
    const readState = new InMemoryReadStateStore();
    const repo = new InboxRepository({ directory: dir, readState });
    const [entry] = await repo.list();
    await repo.markRead(entry!.id, true);

    await repo.remove(entry!.id);
    await repo.list();

    expect(readState.isRead(entry!.id)).toBe(false);
  });
});
