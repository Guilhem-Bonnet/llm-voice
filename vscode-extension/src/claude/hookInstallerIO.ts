/**
 * File I/O side of the Claude Code hook installer (ADR-003): checking the
 * three settings files for an existing entry, and atomically writing the
 * target one. Plain `node:fs`, no `vscode` — unit-testable against a tmpdir;
 * the Quick Pick/consent dialog lives in `ClaudeHookCommand.ts`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { addHookEntry, containsHookEntry, isSettingsObject, removeHookEntry } from "./hookEntry.js";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isEnoent(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

/** `undefined` raw text means "file does not exist yet" (never thrown). */
async function readRaw(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * `{}` for a missing/blank file; otherwise the parsed JSON. Throws on
 * malformed JSON *on purpose* — `settings.json` belongs to the user, and
 * overwriting a file we could not read would silently discard whatever was
 * in it. `ClaudeHookCommand` turns the throw into a message telling the
 * user to fix the file.
 */
function parseOrEmpty(raw: string | undefined): unknown {
  if (raw === undefined || raw.trim().length === 0) {
    return {};
  }
  return JSON.parse(raw);
}

/**
 * Same reasoning one step further (S6.1 audit F-06): valid JSON that is not
 * an object (an array, a bare string, `null`) is *not* a settings document,
 * and `addHookEntry` would have returned a fresh object — writing it back
 * would replace the file's entire content with our hook. Refuse instead.
 */
function assertWritableSettings(filePath: string, json: unknown): void {
  if (!isSettingsObject(json)) {
    throw new Error(
      `LLM Voice : ${filePath} ne contient pas un objet JSON — installation annulée pour ne pas écraser son contenu.`
    );
  }
}

export interface SettingsFileRef {
  /** Human label shown to the user (e.g. "utilisateur (~/.claude/settings.json)"). */
  label: string;
  path: string;
}

/** The three files Claude Code merges hooks from (settings.md, verified in `claude-hook-verification-v1.md`). */
export function claudeSettingsFiles(homeDir: string, workspaceRoot?: string): SettingsFileRef[] {
  const files: SettingsFileRef[] = [];
  if (workspaceRoot !== undefined) {
    files.push({ label: "projet (.claude/settings.json)", path: path.join(workspaceRoot, ".claude", "settings.json") });
    files.push({
      label: "projet local (.claude/settings.local.json)",
      path: path.join(workspaceRoot, ".claude", "settings.local.json")
    });
  }
  files.push({ label: "utilisateur (~/.claude/settings.json)", path: path.join(homeDir, ".claude", "settings.json") });
  return files;
}

/** First of `files` that already carries our hook, or `undefined`. */
export async function findExistingHook(files: readonly SettingsFileRef[]): Promise<SettingsFileRef | undefined> {
  for (const file of files) {
    const json = parseOrEmpty(await readRaw(file.path));
    if (containsHookEntry(json)) {
      return file;
    }
  }
  return undefined;
}

async function writeAtomicWithBackup(filePath: string, nextJson: unknown, previousRaw: string | undefined): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (previousRaw !== undefined) {
    // 0600: `settings.json` can carry env values and tokens for other tools;
    // our backup copy must not be more readable than the original.
    await fs.writeFile(`${filePath}.bak`, previousRaw, { encoding: "utf8", mode: 0o600 });
  }
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(nextJson, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, filePath);
}

/**
 * Adds the hook entry to `targetPath`, idempotently (delegates to
 * `addHookEntry`). Writes a `.bak` copy of the previous content first, if
 * any. Never checks the other two files — that is `findExistingHook`'s job,
 * called first by the command layer.
 */
export async function writeHookInstalled(targetPath: string, command: string): Promise<void> {
  const previousRaw = await readRaw(targetPath);
  const json = parseOrEmpty(previousRaw);
  assertWritableSettings(targetPath, json);
  const next = addHookEntry(json, command);
  await writeAtomicWithBackup(targetPath, next, previousRaw);
}

/** Removes only our hook entry from `targetPath` (delegates to `removeHookEntry`). */
export async function writeHookUninstalled(targetPath: string): Promise<void> {
  const previousRaw = await readRaw(targetPath);
  const json = parseOrEmpty(previousRaw);
  assertWritableSettings(targetPath, json);
  const next = removeHookEntry(json);
  await writeAtomicWithBackup(targetPath, next, previousRaw);
}
