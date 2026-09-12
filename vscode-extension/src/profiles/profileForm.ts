/**
 * Pure validation glue between the profile editor webview (S8.2, CdC §49)
 * and `VoiceProfileSchema` (AC-SEC-05): the webview only ever sends back a
 * plain object over `postMessage`, and this is where it gets checked before
 * `ProfileRepository.update()` ever sees it — with messages a human can act
 * on, not a raw Zod stack trace.
 *
 * No `vscode` import: `ProfileEditorPanel.ts` is the wiring layer around
 * this, exactly like `onboarding/voiceTiers.ts` / `handleVoiceTier.ts`.
 */

import type { ZodError } from "zod";
import type { VoiceProfile } from "../core/profile.js";
import { VoiceProfileSchema } from "../core/profile.schema.js";

export type ProfileValidationResult =
  | { ok: true; profile: VoiceProfile }
  | { ok: false; errors: readonly string[] };

/** One issue as `"chemin : message"`, or just the message when the issue has no path (top-level). */
export function formatZodIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path.length > 0 ? `${path} : ${issue.message}` : issue.message;
  });
}

/**
 * Validates a candidate profile coming back from the editor webview.
 * `unknown` in, never `as VoiceProfile` — same discipline as
 * `parseVoiceProfile`/`ProfileRepository.import`, applied to a hand-edited
 * form instead of an imported file.
 */
export function validateProfileFormData(data: unknown): ProfileValidationResult {
  const parsed = VoiceProfileSchema.safeParse(data);
  if (parsed.success) {
    return { ok: true, profile: parsed.data as VoiceProfile };
  }
  return { ok: false, errors: formatZodIssues(parsed.error) };
}
