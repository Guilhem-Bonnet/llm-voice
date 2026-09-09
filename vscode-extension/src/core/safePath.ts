/**
 * Path-safety primitives shared by every module that derives a filesystem
 * path from data it did not produce: an inbox file id, a profile's
 * `tts.referenceAudio`, a `SecretStorage` reference (AC-SEC-03, AC-SEC-08,
 * S6.1 audit).
 *
 * Two rules, deliberately separate:
 *
 * - `isSafePathSegment` is an *allowlist* for something that becomes one
 *   literal segment of a path we build (`<dir>/<id>.json`). It is the same
 *   discipline the collector already applies to `session_id`, applied on the
 *   reading side too — the failure museum's "traversée de chemin dans
 *   l'inbox" entry is exactly the case where only one side had it.
 * - `isContainedIn` is a *canonical* containment check for a path we were
 *   handed whole. It compares resolved paths segment-wise, never as raw
 *   strings: `"/a/inbox-evil"` must not count as inside `"/a/inbox"`.
 *
 * No `node:fs` import: everything here is pure and synchronous so it can run
 * inside a Zod refinement. Symlink resolution (`fs.realpath`) belongs to the
 * caller, which then re-checks containment on the *resolved* path.
 */

import * as path from "node:path";

/**
 * One path segment we are willing to interpolate into a path we build.
 * Rejects `/`, `\`, `.` (hence `..`), control characters, Unicode
 * direction/format characters, and anything over 128 chars.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

export function isSafePathSegment(value: unknown): value is string {
  return typeof value === "string" && SAFE_SEGMENT.test(value);
}

/**
 * True when `candidate` resolves to `root` itself or something strictly
 * below it. Both are resolved first, so `..`, `.`, duplicate separators and
 * (on Windows) mixed separators are all normalised away before comparison;
 * the result is then compared segment-wise, not with `startsWith`.
 */
export function isContainedIn(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === resolvedRoot) {
    return true;
  }
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Extensions accepted for a voice-cloning reference sample (CdC §55). */
export const REFERENCE_AUDIO_EXTENSIONS: readonly string[] = [".wav", ".mp3", ".flac", ".ogg", ".opus", ".m4a"];

/** Hard cap on a reference sample, so a profile cannot point at a huge file. */
export const MAX_REFERENCE_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Anything below U+0020, DEL/C1, plus the Unicode bidi & invisible-format
 * ranges that make a path render as something other than what it is
 * (RIGHT-TO-LEFT OVERRIDE, zero-width joiners, BOM...).
 */
const DECEPTIVE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;

export type ReferenceAudioRejection =
  | "empty"
  | "too-long"
  | "deceptive-characters"
  | "unsupported-extension";

/**
 * Validates a profile's `tts.referenceAudio` *before* it is ever resolved
 * against a directory or read from disk.
 *
 * The threat is an imported profile (AC-SEC-05): `referenceAudio` is a path
 * the extension reads and uploads to the TTS endpoint, so an unconstrained
 * value turns "import a voice profile" into "read an arbitrary file and send
 * it to the configured server". Absolute paths stay legal (a user's own
 * recorded sample, `docs/voices.md`), and so does the shipped default's
 * checkout-relative `../deploy/tts/reference-audio/*.wav` — a `..` segment
 * is not itself the danger, since an absolute path is legal anyway. What is
 * refused is a deceptive character and, above all, any extension that is not
 * an audio one: that is what stops `~/.ssh/id_rsa` or a `.env` from being
 * read and uploaded. `ChatterboxProvider` re-checks the *resolved* path at
 * read time (symlink, regular file, size cap) — see `readReferenceAudio`.
 *
 * Returns `undefined` when the value is acceptable, or the reason it is not.
 */
export function rejectReferenceAudioPath(value: string): ReferenceAudioRejection | undefined {
  if (value.trim().length === 0) {
    return "empty";
  }
  if (value.length > 4096) {
    return "too-long";
  }
  if (DECEPTIVE_CHARS.test(value)) {
    return "deceptive-characters";
  }
  const extension = path.extname(value).toLowerCase();
  if (!REFERENCE_AUDIO_EXTENSIONS.includes(extension)) {
    return "unsupported-extension";
  }
  return undefined;
}

export function isSafeReferenceAudioPath(value: string): boolean {
  return rejectReferenceAudioPath(value) === undefined;
}

/**
 * The only shape a profile's `apiKeyRef` may take: `llmVoice.apiKey.<id>`,
 * exactly what `apiKeySecretKey()` produces.
 *
 * Without this, an imported profile can name *any* key in the extension's
 * `SecretStorage` and have its value sent as a `Bearer` token to the
 * profile's own `baseUrl` — i.e. import a profile, exfiltrate the user's
 * cloud API key (S6.1 audit, F-01).
 */
export const SAFE_API_KEY_REF = /^llmVoice\.apiKey\.[A-Za-z0-9._@-]{1,64}$/;

export function isSafeApiKeyRef(value: unknown): value is string {
  return typeof value === "string" && SAFE_API_KEY_REF.test(value);
}

/**
 * The extension allowlist as a pattern, so it survives the Zod → JSON
 * Schema generation (`scripts/generate-profile-schema.mjs`) and the editor
 * flags a bad `referenceAudio` while it is being typed. `.refine()`
 * predicates do not survive that conversion — a pattern does.
 */
export const REFERENCE_AUDIO_PATTERN = new RegExp(
  `\\.(${REFERENCE_AUDIO_EXTENSIONS.map((extension) => extension.slice(1)).join("|")})$`,
  "i"
);
