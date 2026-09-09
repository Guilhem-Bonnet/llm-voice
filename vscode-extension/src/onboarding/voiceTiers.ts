/**
 * Pure data behind `LLM Voice: Setup Voice` (S7.2). Kept free of any
 * `vscode` import so it can run under plain-Node vitest (see
 * `vitest.config.ts`'s comment on what can/cannot be unit tested);
 * `SetupVoice.ts` is the thin `vscode`-wiring layer on top of this.
 */

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
 * what's better with a small download, what's best but needs Docker. No
 * entry claims more than it delivers — the whole point of this command is
 * to replace "Chatterbox n'est pas installé" with an honest choice.
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
    label: "$(cloud-download) Voix locale Piper",
    description: `Meilleure qualité — téléchargement de ${PIPER_VOICE_SIZE_LABEL}`,
    detail: "Modèle Piper (fr_FR-siwis-medium) téléchargé une seule fois, puis exécuté 100 % en local."
  },
  {
    tier: "chatterbox",
    label: "$(rocket) Chatterbox",
    description: "Meilleure qualité, clonage de voix — nécessite Docker",
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
