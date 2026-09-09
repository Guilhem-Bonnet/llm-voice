#!/usr/bin/env node
"use strict";

/**
 * LLM Voice — open inbox CLI (ADR-007). No dependency, cross-platform Node.
 *
 * Usage:
 *   llm-voice-inbox add --provider <name> [--title <title>] [--cwd <dir>] [--session-id <id>]
 *   … | node llm-voice-inbox.js add --provider codex
 *
 * Reads the captured text from stdin and writes it into the LLM Voice
 * inbox (`~/.llm-voice/inbox/`, or `$LLM_VOICE_INBOX`), atomically (tmp
 * file + rename), `0600`. Deliberately self-contained rather than
 * `require()`-ing the Claude Code plugin's collector script: the two are
 * distributed independently (a `claude plugin install` may copy only
 * `integrations/claude-code/plugin/`), so neither may depend on a file
 * outside its own directory — see the note in `llm-voice-capture.js`. The
 * write algorithm and JSON shape are identical (ADR-003's schema), kept in
 * sync by `test/unit/claude/*` exercising both.
 *
 * Exits non-zero and prints usage on a malformed invocation; exits 0 with a
 * stderr note if stdin is empty (nothing written).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;
const TMP_PREFIX = ".tmp-";

function resolveInboxDir() {
  const override = process.env.LLM_VOICE_INBOX;
  if (typeof override === "string" && override.trim().length > 0) {
    return override;
  }
  return path.join(os.homedir(), ".llm-voice", "inbox");
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function buildEntry({ provider, sessionId, cwd, title, message }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    provider,
    sessionId: typeof sessionId === "string" && sessionId.length > 0 ? sessionId : crypto.randomUUID(),
    capturedAt: Date.now(),
    ...(typeof cwd === "string" && cwd.length > 0 ? { cwd } : {}),
    ...(typeof title === "string" && title.length > 0 ? { title } : {}),
    message
  };
}

function writeAtomic(inboxDir, entry) {
  fs.mkdirSync(inboxDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(inboxDir, 0o700);
  } catch {
    // Best-effort: umask/Windows can make this a no-op.
  }

  const fileName = `${entry.capturedAt}-${entry.sessionId}-${crypto.randomUUID()}.json`;
  const finalPath = path.join(inboxDir, fileName);
  const tmpPath = path.join(inboxDir, `${TMP_PREFIX}${fileName}`);

  fs.writeFileSync(tmpPath, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpPath, finalPath);
  fs.chmodSync(finalPath, 0o600);

  return finalPath;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = value;
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function printUsageAndExit(code) {
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(
    "Usage: llm-voice-inbox add --provider <name> [--title <title>] [--cwd <dir>] [--session-id <id>]\n" +
      "Reads the message from stdin.\n"
  );
  process.exit(code);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (command === "--help" || command === undefined) {
    printUsageAndExit(command === undefined ? 1 : 0);
    return;
  }

  if (command !== "add") {
    process.stderr.write(`llm-voice-inbox: unknown command "${command}"\n`);
    printUsageAndExit(1);
    return;
  }

  const provider = typeof args.provider === "string" ? args.provider : undefined;
  if (provider === undefined || provider.length === 0) {
    process.stderr.write("llm-voice-inbox: --provider <name> is required\n");
    printUsageAndExit(1);
    return;
  }

  const message = readStdin();
  if (message.trim().length === 0) {
    process.stderr.write("llm-voice-inbox: empty stdin, skipping inbox write\n");
    process.exit(0);
    return;
  }

  const entry = buildEntry({
    provider,
    sessionId: typeof args["session-id"] === "string" ? args["session-id"] : undefined,
    cwd: typeof args.cwd === "string" ? args.cwd : process.cwd(),
    title: typeof args.title === "string" ? args.title : undefined,
    message
  });

  try {
    const writtenPath = writeAtomic(resolveInboxDir(), entry);
    process.stdout.write(`${writtenPath}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`llm-voice-inbox: failed to write inbox entry: ${error}\n`);
    process.exit(1);
  }
}

main();
