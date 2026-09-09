/**
 * Invariant (S5.3, CdC §81): `console.*` never ships to production. Every
 * log line goes through `src/infrastructure/logger.ts`'s `Logger`, the only
 * file allowed to touch `console.` (it doesn't either, today — this test
 * would fail there too if it started, since `Logger` writes to the injected
 * `LogSink`, never `console`). A static grep, not a runtime assertion, so it
 * fails the moment a stray `console.log` lands rather than depending on the
 * call actually being exercised by a test.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "../../../src");
const ALLOWED_FILE = resolve(SRC_ROOT, "infrastructure/logger.ts");

function listTsFiles(dir: string): string[] {
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

describe("invariant: no console.* under src/ outside src/infrastructure/logger.ts", () => {
  it("finds no console. call anywhere else", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(SRC_ROOT)) {
      if (file === ALLOWED_FILE) {
        continue;
      }
      const content = readFileSync(file, "utf8");
      if (/console\./.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the allowed file itself does not actually use console. either", () => {
    const content = readFileSync(ALLOWED_FILE, "utf8");
    expect(/console\./.test(content)).toBe(false);
  });
});
