/**
 * `Logger`: the single Output Channel logger for the whole extension
 * ("LLM Voice", CdC §81) — the rest of `src/` writes to it instead of the
 * global console object directly, a rule a dedicated static test enforces
 * (see `test/unit/invariants/`).
 *
 * Four levels (`error`/`warn`/`info`/`debug`), filtered by the
 * `llmVoice.log.level` setting (default `info`). Whatever the level,
 * `redact()` runs on every structured field passed alongside a log line and
 * enforces CdC §81's "ne jamais logger" list and AC-SEC-07 (security review
 * v1): no API key, no document/Claude-response body, no audio, regardless of
 * how verbose `debug` gets — `debug` only adds *more* fields, never *less*
 * redaction.
 *
 * `Logger`/`redact` take a duck-typed `LogSink` and only ever `import type`
 * `vscode` (erased at compile time), so both stay unit-testable in plain
 * Node — the same discipline as `src/core/*` and `src/net/EgressGuard.ts`
 * (ADR-005's "sans aucun import de `vscode`").
 */

import type * as vscodeTypes from "vscode";

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

/** Parses an arbitrary setting value into a known `LogLevel`, defaulting to `info`. */
export function parseLogLevel(value: unknown): LogLevel {
  return value === "error" || value === "warn" || value === "info" || value === "debug" ? value : "info";
}

/**
 * Field names that never reach the channel, whatever their level, length or
 * nesting depth (CdC §81: "API keys, contenu intégral des documents,
 * réponses Claude intégrales, audio" ; AC-SEC-07). Matched case-insensitively
 * so `apiKey`, `Authorization` and `spokenText` are all caught regardless of
 * the casing convention of the object that carried them (VS Code settings,
 * an HTTP header record, a `TtsRequest`…).
 */
const BANNED_FIELDS = new Set([
  "text",
  "spokentext",
  "rawtext",
  "message",
  "prompt",
  "apikey",
  "api_key",
  "authorization",
  "body",
  "audio",
  "audiouri",
  "data"
]);

/** A text field longer than this is truncated (CdC §81's "contenu intégral des documents"). */
export const MAX_REDACTED_FIELD_LENGTH = 120;

/**
 * Pure redaction of a structured log record: drops every `BANNED_FIELDS` key
 * (case-insensitive) at any depth — array or nested object — and truncates
 * every remaining string longer than `MAX_REDACTED_FIELD_LENGTH`. Never
 * throws: an `Error` is reduced to its (possibly truncated) `.message`, and
 * anything else unrecognised is passed through as-is rather than risk an
 * exception inside a logging call.
 */
export function redact(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return redactRecord(record, new WeakSet());
}

function redactRecord(record: Readonly<Record<string, unknown>>, seen: WeakSet<object>): Record<string, unknown> {
  if (seen.has(record)) {
    return {};
  }
  seen.add(record);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (BANNED_FIELDS.has(key.toLowerCase())) {
      continue;
    }
    output[key] = redactValue(value, seen);
  }
  return output;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return truncate(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return [];
    }
    seen.add(value);
    return value.map((entry) => redactValue(entry, seen));
  }
  if (value instanceof Error) {
    return truncate(value.message);
  }
  if (value !== null && typeof value === "object") {
    return redactRecord(value as Record<string, unknown>, seen);
  }
  return value;
}

function truncate(value: string): string {
  return value.length > MAX_REDACTED_FIELD_LENGTH
    ? `${value.slice(0, MAX_REDACTED_FIELD_LENGTH)}… [${value.length} chars, truncated]`
    : value;
}

/**
 * What `Logger` writes to: a plain `OutputChannel.appendLine`, or — when the
 * channel was created with `{ log: true }` — its native leveled methods
 * (`error`/`warn`/`info`/`debug`), which VS Code timestamps and colours
 * itself. Duck-typed so no runtime `vscode` import is needed here; the real
 * `vscode.OutputChannel`/`vscode.LogOutputChannel` both satisfy it.
 */
export interface LogSink {
  appendLine(value: string): void;
  error?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  info?(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

export class Logger {
  private level: LogLevel;

  constructor(
    private readonly sink: LogSink,
    level: LogLevel = "info"
  ) {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write("error", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write("warn", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write("info", message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write("debug", message, meta);
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] > LEVEL_RANK[this.level]) {
      return;
    }
    const line = formatLine(message, meta);
    const native = this.sink[level];
    if (typeof native === "function") {
      native.call(this.sink, line);
      return;
    }
    this.sink.appendLine(`[${level}] ${line}`);
  }
}

function formatLine(message: string, meta?: Record<string, unknown>): string {
  if (meta === undefined) {
    return message;
  }
  const safe = redact(meta);
  if (Object.keys(safe).length === 0) {
    return message;
  }
  try {
    return `${message} ${JSON.stringify(safe)}`;
  } catch {
    // A value that JSON.stringify chokes on (BigInt, a cycle `redact()`
    // didn't unwrap) must not take the whole log line down with it.
    return message;
  }
}

/**
 * Builds the extension's `Logger` from a real (or fake, in tests) output
 * channel and the `llmVoice.log.level` setting. Only `vscode` *types* are
 * used here — never a runtime import — so this stays callable from plain
 * Node if a caller ever wants to (it currently doesn't: `extension.ts` is
 * the only caller, and it always passes a real channel).
 */
export function createLogger(
  channel: vscodeTypes.OutputChannel | vscodeTypes.LogOutputChannel,
  level: LogLevel = "info"
): Logger {
  return new Logger(channel, level);
}
