/**
 * Per-source default mode resolution (CdC §47): "Markdown → Fidèle, Claude
 * Inbox → Résumé, Clipboard → dernier mode utilisé". Pure and vscode-free so it
 * is unit testable on its own; `ProfileStore` is the only caller, `Pipeline`
 * reads the setting (`readModesBySource`) and passes it, plus the captured
 * document's `SourceType`, into `resolveReading`.
 */

import type { SourceType } from "../core/source.js";

/** Shape of `llmVoice.modes.bySource` and of the deprecated `llmVoice.profiles.bySource`; every key optional. */
export interface BySourceSetting {
  markdown?: string;
  text?: string;
  clipboard?: string;
  "claude-code"?: string;
}

/**
 * The profile id `getSelected` should try first, in priority order:
 * an explicit per-source default, else the last profile the user picked,
 * else the collection's own default. The caller still falls back further
 * (to the first profile) if the id this returns names a profile that no
 * longer exists.
 */
export function resolveDefaultProfileId(
  sourceType: SourceType | undefined,
  bySource: BySourceSetting | undefined,
  lastSelectedId: string | undefined,
  collectionDefaultId: string
): string {
  const bySourceId = sourceType !== undefined ? bySource?.[sourceType as keyof BySourceSetting] : undefined;
  return bySourceId ?? lastSelectedId ?? collectionDefaultId;
}

/** The part of `vscode.WorkspaceConfiguration` `readModesBySource` needs. */
export interface BySourceConfiguration {
  get<T>(section: string): T | undefined;
  inspect(section: string):
    | {
        globalValue?: unknown;
        workspaceValue?: unknown;
        workspaceFolderValue?: unknown;
        globalLanguageValue?: unknown;
        workspaceLanguageValue?: unknown;
        workspaceFolderLanguageValue?: unknown;
      }
    | undefined;
}

/**
 * ADR-017 §2: `get()` cannot tell a default from a user value, so `inspect()`
 * decides. A `llmVoice.modes.bySource` set at any level wins; otherwise the
 * deprecated `llmVoice.profiles.bySource` is what the user last expressed, and
 * its own default equals the new one.
 */
export function readModesBySource(config: BySourceConfiguration): BySourceSetting {
  const inspected = config.inspect("modes.bySource");
  const explicit =
    inspected !== undefined &&
    [
      inspected.globalValue,
      inspected.workspaceValue,
      inspected.workspaceFolderValue,
      inspected.globalLanguageValue,
      inspected.workspaceLanguageValue,
      inspected.workspaceFolderLanguageValue
    ].some((value) => value !== undefined);
  const section = explicit ? "modes.bySource" : "profiles.bySource";
  return config.get<BySourceSetting>(section) ?? {};
}
