/**
 * Pure formatting of a `VoiceProfile` into a rich Quick Pick item (CdC §47,
 * §49): name, description = narrator + voice, and the 🔒/☁ badge driven by
 * `isRemoteProfile` (AC-SEC-05). Codicons only, never a raw emoji, per
 * ADR-011 "Theming strict".
 */

import type { VoiceProfile } from "../core/profile.js";
import { isRemoteProfile } from "../core/profile.schema.js";
import { describeVoice, type VoiceOrigin } from "./voiceResolution.js";

export interface ProfileQuickPickItem {
  label: string;
  description: string;
  id: string;
}

/**
 * "narrateur · voix", used as the Quick Pick item description. `profile` is the
 * effective mode (`ProfileStore.listEffective`), so the voice shown is the one
 * heard; a voice of its own says so (ADR-017 §1.3).
 */
export function formatProfileDescription(profile: VoiceProfile, voiceOrigin: VoiceOrigin = "global"): string {
  const described = describeVoice(profile.tts);
  const voice = voiceOrigin === "mode" ? `Voix propre : ${described}` : described;
  const narrator =
    profile.mode === "narrated" && profile.narrator !== undefined
      ? (profile.narrator.model ?? profile.narrator.providerId ?? "narrateur")
      : "lecture fidèle";
  return `${narrator} · ${voice}`;
}

/** One profile as a `showQuickPick` item: badge, current-selection check, description. */
export function formatProfileQuickPickItem(
  profile: VoiceProfile,
  isSelected: boolean,
  voiceOrigin: VoiceOrigin = "global"
): ProfileQuickPickItem {
  const badge = isRemoteProfile(profile) ? "$(cloud)" : "$(lock)";
  const check = isSelected ? "$(check) " : "";
  return {
    label: `${badge} ${check}${profile.label}`,
    description: formatProfileDescription(profile, voiceOrigin),
    id: profile.id
  };
}
