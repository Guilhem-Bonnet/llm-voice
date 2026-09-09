/**
 * Invariant: `src/claude/**` and `src/inbox/**` (captured-agent-output
 * sources, S5.1) must never drive playback directly — starting a session
 * always goes through a command the user triggered (CdC §9's "always
 * user-initiated", ADR-001, ADR-003's "zero autoplay"). A static grep, not a
 * runtime assertion, so it fails the moment such an import lands rather than
 * depending on the feature being exercised.
 *
 * `src/claude/**` (S5.1: `InboxRepository`, `InboxWatcher`,
 * `ClaudeInboxSource`, the Quick Pick/Tree View, the hook installer) is
 * real, importable code as of this story; `src/inbox` still does not exist.
 * Both cases must produce zero offenders either way — the second `it` below
 * is what actually proves the invariant and never gets skipped.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "../../../src");
const FORBIDDEN_DIRS = ["claude", "inbox"];

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("invariant: zero autoplay from src/claude or src/inbox", () => {
  it("src/claude exists (S5.1); src/inbox still does not — both are fine, grepped below", () => {
    expect(existsSync(resolve(SRC_ROOT, "claude"))).toBe(true);
    expect(existsSync(resolve(SRC_ROOT, "inbox"))).toBe(false);
  });

  it("never imports PlaybackController or calls .start(", () => {
    const offenders: string[] = [];
    for (const dirName of FORBIDDEN_DIRS) {
      for (const file of listTsFiles(resolve(SRC_ROOT, dirName))) {
        const content = readFileSync(file, "utf8");
        if (/PlaybackController/.test(content) || /\.start\s*\(/.test(content)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
