#!/usr/bin/env node
/**
 * Fake `llm-voice-core` binary for `CoreProcess` unit tests
 * (`test/unit/playback/core-process.test.ts`): publishes `core.json`
 * exactly like `crates/llm-voice-core/src/lock.rs::write_state` (same shape,
 * same directory resolution order) and answers `GET /health`, so
 * `CoreProcess.ensureRunning()` can be exercised end-to-end against a real
 * child process without building the Rust binary.
 *
 * Env vars honoured: `LLM_VOICE_CORE_TOKEN`, `LLM_VOICE_CACHE_DIR` (read but
 * unused — no real audio here), `LLM_VOICE_CORE_STATE_DIR`.
 * `FAKE_CORE_EXIT_CODE` (optional): exits immediately with this code instead
 * of starting a server (simulates `ALREADY_RUNNING_EXIT_CODE` or a crash).
 * `FAKE_CORE_CRASH_AFTER_MS` (optional): exits with code 1 after this delay,
 * once its state has already been published (simulates a mid-session crash).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const exitCode = process.env.FAKE_CORE_EXIT_CODE;
if (exitCode !== undefined) {
  process.exit(Number(exitCode));
}

const token = process.env.LLM_VOICE_CORE_TOKEN ?? "unset";
const stateDir = process.env.LLM_VOICE_CORE_STATE_DIR;
if (stateDir === undefined) {
  console.error("fakeCoreBinary: LLM_VOICE_CORE_STATE_DIR required");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ protocolVersion: "1.0", status: "ok", capabilities: { formats: ["wav"], engine: "cpal" } }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const statePath = path.join(stateDir, "core.json");
  fs.writeFileSync(
    statePath,
    JSON.stringify({ pid: process.pid, port, token, protocolVersion: "1.0" }),
    { mode: 0o600 }
  );

  const crashAfter = process.env.FAKE_CORE_CRASH_AFTER_MS;
  if (crashAfter !== undefined) {
    setTimeout(() => process.exit(1), Number(crashAfter));
  }
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
