import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InboxWatcher } from "../../../src/claude/InboxWatcher.js";

function waitFor(predicate: () => boolean, timeoutMs = 4000, intervalMs = 20): Promise<void> {
  return new Promise((resolveWait, rejectWait) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (predicate()) {
        resolveWait();
        return;
      }
      if (Date.now() > deadline) {
        rejectWait(new Error("waitFor: condition not met before timeout"));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

describe("InboxWatcher", () => {
  let dir: string;
  let watcher: InboxWatcher | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "llm-voice-inbox-watch-"));
  });

  afterEach(() => {
    watcher?.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it("fires 'changed' when a new file is dropped in the directory", async () => {
    watcher = new InboxWatcher({ directory: dir, pollIntervalMs: 100, debounceMs: 10 });
    let changes = 0;
    watcher.onChange(() => {
      changes += 1;
    });
    watcher.start();

    writeFileSync(join(dir, "new.json"), "{}");

    await waitFor(() => changes > 0);
    expect(changes).toBeGreaterThan(0);
  });

  it("recovers via polling after the directory is removed and recreated", async () => {
    watcher = new InboxWatcher({ directory: dir, pollIntervalMs: 50, debounceMs: 10 });
    let changes = 0;
    watcher.onChange(() => {
      changes += 1;
    });
    watcher.start();
    await watcher.forcePoll();

    rmSync(dir, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 60));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "after-recreate.json"), "{}");

    await waitFor(() => changes > 0, 5000, 30);
    expect(changes).toBeGreaterThan(0);
  });

  it("dispose() stops emitting further changes", async () => {
    watcher = new InboxWatcher({ directory: dir, pollIntervalMs: 50, debounceMs: 10 });
    let changes = 0;
    watcher.onChange(() => {
      changes += 1;
    });
    watcher.start();
    watcher.dispose();

    writeFileSync(join(dir, "after-dispose.json"), "{}");
    await new Promise((r) => setTimeout(r, 150));

    expect(changes).toBe(0);
  });
});
