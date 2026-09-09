/**
 * S6.1 — Attack tests, axes 6 and 7: supply chain (AC-SEC-10) and
 * filesystem permissions (AC-SEC-09).
 *
 * The heavy artillery lives in `scripts/check-licenses.mjs` and
 * `scripts/check-vsix.mjs` (both need a network-installed tree / a built
 * bundle, so they are npm scripts, not tests). What is asserted here is
 * everything that can be checked from the repository alone, plus the
 * permission modes actually observed on disk after a real write.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InboxRepository } from "../../../src/claude/InboxRepository.js";

const root = resolve(__dirname, "../../..");
const repoRoot = resolve(root, "..");
const collector = resolve(repoRoot, "integrations/claude-code/plugin/scripts/llm-voice-capture.js");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
};

describe("AC-SEC-10 — supply chain", () => {
  it("has a committed lockfile", () => {
    expect(existsSync(resolve(root, "package-lock.json"))).toBe(true);
  });

  it("ships a small, auditable production dependency set", () => {
    const names = Object.keys(manifest.dependencies);
    // Not a style rule: every one of these ends up inside `dist/extension.js`
    // on the user's disk, so the list is a thing to keep short on purpose.
    expect(names.length).toBeLessThanOrEqual(10);
    expect(names).toEqual(
      expect.arrayContaining(["zod", "unified", "remark-parse", "remark-gfm", "remark-frontmatter"])
    );
  });

  it("depends on no telemetry/analytics package in production", () => {
    const pattern = /telemetry|analytics|sentry|segment|mixpanel|amplitude|posthog|datadog/i;
    for (const name of Object.keys(manifest.dependencies)) {
      expect(pattern.test(name)).toBe(false);
    }
  });

  it("exposes the two supply-chain gates as npm scripts", () => {
    expect(manifest.scripts["check:licenses"]).toBeDefined();
    expect(manifest.scripts["check:vsix"]).toBeDefined();
    expect(manifest.scripts["check:audit"]).toContain("--omit=dev");
  });

  it("has a .vscodeignore that covers every category the packager must drop", () => {
    const ignore = readFileSync(resolve(root, ".vscodeignore"), "utf8");
    for (const pattern of [
      "test/**",
      "src/**",
      "out/**",
      "**/*.map",
      "scripts/**",
      "node_modules/**",
      "coverage/**",
      "package-lock.json",
      ".env"
    ]) {
      expect(ignore).toContain(pattern);
    }
  });

  it("has no re-including negation in .vscodeignore", () => {
    // Caught for real during this audit: a `!**/*.d.ts` line un-ignored every
    // `.d.ts` *anywhere*, including the 130-odd TypeScript lib files inside
    // the downloaded `.vscode-test/` VS Code — all of which would have
    // shipped. A negation in an allow-by-default list is almost always a
    // hole; the packager ships nothing that needs one.
    const ignore = readFileSync(resolve(root, ".vscodeignore"), "utf8");
    const negations = ignore
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("!"));
    expect(negations).toEqual([]);
  });

  it("has no production dependency with a wildcard or git range", () => {
    for (const [name, range] of Object.entries(manifest.dependencies)) {
      expect(range, name).toMatch(/^[\^~]?\d+\.\d+\.\d+/);
    }
  });
});

describe("AC-SEC-09 — inbox permissions", () => {
  let inboxDir: string;

  beforeEach(() => {
    inboxDir = mkdtempSync(join(tmpdir(), "llm-voice-sec-perm-"));
  });

  afterEach(() => {
    rmSync(inboxDir, { recursive: true, force: true });
  });

  const posixOnly = process.platform === "win32" ? it.skip : it;

  posixOnly("the collector creates the directory 0700 and the entry 0600", () => {
    const target = join(inboxDir, "created-by-collector");
    execFileSync("node", [collector], {
      input: JSON.stringify({ session_id: "s1", last_assistant_message: "bonjour" }),
      env: { ...process.env, LLM_VOICE_INBOX: target }
    });

    expect(statSync(target).mode & 0o777).toBe(0o700);
    const files = readdirSync(target);
    expect(files).toHaveLength(1);
    expect(statSync(join(target, files[0]!)).mode & 0o777).toBe(0o600);
  });

  posixOnly("the collector tightens an inbox that was left too open", () => {
    // The umask of the environment Claude Code runs the hook under is not
    // ours to control (ADR-003), so the mode is re-asserted, not assumed.
    const target = join(inboxDir, "loose");
    execFileSync("node", [collector], {
      input: JSON.stringify({ session_id: "s1", last_assistant_message: "un" }),
      env: { ...process.env, LLM_VOICE_INBOX: target }
    });
    execFileSync("chmod", ["0755", target]);
    execFileSync("node", [collector], {
      input: JSON.stringify({ session_id: "s2", last_assistant_message: "deux" }),
      env: { ...process.env, LLM_VOICE_INBOX: target }
    });

    expect(statSync(target).mode & 0o777).toBe(0o700);
  });

  posixOnly("InboxRepository.ensureDirectory creates the inbox 0700", async () => {
    const target = join(inboxDir, "created-by-extension");
    await new InboxRepository({ directory: target }).ensureDirectory();
    expect(statSync(target).mode & 0o777).toBe(0o700);
  });

  posixOnly("the archive subdirectory is 0700 too", async () => {
    const repository = new InboxRepository({ directory: inboxDir });
    execFileSync("node", [collector], {
      input: JSON.stringify({ session_id: "arch", last_assistant_message: "à archiver" }),
      env: { ...process.env, LLM_VOICE_INBOX: inboxDir }
    });
    const entries = await repository.list();
    expect(entries).toHaveLength(1);

    await repository.archive(entries[0]!.id);
    expect(statSync(join(inboxDir, "archive")).mode & 0o777).toBe(0o700);
  });

  it("documents the Windows behaviour instead of failing silently", () => {
    // POSIX modes are a no-op on Windows. ADR-003 states it, the collector
    // swallows the `chmod` failure deliberately, and `SECURITY.md` tells the
    // user what protection actually remains (the user profile directory's
    // own ACL). This test pins that the claim is written down somewhere a
    // user reads — the alternative, a silent no-op nobody mentions, is the
    // finding (F-09 of the security review, accepted for 0.1).
    const security = readFileSync(resolve(repoRoot, "SECURITY.md"), "utf8");
    expect(security.toLowerCase()).toContain("windows");
    expect(security).toMatch(/0700|0600/);
  });
});
