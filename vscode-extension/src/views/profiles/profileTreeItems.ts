/**
 * Pure formatting for the "Profils" Tree View (S9, ADR-011 revision
 * 2026-09-12): which profile is marked active and what each row shows. No
 * `vscode` import — `ProfilesTreeProvider.ts` is the thin wrapper that turns
 * this into real `vscode.TreeItem`s, same split as `inboxFormat.ts` /
 * `InboxTreeProvider.ts` and `playerHtml.ts` / `PlayerViewProvider.ts`.
 */

import type { VoiceProfile } from "../../core/profile.js";
import { isRemoteProfile } from "../../core/profile.schema.js";
import { formatProfileDescription } from "../../profiles/profileQuickPick.js";

/** Codicon id (no `$()` wrapper — `vscode.ThemeIcon` takes the bare name). */
export type ProfileTreeIcon = "check" | "lock" | "cloud";

export interface ProfileTreeItemData {
  id: string;
  label: string;
  description: string;
  tooltip: string;
  isActive: boolean;
  icon: ProfileTreeIcon;
}

/**
 * One row per profile, in `profiles.json` order. The active profile (CdC
 * §6/§47: "le profil actif marqué") gets the `check` icon and a leading
 * marker in its description instead of the usual 🔒/☁ badge — losing the
 * local/remote badge on that one row is an acceptable trade: "which profile
 * is active" is the more useful fact at a glance, and every row still says
 * so via its description text.
 */
export function buildProfileTreeItems(
  profiles: readonly VoiceProfile[],
  activeId: string | undefined
): ProfileTreeItemData[] {
  return profiles.map((profile) => {
    const isActive = profile.id === activeId;
    const detail = formatProfileDescription(profile);
    return {
      id: profile.id,
      label: profile.label,
      description: isActive ? `Actif — ${detail}` : detail,
      tooltip: profile.description ?? profile.label,
      isActive,
      icon: isActive ? "check" : isRemoteProfile(profile) ? "cloud" : "lock"
    };
  });
}
