/**
 * Invariant: `src/claude/**` and `src/inbox/**` (captured-agent-output
 * stories, not built yet) must never drive playback directly — starting a
 * session always goes through a command the user triggered (CdC §9's "always
 * user-initiated", ADR-001). A static grep, not a runtime assertion, so it
 * fails the moment such an import lands rather than depending on the feature
 * being exercised.
 *
 * `src/claude` and `src/inbox` do not exist as of S3.5: this test must still
 * pass, trivially, so it starts failing (not silently skips) the instant the
 * first file under either directory imports `PlaybackController` or calls a
 * `.start(`-shaped method.
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
  it("does not exist yet, and this test still passes (trivial, not skipped)", () => {
    for (const dirName of FORBIDDEN_DIRS) {
      expect(existsSync(resolve(SRC_ROOT, dirName))).toBe(false);
    }
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
