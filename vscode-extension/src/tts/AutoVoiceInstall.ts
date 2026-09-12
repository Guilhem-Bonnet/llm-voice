/**
 * S8.3 (ADR-009 amendment, "no Docker by default"): the decision logic
 * behind the *first* `Speak` when no local voice has ever been set up.
 *
 * Before S8.3, a fresh install's first `Speak` reached
 * `SystemTtsProvider.synthesize()`, which threw once no engine was found
 * (no Piper install, no `espeak-ng`); that failure surfaced three chunks
 * later, after `AudioQueue`'s retries, as the generic three-button
 * "aucune voix configurée" dialog (`ui/notifications.ts`) — technically
 * actionable ("Choisir une voix" opens `Setup Voice`), but slower than it
 * needs to be and never offers to just fix the problem on the spot.
 *
 * `Pipeline` now checks *before* building a session whether the resolved
 * provider is `SystemTtsProvider` with `health().status === "unreachable"`
 * (`SystemTtsProvider` found no engine at all) **or** `health().endpoint
 * === "local:espeak-ng"` (bug fix, voice-selection-not-applied point 2:
 * `SystemTtsProvider` found *only* espeak-ng — Piper must prime over
 * espeak-ng, so this still counts as "offer the better voice" rather than
 * "already fine", even though `status` is `"ok"`). `say`/SAPI — already the
 * best available voice on their platforms — never trigger this, and once
 * Piper itself is the detected engine (`endpoint: "local:piper"`) neither
 * does that. Only then does `Pipeline` offer exactly **one** action:
 * install the autonomous French voice (Piper). Accepting resumes the
 * original request automatically; declining or a failed download falls
 * back immediately to whatever `SystemTtsProvider` already found (espeak-ng
 * included) via one honest, non-modal message — never blocking, never the
 * old three-branch dialog, never Chatterbox's name (`installOutcomeMessage`
 * below never mentions it).
 *
 * Every function here is pure — no `vscode` import — exactly the
 * `voiceTiers.ts`/`handleVoiceTier.ts` split this file mirrors, so the
 * decision logic is unit-testable without a Window.
 */

import type { ProviderHealth } from "../core/health.js";
import { presetKindForProviderId } from "./presets.js";
import type { PiperInstallConsentDetails, PiperInstallOutcome } from "./PiperSetup.js";

/** The single action label shown on the one-button install prompt. */
export const INSTALL_VOICE_ACTION_LABEL = "Installer la voix française";

/**
 * `true` when the resolved provider is `SystemTtsProvider` (ADR-009 §"1b")
 * and either:
 *  - it reports no usable engine at all (`status: "unreachable"` — the
 *    original situation this module was written for), or
 *  - bug fix (voice-selection-not-applied, point 2): it found *only*
 *    `espeak-ng` (`endpoint: "local:espeak-ng"`) — Piper must prime over
 *    espeak-ng, so a machine where espeak-ng answers "ok" is still offered
 *    the one-action Piper install instead of being silently left on the
 *    noticeably more robotic voice forever. `SystemTtsProvider.detectEngine`
 *    already tries Piper *before* espeak-ng (its own file header) — reaching
 *    `"local:espeak-ng"` here means Piper genuinely was not found (or was
 *    already declined this session, `Pipeline.ensureVoiceReady`'s own
 *    short-circuit — this function is never even called again then).
 * Every other "ok"/"degraded" engine (`piper` itself, `say`, `sapi` — the
 * best already-available voice on their respective platforms) never
 * triggers this. `resolvedProviderId` is whatever
 * `resolveTtsProviderConfig`/`autoSelectTts` settled on (`"auto"` is never
 * seen here — always already expanded to a concrete id).
 */
export function shouldOfferAutoVoiceInstall(resolvedProviderId: string, health: ProviderHealth): boolean {
  if (presetKindForProviderId(resolvedProviderId) !== "system") {
    return false;
  }
  return health.status === "unreachable" || health.endpoint === "local:espeak-ng";
}

/**
 * One informational message naming the real download size (from
 * `PiperInstallConsentDetails`, the same figures `LLM Voice: Install Local
 * Voice (Piper)` already shows) and exactly one button — never a
 * three-branch dialog, never an approximate/hardcoded size.
 */
export function formatAutoVoiceInstallPrompt(details: PiperInstallConsentDetails): string {
  const totalMb = Math.round(details.totalBytes / (1024 * 1024));
  return (
    `LLM Voice : aucune voix locale n'est installée. Installer la voix française « ${details.voiceId} » ` +
    `(~${totalMb} Mo, une seule fois, licence ${details.piperLicense}) ?`
  );
}

export type AutoVoiceInstallResult = "resumed" | "fallback";

/** `"resumed"` only for `outcome.status === "installed"` — every other outcome (declined, unsupported platform, or a failed/offline download) is an honest, silent-ish fallback, never a retry loop. */
export function nextActionFor(outcome: PiperInstallOutcome): AutoVoiceInstallResult {
  return outcome.status === "installed" ? "resumed" : "fallback";
}

/**
 * The one non-modal message shown when `nextActionFor` returns
 * `"fallback"` — deliberately never names Chatterbox (CdC/S8.3: "le
 * message d'erreur ne doit jamais nommer Chatterbox à quelqu'un qui ne
 * l'a pas configuré") and never leaves the user without a next step
 * (`Setup Voice` is still one command away).
 */
export function fallbackMessageFor(outcome: PiperInstallOutcome): string {
  switch (outcome.status) {
    case "declined":
      return "LLM Voice : voix non installée — la voix système sera utilisée si votre système en fournit une.";
    case "unsupported-platform":
      return "LLM Voice : la voix française téléchargeable n'est pas proposée pour cette plateforme ou architecture — la voix système reste disponible si votre système en fournit une.";
    case "failed":
      return `LLM Voice : téléchargement de la voix impossible (${outcome.message}) — la voix système sera utilisée si votre système en fournit une.`;
    case "installed":
      // Never reached (nextActionFor returns "resumed" for this case) —
      // exhaustive switch kept so a new PiperInstallOutcome variant fails
      // to compile here instead of silently falling through.
      return "";
  }
}
