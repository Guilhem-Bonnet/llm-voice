#!/usr/bin/env node
"use strict";

/**
 * LLM Voice — Claude Code capture script (ADR-003).
 *
 * Reads a Claude Code `Stop` hook payload from stdin, extracts
 * `last_assistant_message`, and writes it as a JSON entry into the LLM
 * Voice inbox. Writes are atomic (tmp file + rename) with 0600 permissions.
 *
 * Deliberately self-contained (no `require()` outside Node core modules,
 * no relative import): a Claude Code plugin install may copy only this
 * `plugin/` directory, so nothing this script needs may live outside it —
 * see `integrations/cli/llm-voice-inbox.js` for the open-CLI twin, which
 * duplicates the same ~30 lines of write logic for the same reason
 * (ADR-007: "un unique script Node cross-platform, auditable en une
 * lecture", kept true for each independently-distributed artifact).
 *
 * Contract: this script MUST NOT play any audio, MUST NOT throw an
 * uncaught exception, and MUST always exit 0 so it never blocks the
 * Claude Code session it is attached to. Failures are reported on stderr
 * only. `SubagentStop` is deliberately not wired to this script (ADR-003).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;
const PROVIDER = "claude-code";
/** ADR-004: `.tmp-` prefix, ignored by the extension's inbox watcher. */
const TMP_PREFIX = ".tmp-";
/**
 * AC-SEC-03: `sessionId` becomes a literal segment of the written file
 * name (`<capturedAt>-<sessionId>-<rand>.json`) and comes straight from
 * the hook payload's `session_id` — untrusted input. Anything outside a
 * conservative allowlist (in particular `/`, `\`, and `.`, which enables
 * `..` traversal) is rejected rather than embedded, to keep `path.join()`
 * from ever escaping `inboxDir`.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
/**
 * Hard cap on one inbox entry (S6.1 audit F-13). The extension reads every
 * inbox file into memory on each scan; a single 50 MB payload (a hook that
 * dumped a whole build log into `last_assistant_message`) would make every
 * refresh allocate 50 MB. Truncating keeps the entry usable and visibly
 * marked, which is better than either writing it whole or dropping it.
 */
const MAX_MESSAGE_BYTES = 1024 * 1024;
const TRUNCATION_NOTICE = "\n\n[LLM Voice] message tronqué : dépassait 1 Mio.";

function capMessage(message) {
  if (typeof message !== "string" || Buffer.byteLength(message, "utf8") <= MAX_MESSAGE_BYTES) {
    return message;
  }
  return Buffer.from(message, "utf8").subarray(0, MAX_MESSAGE_BYTES).toString("utf8") + TRUNCATION_NOTICE;
}

function sanitizeSessionId(sessionId) {
  return typeof sessionId === "string" && SAFE_SESSION_ID.test(sessionId) ? sessionId : crypto.randomUUID();
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function resolveInboxDir() {
  const override = process.env.LLM_VOICE_INBOX;
  if (typeof override === "string" && override.trim().length > 0) {
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
    // A missing/non-string/unsafe session id must never produce an entry
    // the extension's Zod schema rejects, nor a path-traversal file name
    // (AC-SEC-03): fall back to a fresh random one.
    sessionId: sanitizeSessionId(payload?.session_id),
    // Epoch milliseconds (ADR-003's canonical wire shape; also what the
    // `<capturedAt>-<sessionId>-<rand>.json` file name is derived from).
    capturedAt: Date.now(),
    cwd: typeof payload?.cwd === "string" ? payload.cwd : process.cwd(),
    message: capMessage(message)
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

  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmpPath, finalPath);
  } catch (error) {
    // ENOSPC/EACCES mid-write would otherwise leave a `.tmp-` file behind
    // forever — the watcher ignores it, but it still consumes the disk the
    // write just ran out of (S6.1 audit F-13).
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Nothing more we can do; the caller reports the original failure.
    }
    throw error;
  }
  fs.chmodSync(finalPath, 0o600);

  return finalPath;
}

/**
 * The contract of this script is "never make Claude Code fail" (ADR-003).
 * `main()` already guards the write, but everything *around* it could still
 * throw — `os.homedir()` on an exotic environment, an EPIPE on stderr, a
 * `RangeError` from `JSON.stringify` on a pathological payload — and an
 * uncaught throw exits 1, which Claude Code surfaces as a hook failure.
 * These two nets make exit 0 unconditional (S6.1 audit F-13).
 */
process.on("uncaughtException", (error) => {
  try {
    process.stderr.write(`llm-voice-capture: uncaught error: ${error}\n`);
  } catch {
    // stderr itself is gone; there is nothing left to report to.
  }
  process.exit(0);
});
process.on("unhandledRejection", () => process.exit(0));

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

try {
  main();
} catch (error) {
  try {
    process.stderr.write(`llm-voice-capture: unexpected error: ${error}\n`);
  } catch {
    // See `uncaughtException` above.
  }
  process.exit(0);
}
