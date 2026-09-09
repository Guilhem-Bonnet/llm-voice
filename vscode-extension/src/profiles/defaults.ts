/**
 * The five voice profiles shipped out of the box (CdC §19, +1 for S7.1).
 * Every profile validates against `VoiceProfileSchema` (AC-SEC-05);
 * `profile.schema.test.ts` asserts that for the three narrated ones and
 * `DEFAULT_PROFILE` covers "Lecture fidèle" already (`src/core/profile.schema.ts`).
 *
 * The narrator binding on the three narrated profiles points at the default
 * local Ollama endpoint (`llmVoice.narrator.baseUrl`) and deliberately omits
 * `model`: it falls back to `llmVoice.narrator.model` (default `qwen2.5:7b`,
 * `Pipeline.narratorSettings`) rather than pinning a model per profile, so
 * changing the setting once retunes all three (S4.1, `OllamaNarrator`).
 */

import type { VoiceProfile } from "../core/profile.js";
import { DEFAULT_PROFILE } from "../core/profile.schema.js";
import { CHATTERBOX_LOCAL_PRESET } from "../tts/presets.js";

// ADR-005/CdC §28: `chatterbox` (native `POST /tts`), voice-cloned by
// default against the validated SIWIS-derived French reference — see the
// same note on `DEFAULT_PROFILE.tts` in `core/profile.schema.ts`.
const LOCAL_TTS = {
  providerId: "chatterbox",
  baseUrl: CHATTERBOX_LOCAL_PRESET.baseUrl,
  ...(CHATTERBOX_LOCAL_PRESET.referenceAudio !== undefined
    ? { referenceAudio: CHATTERBOX_LOCAL_PRESET.referenceAudio }
    : {}),
  ...(CHATTERBOX_LOCAL_PRESET.parameters !== undefined
    ? { parameters: { ...CHATTERBOX_LOCAL_PRESET.parameters } }
    : {}),
  format: "wav"
} as const;

const LOCAL_NARRATOR = {
  providerId: "ollama",
  baseUrl: "http://127.0.0.1:11434"
} as const;

/** "Lecture fidèle" (CdC §19): no transformation, sentence-level highlight. */
export const FAITHFUL_PROFILE: VoiceProfile = DEFAULT_PROFILE;

/**
 * "Voix système (aucune installation)" (S7.1, ADR-009 niveau 1b): the
 * first-launch default (`ProfileRepository.defaultCollection`) — reads with
 * whatever voice is already on the machine (`SystemTtsProvider`:
 * `espeak-ng`/Piper local/`say`/SAPI), no server, no network call, so a
 * fresh install produces sound immediately (the S7.1 user problem this
 * story exists to fix). `tts.baseUrl` is deliberately omitted:
 * `SystemTtsProvider` never makes a network call (its file header), there
 * is nothing to point it at.
 */
export const SYSTEM_VOICE_PROFILE: VoiceProfile = {
  id: "system-voice",
  label: "Voix système (aucune installation)",
  mode: "faithful",
  language: "fr-FR",
  tts: { providerId: "system" },
  chunking: { unit: "sentence", maxSentences: 3, prefetchChunks: 2 },
  playback: { rate: 1, volume: 1 },
  description:
    "Lecture fidèle avec la voix déjà installée sur votre système (espeak-ng, Piper local, say, SAPI…), " +
    "sans serveur ni configuration. « LLM Voice: Install Local Voice (Piper) » pour une meilleure qualité."
};

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

/**
 * The five profiles created in `profiles.json` on first launch (CdC §19,
 * +1 for S7.1). `SYSTEM_VOICE_PROFILE` comes first: it is
 * `ProfileRepository.defaultCollection`'s `defaultProfileId`, so a brand
 * new install reads with it before any other profile is ever selected.
 */
export const DEFAULT_PROFILES: readonly VoiceProfile[] = [
  SYSTEM_VOICE_PROFILE,
  FAITHFUL_PROFILE,
  TECHNICAL_TEACHER_PROFILE,
  LLM_SUMMARY_PROFILE,
  QUICK_REVIEW_PROFILE
];
