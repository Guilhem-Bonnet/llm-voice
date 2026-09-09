/**
 * Per-source default profile resolution (CdC §47): "Markdown → Lecture
 * fidèle, Claude Inbox → Résumé LLM, Clipboard → Dernier profil utilisé".
 * Pure and vscode-free so it is unit testable on its own; `ProfileRepository`
 * is the only caller, `Pipeline` reads `llmVoice.profiles.bySource` and
 * passes it (plus the captured document's `SourceType`) into `getSelected`.
 */

import type { SourceType } from "../core/source.js";

/** Shape of the `llmVoice.profiles.bySource` setting; every key optional. */
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
