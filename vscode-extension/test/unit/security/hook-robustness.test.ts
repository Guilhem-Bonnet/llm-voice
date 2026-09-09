/**
 * S6.1 — Attack tests, axis 5: the Claude Code hook (AC-SEC-06, ADR-003).
 *
 * Two contracts, both about *not breaking someone else's tooling*:
 *
 *  - the installer edits a file that belongs to the user and to whatever
 *    other tools write hooks there. It must survive every shape they may
 *    have left in `hooks.Stop`, must never destroy content it did not
 *    understand, and must be exactly reversible.
 *  - the collector runs inside a Claude Code session. Whatever happens, it
 *    exits 0 — a non-zero exit surfaces as a hook failure to the user.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { addHookEntry, containsHookEntry, removeHookEntry } from "../../../src/claude/hookEntry.js";
import { writeHookInstalled, writeHookUninstalled } from "../../../src/claude/hookInstallerIO.js";

const collector = resolve(__dirname, "../../../../integrations/claude-code/plugin/scripts/llm-voice-capture.js");
const COMMAND = "node /opt/llm-voice/scripts/llm-voice-capture.js";

/** A third-party hook nobody but its owner may touch. */
const THIRD_PARTY = {
  matcher: "*",
  hooks: [{ type: "command", command: "npx some-other-tool --on-stop", timeout: 30 }]
};

describe("AC-SEC-06 — hookEntry against malformed third-party settings", () => {
  const MALFORMED: readonly [string, unknown][] = [
    ["a Stop group with no hooks key", { hooks: { Stop: [{ matcher: "*" }] } }],
    ["a null group", { hooks: { Stop: [null] } }],
    ["a group that is a string", { hooks: { Stop: ["oops"] } }],
    ["hooks that is not an array", { hooks: { Stop: [{ hooks: { nope: true } }] } }],
    ["a null hook entry", { hooks: { Stop: [{ hooks: [null] }] } }],
    ["a hook entry that is a number", { hooks: { Stop: [{ hooks: [42] }] } }],
    ["a hook with no command", { hooks: { Stop: [{ hooks: [{ type: "command" }] }] } }],
    ["Stop that is not an array", { hooks: { Stop: { nope: true } }, other: 1 }],
    ["hooks that is not an object", { hooks: "nope" }],
    ["a deeply nested null", { hooks: { Stop: [{ hooks: [null, THIRD_PARTY.hooks[0]] }] } }]
  ];

  it.each(MALFORMED)("addHookEntry survives %s and still installs", (_label, json) => {
    expect(() => addHookEntry(json, COMMAND)).not.toThrow();
    const next = addHookEntry(json, COMMAND);
    expect(containsHookEntry(next)).toBe(true);
  });

  it.each(MALFORMED)("containsHookEntry survives %s", (_label, json) => {
    expect(() => containsHookEntry(json)).not.toThrow();
  });

  it.each(MALFORMED)("removeHookEntry survives %s", (_label, json) => {
    expect(() => removeHookEntry(json)).not.toThrow();
    expect(containsHookEntry(removeHookEntry(addHookEntry(json, COMMAND)))).toBe(false);
  });

  it("never touches a third-party hook, install or uninstall", () => {
    const before = { hooks: { Stop: [THIRD_PARTY], PreToolUse: [THIRD_PARTY] }, env: { FOO: "bar" } };
    const installed = addHookEntry(before, COMMAND);

    expect(installed.hooks?.Stop).toContainEqual(THIRD_PARTY);
    expect(installed.hooks?.PreToolUse).toEqual([THIRD_PARTY]);
    expect(installed.env).toEqual({ FOO: "bar" });

    // Exactly reversible, down to a JSON diff.
    expect(removeHookEntry(installed)).toEqual(before);
  });

  it("is idempotent across two installs", () => {
    const once = addHookEntry({}, COMMAND);
    const twice = addHookEntry(once, COMMAND);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    expect(twice.hooks?.Stop).toHaveLength(1);
  });

  it("recognises our hook installed under a different absolute path", () => {
    const other = addHookEntry({}, "node /home/u/.vscode/extensions/llm-voice/llm-voice-capture.js");
    expect(addHookEntry(other, COMMAND).hooks?.Stop).toHaveLength(1);
  });

  it("removes our entry even when it shares a group with a third-party one", () => {
    const shared = {
      hooks: {
        Stop: [{ matcher: "*", hooks: [THIRD_PARTY.hooks[0], { type: "command", command: COMMAND }] }]
      }
    };
    const cleaned = removeHookEntry(shared);
    expect(containsHookEntry(cleaned)).toBe(false);
    expect(cleaned.hooks?.Stop?.[0]?.hooks).toEqual([THIRD_PARTY.hooks[0]]);
  });
});

