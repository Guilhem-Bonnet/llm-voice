/**
 * `profiles.json` migrations (bug fix: voice-selection-not-applied, defect 2).
 *
 * A real user's `profiles.json` from before `llmVoice.tts.provider: "auto"`
 * existed (ADR-009/S7.1) pins every non-system profile's `tts.providerId` to
 * `"chatterbox"` at the then-only local default (`baseUrl:
 * "http://localhost:8004"`) — `ProfileRepository.defaultCollection()` wrote
 * exactly that shape at `schemaVersion: 1` before `SYSTEM_VOICE_PROFILE`/the
 * `"auto"` fallback chain (`resolveTtsProviderConfig` →
 * `autoSelectTts`/`selectAutoTtsProvider`, Chatterbox → Piper-local →
 * système) existed at all. Loading that file today never benefits from the
 * fallback chain — `resolveTtsProviderConfig` honours an *explicit*
 * `providerId` unconditionally, by design (a profile that deliberately names
 * a provider must never be silently overridden) — so a user who stopped
 * Chatterbox is stuck on "LLM Voice : aucune voix configurée." even with
 * Piper/système perfectly reachable, because nothing ever told their
 * `profiles.json` that "auto" now exists.
 *
 * `migrateProfileCollection` is the one-time, idempotent fix: any profile
 * whose `tts` is *exactly* that old stock shape — `providerId: "chatterbox"`
 * and `baseUrl` still the shipped local default, never pointed anywhere else
 * — is rewritten to `providerId: "auto"` (dropping `baseUrl`, meaningless
 * once resolution goes through `autoSelectTts`). A profile with a *different*
 * `baseUrl` (a deliberately configured remote/custom Chatterbox, CdC §comment
 * on `resolveTtsProviderConfig`) is left untouched — this migration only
 * ever removes a default it can prove was never customised, exactly the
 * "the user never explicitly chose this provider" test the bug report asks
 * for; there is no other signal available in `profiles.json` itself to tell
 * a deliberate choice from a stale default (`ProfileRepository`'s file
 * header — `Setup Voice`/`Browse Voices`/the profile editor never let a user
 * set `providerId` at all today, only `defaults.ts`/import/hand-editing do).
 *
 * `ProfileRepository.load()` is the only caller: it runs this once per read,
 * persists the result immediately when `migrated` is `true` (so the on-disk
 * file's own `schemaVersion` reflects reality from then on), and — because
 * this function is itself idempotent (nothing left below
 * `CURRENT_PROFILE_SCHEMA_VERSION` to migrate a second time) — a load that
 * races a write, or a file migrated by a previous run, is always a no-op.
 */

import type { GlobalVoice, ProfileCollection, TtsBinding, VoiceProfile } from "../core/profile.js";
import { resolveTtsConfig, type TtsSettings } from "../pipeline/resolveProviderConfig.js";
import { CHATTERBOX_LOCAL_PRESET } from "../tts/presets.js";
import { canonicalJson, hasOwnVoice } from "./voiceResolution.js";

/** Bumped whenever a new migration is added below. */
export const CURRENT_PROFILE_SCHEMA_VERSION = 2;

export interface ProfileMigrationResult {
  collection: ProfileCollection;
  /** `true` only when the input was below `CURRENT_PROFILE_SCHEMA_VERSION` and something actually changed on disk. */
  migrated: boolean;
}

/**
 * `true` only for the exact stock shape `ProfileRepository.defaultCollection()`
 * used to write at `schemaVersion: 1` (before "auto" existed): explicit
 * `chatterbox` at the shipped local `baseUrl`, nothing else distinguishing
 * it from any other profile that happens to share those two fields by
 * coincidence — which is exactly the point: a profile that still matches
 * the shipped default, field for field, was never deliberately pointed
 * anywhere.
 */
function isStaleDefaultChatterboxPin(tts: TtsBinding): boolean {
  return tts.providerId === "chatterbox" && tts.baseUrl === CHATTERBOX_LOCAL_PRESET.baseUrl;
}

