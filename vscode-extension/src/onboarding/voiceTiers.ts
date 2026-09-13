/**
 * Pure data behind `LLM Voice: Setup Voice` (S7.2). Kept free of any
 * `vscode` import so it can run under plain-Node vitest (see
 * `vitest.config.ts`'s comment on what can/cannot be unit tested);
 * `SetupVoice.ts` is the thin `vscode`-wiring layer on top of this.
 */

import { CHATTERBOX_LOCAL_PRESET } from "../tts/presets.js";

export type VoiceTier = "system" | "piper" | "chatterbox";

export interface VoiceTierOption {
  tier: VoiceTier;
  /** Codicon-prefixed label for the Quick Pick (ADR-011: codicons only, no emoji). */
  label: string;
  /** Short, honest one-liner shown next to the label. */
  description: string;
  /** Longer explanation shown under the item. */
  detail: string;
}

/** Approximate download size of the default Piper voice (`fr_FR-siwis-medium`, `deploy/README.md`). */
export const PIPER_VOICE_SIZE_LABEL = "~60 Mo";

/**
 * Three entries, in the order the story asks for: what works right now,
 * the self-contained default (a small one-time download, no Docker, no
 * server), and the advanced tier that needs Docker. No entry claims more
 * than it delivers — the whole point of this command is to replace
 * "Chatterbox n'est pas installé" with an honest choice (S8.3: Chatterbox
 * is never the default and never named to a user who hasn't configured
 * it — it only appears here, behind its own explicit, clearly-labelled
 * "advanced" entry).
 */
export const VOICE_TIER_OPTIONS: readonly VoiceTierOption[] = [
  {
    tier: "system",
    label: "$(unmute) Voix système",
    description: "Disponible tout de suite — qualité correcte",
    detail: "Utilise la synthèse vocale déjà installée sur votre machine. Aucune installation, aucun téléchargement."
  },
  {
    tier: "piper",
    label: "$(cloud-download) Voix française autonome (recommandé)",
    description: `Meilleure qualité, 100 % locale — téléchargement de ${PIPER_VOICE_SIZE_LABEL}`,
    detail:
      "Modèle Piper (fr_FR-siwis-medium) téléchargé une seule fois, puis exécuté 100 % en local — aucun Docker, aucun serveur, aucun terminal."
  },
  {
    tier: "chatterbox",
    label: "$(rocket) Qualité maximale (avancé — nécessite Docker)",
    description: "Clonage de voix, la plus naturelle — nécessite Docker",
    detail: "Démarre un service Chatterbox local via Docker Compose. La voix la plus naturelle, au prix d'une installation Docker."
  }
];

/** The compose command shown/copied for the Chatterbox option (S7.2 story). */
export const CHATTERBOX_COMPOSE_COMMAND = "docker compose -f deploy/docker-compose.tts.yml up -d chatterbox";

export const CHATTERBOX_DOCS_URL =
  "https://github.com/Guilhem-Bonnet/llm-voice/blob/main/docs/install-linux.md";

/** Shown for the "system" tier: `SystemTtsProvider` (S7.1) already works with no setup. */
export const SYSTEM_VOICE_READY_MESSAGE =
  "LLM Voice : la voix système est déjà prête — aucune installation nécessaire.";

/**
 * `llmVoice.installPiperVoice` (S7.1, `src/commands/index.ts` — registered
 * unconditionally, both PRs land together): the real command the "piper"
 * tier delegates to. Fixed real value, not a tier-parameterised command —
 * S7.1 shipped one Piper-install command with no arguments, not a generic
 * "install this tier" entry point, so "system" never calls it (it has
 * nothing to install, see `SYSTEM_VOICE_READY_MESSAGE` above).
 */
export const INSTALL_PIPER_VOICE_COMMAND = "llmVoice.installPiperVoice";

/**
 * Bug fix (voice-selection-not-applied / infinite loop, real user report
 * 2026-09-12, `_grimoire/_memory/shared-context.md`): before this fix,
 * `handleVoiceTier` picked a tier's install path (or showed the "already
 * ready" message) but never wrote anything to `profiles.json`
 * (`grep -rn "providerId" src/onboarding/*.ts` returned nothing) — choosing
 * a voice from `Setup Voice` changed *nothing* about which provider the
 * active profile actually resolved to, so the very next `Speak` failed
 * exactly the same way, forever ("Boucle infinie", the reported symptom).
 *
 * The concrete `tts` binding each tier resolves to, applied to the active
 * profile by `Pipeline.applyVoiceTierChoice` right after the Quick Pick
 * choice (never deferred to "once Docker/the download finishes" — the
 * choice itself, not its installation outcome, is what a profile must
 * record, exactly like `browseVoices()`/`applyVoiceToProfileById` already
 * do for an explicit voice):
 *
 *  - `"system"` and `"piper"` both resolve to `providerId: "system"`
 *    (`SystemTtsProvider`, S7.1) — "piper" only changes *which engine*
 *    `SystemTtsProvider.detectEngine()` finds on this machine (Piper once
 *    installed vs. `espeak-ng`/`say`/SAPI), never which provider class the
 *    profile names; `SystemTtsProvider` needs no `baseUrl`/`voice` at all
 *    (its own file header — it picks and reports its own engine).
 *  - `"chatterbox"` resolves to `providerId: "chatterbox"` at
 *    `CHATTERBOX_LOCAL_PRESET.baseUrl` — set immediately, without waiting
 *    for the Docker container the user may not have started yet (starting
 *    it is exactly what the compose command instructs); `voice` is
 *    deliberately left unset here — `Pipeline.withDefaultVoice` (bug fix,
 *    same trace) resolves a concrete one from `listVoices()` at synthesis
 *    time, once the server can actually be asked, rather than this
 *    offline decision guessing at a voice ID that might not exist on this
 *    server build.
 */
export interface TtsTierBinding {
  providerId: string;
  baseUrl?: string;
}

export function ttsBindingForTier(tier: VoiceTier): TtsTierBinding {
  switch (tier) {
    case "system":
    case "piper":
      return { providerId: "system" };
    case "chatterbox":
      return { providerId: "chatterbox", baseUrl: CHATTERBOX_LOCAL_PRESET.baseUrl };
  }
}
