/**
 * The four voice profiles shipped out of the box (CdC §19). Every profile
 * validates against `VoiceProfileSchema` (AC-SEC-05); `profile.schema.test.ts`
 * asserts that for the three narrated ones and `DEFAULT_PROFILE` covers
 * "Lecture fidèle" already (`src/core/profile.schema.ts`).
 *
 * The narrator binding on the three narrated profiles points at the default
 * local Ollama endpoint (`llmVoice.narrator.baseUrl`); no `NarratorProvider`
 * is registered in this slice (S3.5 keeps `NoNarrator`, phase 4 wires
 * `OllamaNarrator`), so `SessionFactory.buildSession` degrades every one of
 * them to faithful reading automatically (`narrator === undefined` short-
 * circuits `narrationEnabled`, ADR-005) — selecting them today changes
 * nothing audible yet, but they are ready for phase 4 without another schema
 * change.
 */

import type { VoiceProfile } from "../core/profile.js";
import { DEFAULT_PROFILE } from "../core/profile.schema.js";

const LOCAL_TTS = {
  providerId: "openai-compatible",
  baseUrl: "http://127.0.0.1:8004",
  model: "chatterbox",
  voice: "default",
  format: "wav"
} as const;

const LOCAL_NARRATOR = {
  providerId: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "llama3.1"
} as const;

/** "Lecture fidèle" (CdC §19): no transformation, sentence-level highlight. */
export const FAITHFUL_PROFILE: VoiceProfile = DEFAULT_PROFILE;

/** "Professeur technique" (CdC §19): pedagogical rewrite, block highlight. */
export const TECHNICAL_TEACHER_PROFILE: VoiceProfile = {
  id: "technical-teacher",
  label: "Professeur technique",
  mode: "narrated",
  language: "fr-FR",
  tts: { ...LOCAL_TTS },
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

/** "Résumé LLM" (CdC §19): oral summary of an agent's response. */
export const LLM_SUMMARY_PROFILE: VoiceProfile = {
  id: "llm-summary",
  label: "Résumé LLM",
  mode: "narrated",
  language: "fr-FR",
  tts: { ...LOCAL_TTS },
  narrator: { ...LOCAL_NARRATOR },
  chunking: { unit: "block", maxSentences: 3, prefetchChunks: 2 },
  playback: { rate: 1, volume: 1 },
  description: "Résumé oral façon collègue développeur : fait, limites, reste à faire.",
  style:
    "Présente oralement le résultat comme un collègue développeur. Commence par " +
    "ce qui a été réalisé. Mentionne les problèmes ou limitations. Termine par ce " +
    "qu'il reste éventuellement à faire. Sois concis et naturel."
};

/** "Révision rapide" (CdC §19): keep only what matters for a quick review. */
export const QUICK_REVIEW_PROFILE: VoiceProfile = {
  id: "quick-review",
  label: "Révision rapide",
  mode: "narrated",
  language: "fr-FR",
  tts: { ...LOCAL_TTS },
  narrator: { ...LOCAL_NARRATOR },
  chunking: { unit: "block", maxSentences: 3, prefetchChunks: 2 },
  playback: { rate: 1.1, volume: 1 },
  description: "Ne garde que les concepts, pièges et éléments essentiels à retenir.",
  style:
    "Transforme le contenu en révision orale. Conserve uniquement les concepts, " +
    "pièges et éléments essentiels à retenir."
};

/** The four profiles created in `profiles.json` on first launch (CdC §19). */
export const DEFAULT_PROFILES: readonly VoiceProfile[] = [
  FAITHFUL_PROFILE,
  TECHNICAL_TEACHER_PROFILE,
  LLM_SUMMARY_PROFILE,
  QUICK_REVIEW_PROFILE
];