function migrateProfileTts(profile: VoiceProfile): VoiceProfile {
  if (!isStaleDefaultChatterboxPin(profile.tts)) {
    return profile;
  }
  const { baseUrl: _staleBaseUrl, ...rest } = profile.tts;
  return { ...profile, tts: { ...rest, providerId: "auto" } };
}

/**
 * Pure, versioned migration of a validated `ProfileCollection`. Safe to run
 * on every `load()`: a collection already at `CURRENT_PROFILE_SCHEMA_VERSION`
 * is returned unchanged (`migrated: false`), so calling this twice in a row
 * — or on a collection this same function already migrated — never rewrites
 * an already-current file.
 */
export function migrateProfileCollection(collection: ProfileCollection): ProfileMigrationResult {
  if (collection.schemaVersion >= CURRENT_PROFILE_SCHEMA_VERSION) {
    return { collection, migrated: false };
  }
  return {
    collection: {
      ...collection,
      schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
      profiles: collection.profiles.map(migrateProfileTts)
    },
    migrated: true
  };
}

// ------------------------------------------------------------------ ADR-017 §2

/** The mark `ProfileCollection.voiceMigration` takes once a file has been classified. */
export const VOICE_MIGRATION_MARK = 1;

/**
 * The path the shipped profiles carried before the `chatterbox-local` preset
 * stopped cloning by default (`presets.ts`): a file of this repository's `deploy/`
 * folder, never a sample of the user's.
 */
export const SHIPPED_REFERENCE_AUDIO = "../deploy/tts/reference-audio/fr-female-siwis.wav";

/** The shape `system-voice` was created with (S7.1): "d'origine" is judged against this. */
const ORIGIN_SYSTEM_VOICE = {
  id: "system-voice",
  label: "Voix système (aucune installation)",
  chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
  playback: { rate: 1, volume: 1 }
} as const;

const FAITHFUL_MODE_ID = "faithful-local";

/**
 * Label and description of the shipped modes: each changes only if still equal to
 * what was shipped. The description of `faithful-local` would otherwise name an
 * engine that is no longer necessarily its own.
 */
const SHIPPED_TEXTS: Readonly<Record<string, { label: readonly [string, string]; description?: readonly [string, string] }>> = {
  "faithful-local": {
    label: ["Lecture fidèle (local)", "Fidèle"],
    description: ["Chatterbox sur la machine locale, aucune sortie réseau.", "Lit le texte tel qu'il est écrit, sans réécriture."]
  },
  "technical-teacher": { label: ["Professeur technique", "Professeur"] },
  "llm-summary": { label: ["Résumé LLM", "Résumé"] },
  "quick-review": { label: ["Révision rapide", "Révision"] }
};

/** Why the initial voice cannot just be heard as is: a message for the user, once. */
export type VoiceNotice =
  /** No voice file, and nothing left to recompute it from. */
  | { kind: "voice-reset" }
  /** Personal sample and named voice together: the sample wins, as it always did. */
  | { kind: "sample-over-voice"; voice: string };

function modeById(collection: ProfileCollection, id: string | undefined): VoiceProfile | undefined {
  return id === undefined ? undefined : collection.profiles.find((profile) => profile.id === id);
}

/**
 * Same engine resolution as today, without resolving `auto`, plus the first case of
 * "Échantillon déjà présent": a shipped sample next to a named voice goes, because
 * the sample came from the delivery and the voice from the user. `system` and `auto`
 * get no URL from the settings: neither would use it, and it could only mislead the
 * local/remote badge.
 */
export function completeVoiceBinding(tts: TtsBinding, settings: TtsSettings): TtsBinding & { providerId: string } {
  const { referenceAudio, ...rest } = tts;
  const keepSample = referenceAudio !== undefined && !(referenceAudio === SHIPPED_REFERENCE_AUDIO && tts.voice !== undefined);
  const resolved = resolveTtsConfig(tts, settings);
  const usesUrl = resolved.providerId !== "system" && resolved.providerId !== "auto";
  return {
    ...rest,
    providerId: resolved.providerId,
    ...(tts.baseUrl !== undefined || (usesUrl && resolved.baseUrl.length > 0) ? { baseUrl: resolved.baseUrl } : {}),
    ...(keepSample ? { referenceAudio } : {})
  };
}

