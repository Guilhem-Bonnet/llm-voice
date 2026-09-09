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

function asSettings(json: unknown): ClaudeSettingsJson {
  if (json === null || json === undefined || typeof json !== "object" || Array.isArray(json)) {
    return {};
  }
  return json as ClaudeSettingsJson;
}

function isOurs(hook: ClaudeHookCommandEntry): boolean {
  return typeof hook.command === "string" && hook.command.includes(HOOK_RECOGNITION_SUBSTRING);
}

/** True if any `Stop` hook entry (matched by substring) is already present. */
export function containsHookEntry(json: unknown): boolean {
  const stopGroups = asSettings(json).hooks?.Stop;
  if (!Array.isArray(stopGroups)) {
    return false;
  }
  return stopGroups.some((group) => Array.isArray(group.hooks) && group.hooks.some(isOurs));
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
  const stopGroups: ClaudeHookMatcherGroup[] = Array.isArray(hooks.Stop) ? hooks.Stop.map((group) => ({ ...group, hooks: [...group.hooks] })) : [];

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

  const filteredGroups = settings.hooks.Stop.map((group) => ({
    ...group,
    hooks: (Array.isArray(group.hooks) ? group.hooks : []).filter((hook) => !isOurs(hook))
  })).filter((group) => group.hooks.length > 0);

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
