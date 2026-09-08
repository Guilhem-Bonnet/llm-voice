import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateConcurrentStopPayloads } from "../fixtures/claude-stop/generate-concurrent.js";

const scriptPath = resolve(
  __dirname,
  "../../../integrations/claude-code/plugin/scripts/llm-voice-capture.js"
);

function runCapture(payload: string, inboxDir: string): Promise<void> {
  return new Promise((promiseResolve, promiseReject) => {
    const child = spawn("node", [scriptPath], {
      env: { ...process.env, LLM_VOICE_INBOX: inboxDir }
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", promiseReject);
    child.on("exit", (code) => {
      if (code === 0) {
        promiseResolve();
      } else {
        promiseReject(new Error(`llm-voice-capture.js exited with code ${code}: ${stderr}`));
      }
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}

describe("llm-voice-capture.js concurrency (10 parallel Stop hooks)", () => {
  let inboxDir: string;

  beforeEach(() => {
    inboxDir = mkdtempSync(join(tmpdir(), "llm-voice-inbox-concurrency-"));
  });

  afterEach(() => {
    rmSync(inboxDir, { recursive: true, force: true });
  });

  it("writes 10 distinct valid 0600 entries with no leftover .tmp files", async () => {
    const payloads = generateConcurrentStopPayloads(10);

    await Promise.all(payloads.map((payload) => runCapture(JSON.stringify(payload), inboxDir)));

    const entries = readdirSync(inboxDir);

    const tmpFiles = entries.filter((name) => name.endsWith(".tmp"));
    expect(tmpFiles).toEqual([]);

    const jsonFiles = entries.filter((name) => name.endsWith(".json"));
    expect(jsonFiles).toHaveLength(10);
    expect(new Set(jsonFiles).size).toBe(10);

    const sessionIds = new Set<string>();
    for (const name of jsonFiles) {
      const fullPath = join(inboxDir, name);
      const mode = statSync(fullPath).mode & 0o777;
      expect(mode).toBe(0o600);

      const content = JSON.parse(readFileSync(fullPath, "utf8"));
      expect(content.schemaVersion).toBe(1);
      expect(content.provider).toBe("claude-code");
      sessionIds.add(content.sessionId);
    }

    expect(sessionIds.size).toBe(10);
  }, 20000);
});