export interface InitialVoiceInput {
  lastSelectedId: string | undefined;
  settings: TtsSettings;
  /**
   * The same file before its first classification (`profiles.pre-adr-017.json`),
   * when it exists: what tells a `tts: {}` emptied by a migration from a
   * `tts: {}` a user of 0.3 wrote on purpose.
   */
  backup?: ProfileCollection | undefined;
}

export interface InitialVoice {
  voice: GlobalVoice;
  notice?: VoiceNotice;
}

/**
 * The voice of the mode the user was last on, else of the default one, without
 * `bySource`: that is where their choices went (`Pipeline.browseVoices`, cause C).
 * It is computed once; a file that already has its voice never gets here.
 */
export function computeInitialVoice(collection: ProfileCollection, input: InitialVoiceInput): InitialVoice {
  const source =
    modeById(collection, input.lastSelectedId) ??
    modeById(collection, collection.defaultProfileId) ??
    collection.profiles[0];
  if (source === undefined) {
    throw new Error("profiles.json contains no profile");
  }
  if (!hasOwnVoice(source)) {
    // A `tts` emptied by an earlier migration says nothing about a voice: never
    // recompute from it. Without that proof it is a file 0.3 was reading through
    // `llmVoice.tts.*`, whose behaviour the completion below preserves.
    const before = input.backup?.profiles.find((profile) => profile.id === source.id);
    if (before !== undefined && hasOwnVoice(before)) {
      return { voice: { providerId: "system", speed: 1 }, notice: { kind: "voice-reset" } };
    }
  }
  const voice: GlobalVoice = { ...completeVoiceBinding(source.tts, input.settings), speed: 1 };
  if (
    voice.referenceAudio !== undefined &&
    voice.referenceAudio !== SHIPPED_REFERENCE_AUDIO &&
    voice.voice !== undefined
  ) {
    return { voice, notice: { kind: "sample-over-voice", voice: voice.voice } };
  }
  return { voice };
}

function withoutSpeedAndFormat(binding: TtsBinding & { speed?: number }): TtsBinding {
  const { speed: _speed, format: _format, ...rest } = binding;
  return rest;
}

/**
 * ADR-017 §2, second line of the table: the same voice. Both sides are completed the
 * way the initial voice is: otherwise the mode the voice came from, whose `tts` named
 * no URL or held the shipped sample, would stay a voice of its own against itself.
 */
function isSameVoice(tts: TtsBinding, voice: GlobalVoice, settings: TtsSettings): boolean {
  return (
    canonicalJson(withoutSpeedAndFormat(completeVoiceBinding(tts, settings))) ===
    canonicalJson(withoutSpeedAndFormat(completeVoiceBinding(voice, settings)))
  );
}

/**
 * ADR-017 §2, third line: only what can be proved to come from the delivery goes
 * (same rule of proof as `isStaleDefaultChatterboxPin`). Any other field, or any
 * other value, means someone chose it.
 */
function isShippedTts(tts: TtsBinding): boolean {
  const { providerId, baseUrl, voice, apiKeyRef, model, parameters, format, referenceAudio } = tts;
  const shippedEngine =
    ((providerId === undefined || providerId === "auto") && baseUrl === undefined) ||
    (providerId === "chatterbox" && baseUrl === CHATTERBOX_LOCAL_PRESET.baseUrl);
  return (
    shippedEngine &&
    voice === undefined &&
    apiKeyRef === undefined &&
    model === undefined &&
    (parameters === undefined || canonicalJson(parameters) === canonicalJson(CHATTERBOX_LOCAL_PRESET.parameters)) &&
    (format === undefined || format === "wav") &&
    (referenceAudio === undefined || referenceAudio === SHIPPED_REFERENCE_AUDIO)
  );
}

