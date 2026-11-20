/**
 * The voice of the local Qwen3-TTS server (`deploy/qwen3/server.py`, `deploy/qwen3/voices.json`):
 * one frozen voice, cloned from two takes of the bench (essais 21 and 22), chosen by
 * guilhem-bonnet on 2026-11-07. No sample in the VSIX, hence no `preview`.
 */

import type { Voice } from "../core/tts.js";

export const QWEN3_DEFAULT_VOICE = "fr-essais-21-22";

/** Shown wherever this voice is offered. */
export const QWEN3_VOICE_CAVEAT =
  "Voix générée sur votre carte graphique par le service local Qwen3. Plus lente que l'écoute : toute la lecture est préparée avant le premier son, puis rien ne coupe.";

export const QWEN3_VOICE_CATALOG: readonly Voice[] = [
  {
    id: QWEN3_DEFAULT_VOICE,
    label: "Voix des essais 21 et 22",
    language: "fr"
  }
];
