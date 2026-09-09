import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cliPath = resolve(__dirname, "../../../../integrations/cli/llm-voice-inbox.js");

describe("llm-voice-inbox.js (ADR-007 open CLI)", () => {
  let inboxDir: string;

  beforeEach(() => {
    inboxDir = mkdtempSync(join(tmpdir(), "llm-voice-inbox-cli-"));
  });

  afterEach(() => {
    rmSync(inboxDir, { recursive: true, force: true });
  });

  it("writes a schema-compliant, 0600 entry from stdin", () => {
    execFileSync("node", [cliPath, "add", "--provider", "codex", "--cwd", "/tmp/project"], {
      input: "Résultat de la tâche.",
      env: { ...process.env, LLM_VOICE_INBOX: inboxDir }
    });

    const files = readdirSync(inboxDir);
    expect(files).toHaveLength(1);

    const written = JSON.parse(readFileSync(join(inboxDir, files[0]!), "utf8"));
    expect(written.schemaVersion).toBe(1);
    expect(written.provider).toBe("codex");
    expect(written.cwd).toBe("/tmp/project");
    expect(written.message).toBe("Résultat de la tâche.");
    expect(typeof written.capturedAt).toBe("number");

    const mode = statSync(join(inboxDir, files[0]!)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("requires --provider", () => {
    expect(() =>
      execFileSync("node", [cliPath, "add"], { input: "text", env: { ...process.env, LLM_VOICE_INBOX: inboxDir } })
    ).toThrow();
    expect(readdirSync(inboxDir)).toHaveLength(0);
  });

  it("writes nothing and exits 0 on empty stdin", () => {
    execFileSync("node", [cliPath, "add", "--provider", "gemini-cli"], {
      input: "   ",
      env: { ...process.env, LLM_VOICE_INBOX: inboxDir }
    });
    expect(readdirSync(inboxDir)).toHaveLength(0);
  });

  it("leaves no leftover .tmp-* files", () => {
    execFileSync("node", [cliPath, "add", "--provider", "codex"], {
      input: "abc",
      env: { ...process.env, LLM_VOICE_INBOX: inboxDir }
    });
    expect(readdirSync(inboxDir).some((name) => name.startsWith(".tmp-"))).toBe(false);
  });
});
