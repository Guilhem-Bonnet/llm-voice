/**
 * Pure formatting of a `VoiceProfile` into a rich Quick Pick item (CdC §47,
 * §49): name, description = narrator + voice, and the 🔒/☁ badge driven by
 * `isRemoteProfile` (AC-SEC-05). Codicons only, never a raw emoji, per
 * ADR-011 "Theming strict".
 */

import type { VoiceProfile } from "../core/profile.js";
import { isRemoteProfile } from "../core/profile.schema.js";

export interface ProfileQuickPickItem {
  label: string;
  description: string;
  id: string;
}

/** "narrateur · voix", used as the Quick Pick item description. */
export function formatProfileDescription(profile: VoiceProfile): string {
  const voice = profile.tts.voice ?? profile.tts.providerId ?? "voix par défaut";
  const narrator =
    profile.mode === "narrated" && profile.narrator !== undefined
      ? (profile.narrator.model ?? profile.narrator.providerId ?? "narrateur")
      : "lecture fidèle";
  return `${narrator} · ${voice}`;
}

/** One profile as a `showQuickPick` item: badge, current-selection check, description. */
export function formatProfileQuickPickItem(profile: VoiceProfile, isSelected: boolean): ProfileQuickPickItem {
  const badge = isRemoteProfile(profile) ? "$(cloud)" : "$(lock)";
  const check = isSelected ? "$(check) " : "";
  return {
    label: `${badge} ${check}${profile.label}`,
    description: formatProfileDescription(profile),
    id: profile.id
  };
}
