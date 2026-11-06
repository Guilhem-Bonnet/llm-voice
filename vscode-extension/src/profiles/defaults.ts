/**
 * The four reading modes shipped out of the box (CdC §19, ADR-017 §2). Every one
 * validates against `VoiceProfileSchema` (AC-SEC-05) and inherits the global
 * voice (`tts: {}`, ADR-017 §1.3): who speaks lives in `global-voice.json`, and a
 * new install starts on the system voice (`INITIAL_GLOBAL_VOICE`).
 *
 * The narrator binding on the three narrated profiles points at the default
 * local Ollama endpoint (`llmVoice.narrator.baseUrl`) and deliberately omits
 * `model`: it falls back to `llmVoice.narrator.model` (default `qwen2.5:7b`,
 * `Pipeline.narratorSettings`) rather than pinning a model per profile, so
 * changing the setting once retunes all three (S4.1, `OllamaNarrator`).
 */

import type { VoiceProfile } from "../core/profile.js";

const LOCAL_NARRATOR = {
  providerId: "ollama",
  baseUrl: "http://127.0.0.1:11434"
} as const;

/** "Fidèle" (CdC §19): no transformation, sentence-level highlight. */
export const FAITHFUL_PROFILE: VoiceProfile = {
  id: "faithful-local",
  label: "Fidèle",
  mode: "faithful",
  language: "fr-FR",
  tts: {},
  chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
  playback: { rate: 1, volume: 1 },
  description: "Lit le texte tel qu'il est écrit, sans réécriture."
};

/**
 * What a new install speaks with, no server and no configuration (S7.1, ADR-009
 * niveau 1b, ADR-017 §2): `SystemTtsProvider` finds `espeak-ng`, Piper, `say` or
 * SAPI, and never makes a network call. `speed` is the voice's own factor.
 */
export const INITIAL_GLOBAL_VOICE = { providerId: "system", speed: 1 } as const;

/** "Professeur" (CdC §19): pedagogical rewrite, block highlight. */
export const TECHNICAL_TEACHER_PROFILE: VoiceProfile = {
  id: "technical-teacher",
  label: "Professeur",
  mode: "narrated",
  language: "fr-FR",
  tts: {},
  narrator: { ...LOCAL_NARRATOR },
  chunking: { unit: "block", maxSentences: 3, prefetchChunks: 2 },
  playback: { rate: 1, volume: 1 },
  description: "Explication orale pédagogique, avec analogies quand elles aident.",
  style:
    "Transforme la section en explication orale pédagogique et naturelle. " +
    "Ne donne jamais l'impression de lire des notes. Conserve tous les concepts " +
    "importants. Explique le code plutôt que d'en réciter la syntaxe. Ajoute des " +
    "analogies lorsqu'elles améliorent réellement la compréhension."
};

/** "Résumé" (CdC §19): oral summary of an agent's response. */
export const LLM_SUMMARY_PROFILE: VoiceProfile = {
  id: "llm-summary",
  label: "Résumé",
  mode: "narrated",
  language: "fr-FR",
  tts: {},
  narrator: { ...LOCAL_NARRATOR },
  chunking: { unit: "block", maxSentences: 3, prefetchChunks: 2 },
  playback: { rate: 1, volume: 1 },
  description: "Résumé oral façon collègue développeur : fait, limites, reste à faire.",
  style:
    "Présente oralement le résultat comme un collègue développeur. Commence par " +
    "ce qui a été réalisé. Mentionne les problèmes ou limitations. Termine par ce " +
    "qu'il reste éventuellement à faire. Sois concis et naturel."
};

/** "Révision" (CdC §19): keep only what matters for a quick review. */
export const QUICK_REVIEW_PROFILE: VoiceProfile = {
  id: "quick-review",
  label: "Révision",
  mode: "narrated",
  language: "fr-FR",
  tts: {},
  narrator: { ...LOCAL_NARRATOR },
  chunking: { unit: "block", maxSentences: 3, prefetchChunks: 2 },
  playback: { rate: 1.1, volume: 1 },
  description: "Ne garde que les concepts, pièges et éléments essentiels à retenir.",
  style:
    "Transforme le contenu en révision orale. Conserve uniquement les concepts, " +
    "pièges et éléments essentiels à retenir."
};

/** The modes created in `profiles.json` on first launch; `FAITHFUL_PROFILE` is the default. */
export const DEFAULT_PROFILES: readonly VoiceProfile[] = [
  FAITHFUL_PROFILE,
  TECHNICAL_TEACHER_PROFILE,
  LLM_SUMMARY_PROFILE,
  QUICK_REVIEW_PROFILE
];