describe("AC-SEC-06 — hookInstallerIO on a hostile file", () => {
  let dir: string;
  let settings: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "llm-voice-sec-hook-"));
    settings = join(dir, "settings.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a malformed settings.json instead of overwriting it", async () => {
    const original = '{ "hooks": { "Stop": [ }}} not json at all';
    writeFileSync(settings, original, "utf8");

    await expect(writeHookInstalled(settings, COMMAND)).rejects.toThrow();
    expect(readFileSync(settings, "utf8")).toBe(original);
  });

  it.each([
    ["an array", "[1, 2, 3]"],
    ["a bare string", '"hello"'],
    ["a number", "42"],
    ["null", "null"]
  ])("refuses valid JSON that is %s rather than replacing it", async (_label, original) => {
    writeFileSync(settings, original, "utf8");
    await expect(writeHookInstalled(settings, COMMAND)).rejects.toThrow(/objet JSON/);
    expect(readFileSync(settings, "utf8")).toBe(original);
  });

  it("installs, backs up, and uninstalls back to the exact original", async () => {
    const original = `${JSON.stringify({ hooks: { Stop: [THIRD_PARTY] }, model: "opus" }, null, 2)}\n`;
    writeFileSync(settings, original, "utf8");

    await writeHookInstalled(settings, COMMAND);
    expect(containsHookEntry(JSON.parse(readFileSync(settings, "utf8")))).toBe(true);
    expect(readFileSync(`${settings}.bak`, "utf8")).toBe(original);

    await writeHookUninstalled(settings);
    const after: unknown = JSON.parse(readFileSync(settings, "utf8"));
    expect(after).toEqual(JSON.parse(original));
  });

  it("writes settings and backup 0600", async () => {
    if (process.platform === "win32") {
      return;
    }
    writeFileSync(settings, JSON.stringify({ hooks: { Stop: [THIRD_PARTY] } }), "utf8");
    await writeHookInstalled(settings, COMMAND);
    expect(statSync(settings).mode & 0o777).toBe(0o600);
    expect(statSync(`${settings}.bak`).mode & 0o777).toBe(0o600);
  });

  it("a second install adds nothing and leaves the file valid", async () => {
    await writeHookInstalled(settings, COMMAND);
    const first = readFileSync(settings, "utf8");
    await writeHookInstalled(settings, COMMAND);
    expect(readFileSync(settings, "utf8")).toBe(first);
  });

  it("uninstall on a file that never had our hook is a no-op for the rest", async () => {
    const original = `${JSON.stringify({ hooks: { Stop: [THIRD_PARTY] } }, null, 2)}\n`;
    writeFileSync(settings, original, "utf8");
    await writeHookUninstalled(settings);
    expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual(JSON.parse(original));
  });
});

