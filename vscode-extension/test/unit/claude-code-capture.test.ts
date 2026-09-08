import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const scriptPath = resolve(
  __dirname,
  "../../../integrations/claude-code/plugin/scripts/llm-voice-capture.js"
);
const fixturePath = resolve(__dirname, "../fixtures/claude-code/stop-payload.json");

describe("llm-voice-capture.js", () => {
  let inboxDir: string;

  beforeEach(() => {
    inboxDir = mkdtempSync(join(tmpdir(), "llm-voice-inbox-"));
  });

  afterEach(() => {
    rmSync(inboxDir, { recursive: true, force: true });
  });

  it("writes a 0600 JSON entry into the inbox from a Stop payload fixture", () => {
    const payload = readFileSync(fixturePath, "utf8");

    execFileSync("node", [scriptPath], {
      input: payload,
      env: { ...process.env, LLM_VOICE_INBOX: inboxDir }
    });

    const entries = readdirSync(inboxDir);
    expect(entries).toHaveLength(1);

    const entryPath = join(inboxDir, entries[0]!);
    const written = JSON.parse(readFileSync(entryPath, "utf8"));

    expect(written.schemaVersion).toBe(1);
    expect(written.provider).toBe("claude-code");
    expect(written.sessionId).toBe("test-session-0001");
    expect(written.message).toBe("Voici le résumé de la tâche effectuée.");

    const mode = statSync(entryPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("exits 0 and skips the write when the message is empty", () => {
    expect(() =>
      execFileSync("node", [scriptPath], {
        input: JSON.stringify({ last_assistant_message: "  " }),
        env: { ...process.env, LLM_VOICE_INBOX: inboxDir }
      })
    ).not.toThrow();

    expect(readdirSync(inboxDir)).toHaveLength(0);
  });

  it("never throws even on invalid JSON input", () => {
    expect(() =>
      execFileSync("node", [scriptPath], {
        input: "{not valid json",
        env: { ...process.env, LLM_VOICE_INBOX: inboxDir }
      })
    ).not.toThrow();
  });
});