function isExactlySystemVoiceTts(tts: TtsBinding): boolean {
  return canonicalJson(tts) === canonicalJson({ providerId: "system" });
}

function isShippedSystemVoiceMode(mode: VoiceProfile): boolean {
  return (
    mode.id === ORIGIN_SYSTEM_VOICE.id &&
    mode.label === ORIGIN_SYSTEM_VOICE.label &&
    mode.mode === "faithful" &&
    mode.narrator === undefined &&
    canonicalJson(mode.chunking) === canonicalJson(ORIGIN_SYSTEM_VOICE.chunking) &&
    canonicalJson(mode.playback) === canonicalJson(ORIGIN_SYSTEM_VOICE.playback) &&
    (!hasOwnVoice(mode) || isExactlySystemVoiceTts(mode.tts))
  );
}

export interface ClassificationInput {
  voice: GlobalVoice;
  settings: TtsSettings;
  lastSelectedId: string | undefined;
  /** Ids the `modes.bySource` setting names: `system-voice` stays what it is for them. */
  sourceTargets: readonly string[];
  /** `llmVoice.defaultProfile`, retired: taken over once if it names an existing mode. */
  legacyDefaultProfile?: string | undefined;
}

export interface Classification {
  collection: ProfileCollection;
  /** Set only when `lastSelectedId` must change; written by the caller, never the backup. */
  lastSelectedId?: string;
}

function classifyTts(mode: VoiceProfile, input: ClassificationInput): TtsBinding {
  if (!hasOwnVoice(mode)) {
    return mode.tts;
  }
  if (isSameVoice(mode.tts, input.voice, input.settings) || isShippedTts(mode.tts)) {
    return {};
  }
  if (
    mode.id === ORIGIN_SYSTEM_VOICE.id &&
    isExactlySystemVoiceTts(mode.tts) &&
    !input.sourceTargets.includes(mode.id)
  ) {
    return {};
  }
  return mode.tts;
}

function withShippedTexts(mode: VoiceProfile): VoiceProfile {
  const texts = SHIPPED_TEXTS[mode.id];
  if (texts === undefined) {
    return mode;
  }
  const [shippedLabel, nextLabel] = texts.label;
  return {
    ...mode,
    ...(mode.label === shippedLabel ? { label: nextLabel } : {}),
    ...(texts.description !== undefined && mode.description === texts.description[0]
      ? { description: texts.description[1] }
      : {})
  };
}

/**
 * ADR-017 §2, "Classement de chaque mode": pure, and stable under replay. Ids and
 * every field outside `tts`, label and description stay at equal JSON value; a
 * `tts` that does not empty stays as it is, and displays "Voix propre : X".
 */
export function classifyModes(collection: ProfileCollection, input: ClassificationInput): Classification {
  const hasFaithful = collection.profiles.some((mode) => mode.id === FAITHFUL_MODE_ID);
  const profiles = collection.profiles.map((mode) => {
    const tts = classifyTts(mode, input);
    const hide = hasFaithful && isShippedSystemVoiceMode(mode) && !hasOwnVoice({ tts });
    return { ...withShippedTexts(mode), tts, ...(hide ? { hidden: true } : {}) };
  });
  const isHidden = (id: string | undefined): boolean =>
    profiles.some((mode) => mode.id === id && mode.hidden === true);

  const legacy = input.legacyDefaultProfile;
  const adoptedDefault =
    legacy !== undefined && legacy.length > 0 && profiles.some((mode) => mode.id === legacy)
      ? legacy
      : collection.defaultProfileId;
  return {
    collection: {
      ...collection,
      schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
      voiceMigration: VOICE_MIGRATION_MARK,
      defaultProfileId: isHidden(adoptedDefault) ? FAITHFUL_MODE_ID : adoptedDefault,
      profiles
    },
    ...(isHidden(input.lastSelectedId) ? { lastSelectedId: FAITHFUL_MODE_ID } : {})
  };
}