describe("ADR-003 — the collector never fails the Claude Code session", () => {
  let inboxDir: string;

  beforeEach(() => {
    inboxDir = mkdtempSync(join(tmpdir(), "llm-voice-sec-collector-"));
  });

  afterEach(() => {
    try {
      chmodSync(inboxDir, 0o700);
    } catch {
      // already gone
    }
    rmSync(inboxDir, { recursive: true, force: true });
  });

  function run(input: string, env: Record<string, string> = {}): { status: number; stderr: string } {
    const result = spawnSync("node", [collector], {
      input,
      env: { ...process.env, LLM_VOICE_INBOX: inboxDir, ...env },
      maxBuffer: 128 * 1024 * 1024
    });
    return { status: result.status ?? -1, stderr: result.stderr?.toString() ?? "" };
  }

  it("exits 0 on a 50 MB payload and caps what it writes", () => {
    const huge = "A".repeat(50 * 1024 * 1024);
    const { status } = run(JSON.stringify({ session_id: "s1", last_assistant_message: huge }));

    expect(status).toBe(0);
    const files = readdirSync(inboxDir);
    expect(files).toHaveLength(1);
    const written = statSync(join(inboxDir, files[0]!)).size;
    // Capped at 1 MiB plus the JSON envelope and the truncation notice.
    expect(written).toBeLessThan(2 * 1024 * 1024);
    const entry = JSON.parse(readFileSync(join(inboxDir, files[0]!), "utf8")) as { message: string };
    expect(entry.message).toContain("tronqué");
  }, 60_000);

  it.each([
    ["binary bytes", " �"],
    ["a lone surrogate", "avant \ud800 apres"],
    ["a BOM and control chars", "﻿[31mrouge[0m"],
    ["only whitespace", "   \n\t  "]
  ])("exits 0 on a %s last_assistant_message", (_label, message) => {
    const { status } = run(JSON.stringify({ session_id: "s1", last_assistant_message: message }));
    expect(status).toBe(0);
    // Whatever it wrote, it wrote valid JSON — the extension re-reads it.
    for (const file of readdirSync(inboxDir)) {
      expect(() => JSON.parse(readFileSync(join(inboxDir, file), "utf8"))).not.toThrow();
    }
  });

  it.each([
    ["not JSON at all", "<<<not json>>>"],
    ["a JSON array", "[1,2,3]"],
    ["a bare string", '"hello"'],
    ["empty stdin", ""],
    ["a deeply nested object", JSON.stringify({ a: { b: { c: { d: {} } } } })]
  ])("exits 0 on stdin that is %s", (_label, input) => {
    expect(run(input).status).toBe(0);
  });

  it("exits 0 when the inbox directory cannot be created (non-writable parent)", () => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      return; // POSIX permissions only, and root ignores them
    }
    const parent = join(inboxDir, "parent");
    mkdirSync(parent);
    chmodSync(parent, 0o500);

    const { status, stderr } = run(JSON.stringify({ session_id: "s1", last_assistant_message: "bonjour" }), {
      LLM_VOICE_INBOX: join(parent, "inbox")
    });

    expect(status).toBe(0);
    expect(stderr).toContain("failed to write inbox entry");
    chmodSync(parent, 0o700);
    expect(readdirSync(parent)).toHaveLength(0);
  });

  it("exits 0 and leaves no .tmp- file when the write itself fails", () => {
    // `/proc/sys/kernel` is the most portable stand-in for a full disk we
    // have without root: `mkdir -p` on it succeeds (it exists), `chmod`
    // fails silently, and the tmp write then fails — exactly the ENOSPC
    // shape, one step further in than the non-writable-parent case above.
    if (process.platform !== "linux") {
      return;
    }
    const { status, stderr } = run(JSON.stringify({ session_id: "s1", last_assistant_message: "bonjour" }), {
      LLM_VOICE_INBOX: "/proc/sys/kernel"
    });

    expect(status).toBe(0);
    expect(stderr).toContain("failed to write inbox entry");
    expect(readdirSync("/proc/sys/kernel").filter((name) => name.startsWith(".tmp-"))).toHaveLength(0);
  });

  it("exits 0 when the inbox path cannot be created at all", () => {
    const { status } = run(JSON.stringify({ session_id: "s1", last_assistant_message: "bonjour" }), {
      LLM_VOICE_INBOX: join(collector, "impossible", "inbox") // a path under a *file*
    });
    expect(status).toBe(0);
  });
});
