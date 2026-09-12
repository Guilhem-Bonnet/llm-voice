/**
 * Pure logic behind `LLM Voice: Browse Voices` (S8.2, CdC §72). Kept free of
 * `vscode` (same discipline as `onboarding/voiceTiers.ts`): the Quick Pick
 * wiring — `vscode.window.createQuickPick`, `onDidTriggerItemButton` — lives
 * in `commands/browseVoicesCommand.ts`, this file only decides what to show.
 *
 * The trap this story exists to catch (mission brief, five listening
 * iterations before landing on a cloned French reference): Chatterbox's 28
 * predefined voices are all English samples regardless of the `language`
 * request field (`docs/e2e/report-2026-09-08.md`). `isEnglishVoice` below is
 * what turns that into a visible warning instead of a silent bad choice.
 */

import type { Voice } from "../core/tts.js";

/** First subtag of a BCP-47 tag, lower-cased (`"fr-FR"` → `"fr"`, `"en"` → `"en"`). */
function primaryLanguageSubtag(tag: string): string {
  return tag.split(/[-_]/)[0]!.toLowerCase();
}

/**
 * True when `voice` is plainly English-labelled/tagged while the profile
 * being edited is not — a provider reporting no language at all is *not*
 * flagged (nothing to contradict the profile with), matching
 * `docs/voices.md`'s finding that only *declared* English voices are the
 * known trap.
 */
export function isEnglishVoice(voice: Voice, profileLanguage: string): boolean {
  const profileSubtag = primaryLanguageSubtag(profileLanguage);
  if (profileSubtag === "en") {
    return false;
  }
  const declared = voice.language !== undefined ? primaryLanguageSubtag(voice.language) : undefined;
  if (declared !== undefined) {
    return declared === "en";
  }
  // No declared language: fall back to a name/id that says "english" in some
  // form (`"English (US)"`, `"en_female_01"`...) — best-effort only, never
  // used to *clear* the warning, only to raise it.
  return /\ben(glish)?\b/i.test(voice.label) || /\ben(glish)?\b/i.test(voice.id);
}

/** One row of the `Browse Voices` Quick Pick, buttons included. */
export interface VoiceQuickPickItem {
  voiceId: string;
  label: string;
  description: string;
  /** `true` when this is the profile's currently applied voice. */
  isCurrent: boolean;
  /** `true` when `isEnglishVoice` flags this voice against the profile's language. */
  isEnglishMismatch: boolean;
}

const PREVIEW_BUTTON_TOOLTIP = "Écouter cette voix";

/** The one button every row carries: immediate preview without leaving the list. */
export interface VoiceQuickPickButton {
  iconPath: { id: string };
  tooltip: string;
}

export function previewButton(): VoiceQuickPickButton {
  return { iconPath: { id: "play" }, tooltip: PREVIEW_BUTTON_TOOLTIP };
}

/**
 * Builds every row for `Browse Voices`, sorted with the current voice first,
 * then alphabetically — a Quick Pick large enough to need it (28 predefined
 * Chatterbox voices) should not require scrolling to find what is already
 * selected.
 */
export function buildVoiceQuickPickItems(
  voices: readonly Voice[],
  profileLanguage: string,
  currentVoiceId: string | undefined
): VoiceQuickPickItem[] {
  const items = voices.map((voice) => {
    const isCurrent = currentVoiceId !== undefined && voice.id === currentVoiceId;
    const isEnglishMismatch = isEnglishVoice(voice, profileLanguage);
    const descriptionParts: string[] = [];
    descriptionParts.push(voice.language !== undefined ? voice.language : "langue inconnue");
    if (isEnglishMismatch) {
      descriptionParts.push("$(warning) voix anglophone");
    }
    return {
      voiceId: voice.id,
      label: `${isCurrent ? "$(check) " : ""}${voice.label}`,
      description: descriptionParts.join(" · "),
      isCurrent,
      isEnglishMismatch
    };
  });
  return items.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) {
      return a.isCurrent ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
  });
}
