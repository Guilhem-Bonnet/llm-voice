#!/usr/bin/env node
"use strict";

/**
 * LLM Voice — Claude Code capture script.
 *
 * Reads a Claude Code `Stop` hook payload from stdin, extracts
 * `last_assistant_message`, and writes it as a JSON entry into the LLM
 * Voice inbox. Writes are atomic (tmp file + rename) with 0600 permissions.
 *
 * Contract: this script MUST NOT play any audio, MUST NOT throw an
 * uncaught exception, and MUST always exit 0 so it never blocks the
 * Claude Code session it is attached to. Failures are reported on stderr
 * only.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;
const PROVIDER = "claude-code";

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function resolveInboxDir() {
  const override = process.env.LLM_VOICE_INBOX;
  if (override && override.trim().length > 0) {
    return override;
  }
  return path.join(os.homedir(), ".llm-voice", "inbox");
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildEntry(payload) {
  const message =
    typeof payload?.last_assistant_message === "string"
      ? payload.last_assistant_message
      : typeof payload?.message === "string"
        ? payload.message
        : "";

  return {
    schemaVersion: SCHEMA_VERSION,
    provider: PROVIDER,
    sessionId: typeof payload?.session_id === "string" ? payload.session_id : null,
    capturedAt: new Date().toISOString(),
    cwd: typeof payload?.cwd === "string" ? payload.cwd : process.cwd(),
    title: null,
    message
  };
}

function writeAtomic(inboxDir, entry) {
  fs.mkdirSync(inboxDir, { recursive: true, mode: 0o700 });

  const filename = `${entry.capturedAt.replace(/[:.]/g, "-")}-${crypto.randomUUID()}.json`;
  const finalPath = path.join(inboxDir, filename);
  const tmpPath = `${finalPath}.tmp`;

  fs.writeFileSync(tmpPath, JSON.stringify(entry, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, finalPath);
  fs.chmodSync(finalPath, 0o600);

  return finalPath;
}

function main() {
  const raw = readStdin();
  const payload = safeParse(raw) ?? {};
  const entry = buildEntry(payload);

  if (entry.message.trim().length === 0) {
    process.stderr.write("llm-voice-capture: empty message, skipping inbox write\n");
    process.exit(0);
  }

  const inboxDir = resolveInboxDir();
  try {
    const writtenPath = writeAtomic(inboxDir, entry);
    process.stderr.write(`llm-voice-capture: wrote ${writtenPath}\n`);
  } catch (error) {
    process.stderr.write(`llm-voice-capture: failed to write inbox entry: ${error}\n`);
  }

  process.exit(0);
}

main();
