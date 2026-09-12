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

import type { ProfileCollection, TtsBinding, VoiceProfile } from "../core/profile.js";
import { CHATTERBOX_LOCAL_PRESET } from "../tts/presets.js";

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
