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
import { describeVoice } from "../../profiles/voiceResolution.js";

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
 *
 * UX fix (real user feedback, 2026-11-05, `_grimoire-output/evidence/
 * GAO-fix-liste-de-001`): the visible row used to show
 * `formatProfileDescription` alone — a technical "narrator · voice" pair like
 * "ollama · chatterbox" that means nothing to someone who doesn't already
 * know what Ollama or Chatterbox are. Every shipped profile
 * (`src/profiles/defaults.ts`) already carries a plain-language `description`
 * ("Explication orale pédagogique, avec analogies quand elles aident.") that
 * was only ever surfaced as a tooltip — invisible unless you happen to hover.
 * It now leads the visible row instead, with the technical pair demoted to
 * the tooltip (still available for anyone who does want the provider names)
 * rather than removed. A blank (not just absent) `description` — the schema
 * allows `""`, e.g. a hand-edited profile — falls back to `technical` too,
 * same as `undefined`, so the row is never silently empty.
 *
 * ADR-017 §1.3: `profiles` are effective modes (`ProfileStore.listEffective`),
 * so the badge judges the URL actually used; a mode in `ownVoiceIds` leads with
 * "Voix propre : X", the one case where the global voice is not what is heard.
 */
export function buildProfileTreeItems(
  profiles: readonly VoiceProfile[],
  activeId: string | undefined,
  ownVoiceIds: ReadonlySet<string> = new Set()
): ProfileTreeItemData[] {
  return profiles.map((profile) => {
    const isActive = profile.id === activeId;
    const ownVoice = ownVoiceIds.has(profile.id);
    const technical = formatProfileDescription(profile, ownVoice ? "mode" : "global");
    const friendly =
      profile.description !== undefined && profile.description.trim().length > 0
        ? profile.description
        : undefined;
    const ownVoiceLabel = ownVoice ? `Voix propre : ${describeVoice(profile.tts)}` : undefined;
    const visible =
      ownVoiceLabel !== undefined
        ? friendly !== undefined
          ? `${ownVoiceLabel} — ${friendly}`
          : ownVoiceLabel
        : (friendly ?? technical);
    return {
      id: profile.id,
      label: profile.label,
      description: isActive ? `Actif — ${visible}` : visible,
      tooltip: friendly !== undefined ? `${friendly}\n\n${technical}` : profile.label,
      isActive,
      icon: isActive ? "check" : isRemoteProfile(profile) ? "cloud" : "lock"
    };
  });
}
