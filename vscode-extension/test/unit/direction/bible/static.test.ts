/** The bible store is testable in plain Node and reaches nothing but the disk (ADR-015 §11, §10 invariants). */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(__dirname, "../../../../src/direction/bible");
const FILES = readdirSync(DIR).filter((name) => name.endsWith(".ts"));

describe("src/direction/bible static rules", () => {
  it("has the modules the design names", () => {
    expect(FILES.sort()).toEqual(["BibleStore.ts", "events.ts", "index.ts", "journal.ts", "merge.ts", "reducer.ts", "scopes.ts"]);
  });

  it.each(FILES)("%s imports no `vscode`, does no network I/O and never compares on a genre", (name) => {
    const source = readFileSync(join(DIR, name), "utf8");
    expect(source).not.toMatch(/from\s+["']vscode["']/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/node:(http|https|net|child_process)/);
    expect(source).not.toMatch(/(===|!==|==|!=)\s*["'](roman|novel|documentation|doc|ai-reply)["']/i);
  });
});
