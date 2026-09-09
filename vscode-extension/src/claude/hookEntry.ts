/**
 * Pure JSON transforms for `~/.claude/settings.json`'s `hooks.Stop` list
 * (ADR-003, `claude-hook-verification-v1.md`). No I/O here on purpose: the
 * caller reads/writes the file and owns the backup/atomic-rename dance
 * (`hookInstallerIO.ts`), which is what makes these functions trivially
 * testable against plain objects.
 *
 * Recognition is a substring match on `command` (`llm-voice-capture`), not
 * an exact string: our own hook may legitimately be installed with a
 * different absolute path (dev checkout vs. packaged extension) and must
 * still be recognised as "already installed" — `install()` twice must never
 * add a second entry (ADR-003's decision + tests).
 */

export const HOOK_RECOGNITION_SUBSTRING = "llm-voice-capture";

export interface ClaudeHookCommandEntry {
  type: "command";
  command: string;
  timeout?: number;
  statusMessage?: string;
  [key: string]: unknown;
}

export interface ClaudeHookMatcherGroup {
  matcher?: string;
  hooks: ClaudeHookCommandEntry[];
  [key: string]: unknown;
}

export interface ClaudeSettingsHooks {
  Stop?: ClaudeHookMatcherGroup[];
  [key: string]: unknown;
}

export interface ClaudeSettingsJson {
  hooks?: ClaudeSettingsHooks;
  [key: string]: unknown;
}

/** True for a JSON value we are willing to treat as a settings document. */
export function isSettingsObject(json: unknown): json is ClaudeSettingsJson {
  return json !== null && json !== undefined && typeof json === "object" && !Array.isArray(json);
}

function asSettings(json: unknown): ClaudeSettingsJson {
  return isSettingsObject(json) ? json : {};
}

/**
 * `hooks.Stop` belongs to the user and to whatever other tooling writes
 * there: every shape below is something a third party can legitimately
 * (or accidentally) leave in the file, and none of it may crash
 * `install`/`uninstall` (S6.1 audit F-05). Before this, a `Stop` group with
 * no `hooks` key — a real shape Claude Code tolerates — threw a TypeError
 * out of `addHookEntry` and took the whole install command down.
 */
function hooksOf(group: unknown): ClaudeHookCommandEntry[] {
  if (group === null || typeof group !== "object" || Array.isArray(group)) {
    return [];
  }
  const hooks = (group as ClaudeHookMatcherGroup).hooks;
  return Array.isArray(hooks) ? hooks : [];
}

function groupsOf(json: unknown): unknown[] {
  const stop = asSettings(json).hooks?.Stop;
  return Array.isArray(stop) ? stop : [];
}

function isOurs(hook: unknown): boolean {
  if (hook === null || typeof hook !== "object") {
    return false;
  }
  const command = (hook as ClaudeHookCommandEntry).command;
  return typeof command === "string" && command.includes(HOOK_RECOGNITION_SUBSTRING);
}

/** True if any `Stop` hook entry (matched by substring) is already present. */
export function containsHookEntry(json: unknown): boolean {
  return groupsOf(json).some((group) => hooksOf(group).some(isOurs));
}

export interface AddHookEntryOptions {
  timeout?: number;
  statusMessage?: string;
}

/**
 * Adds a `Stop` hook running `command`, preserving every other key at every
 * level. Idempotent: if a matching entry is already present anywhere in
 * `hooks.Stop`, the settings are returned unchanged (deep-cloned, never the
 * same reference) rather than adding a duplicate.
 */
export function addHookEntry(json: unknown, command: string, options: AddHookEntryOptions = {}): ClaudeSettingsJson {
  const settings = asSettings(json);
  const hooks: ClaudeSettingsHooks = { ...(settings.hooks ?? {}) };
  const stopGroups: ClaudeHookMatcherGroup[] = groupsOf(json).map((group) => ({
    ...(group !== null && typeof group === "object" && !Array.isArray(group) ? group : {}),
    hooks: [...hooksOf(group)]
  }));

  if (stopGroups.some((group) => group.hooks.some(isOurs))) {
    return { ...settings, hooks: { ...hooks, Stop: stopGroups } };
  }

  const entry: ClaudeHookCommandEntry = {
    type: "command",
    command,
    timeout: options.timeout ?? 15,
    ...(options.statusMessage !== undefined ? { statusMessage: options.statusMessage } : {})
  };
  stopGroups.push({ hooks: [entry] });

  return { ...settings, hooks: { ...hooks, Stop: stopGroups } };
}

/**
 * Removes every `Stop` hook entry recognised by `HOOK_RECOGNITION_SUBSTRING`,
 * preserving every other entry/matcher group. A matcher group left with no
 * hooks is dropped; `hooks.Stop` is dropped if it becomes empty; `hooks` is
 * dropped only if it becomes an empty object.
 */
export function removeHookEntry(json: unknown): ClaudeSettingsJson {
  const settings = asSettings(json);
  if (!Array.isArray(settings.hooks?.Stop)) {
    return settings;
  }

  const filteredGroups = groupsOf(json)
    .map((group) => ({
      ...(group !== null && typeof group === "object" && !Array.isArray(group) ? group : {}),
      hooks: hooksOf(group).filter((hook) => !isOurs(hook))
    }))
    .filter((group) => group.hooks.length > 0);

  const hooks: ClaudeSettingsHooks = { ...settings.hooks };
  if (filteredGroups.length > 0) {
    hooks.Stop = filteredGroups;
  } else {
    delete hooks.Stop;
  }

  const next: ClaudeSettingsJson = { ...settings };
  if (Object.keys(hooks).length > 0) {
    next.hooks = hooks;
  } else {
    delete next.hooks;
  }
  return next;
}
