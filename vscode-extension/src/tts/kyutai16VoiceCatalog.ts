/**
 * The French voices of Kyutai TTS 1.6B (`kyutai/tts-1.6b-en_fr`), precomputed embeddings
 * from https://huggingface.co/kyutai/tts-voices, each with a first name chosen for this
 * bench (`scripts/voice-lab/voice-names.json`, `deploy/kyutai16/voices.json`).
 *
 * Kept apart from `kyutaiVoiceCatalog.ts`: another engine, another server, and no sample
 * in the VSIX, hence no `preview`. Camille comes first: guilhem-bonnet's choice of
 * 2026-11-06. `language` is `fr` because the recordings behind these voices are in French;
 * it says nothing of the accent.
 *
 * Licences as given by the choice above: CML-TTS CC BY 4.0, Estelle CC0.
 */

import type { Voice } from "../core/tts.js";

export const KYUTAI16_DEFAULT_VOICE = "cml-577_394";

/** Shown wherever these voices are offered. A given name says nothing of who speaks. */
export const KYUTAI16_VOICE_CAVEAT =
  "Enregistrements d'origine en français. L'accent et le consentement au clonage ne sont pas documentés : les prénoms sont un repère, pas une identité. Aucun échantillon n'est livré avec l'extension.";

const SOURCE = "https://huggingface.co/kyutai/tts-voices/tree/main";

function cml(speaker: string, label: string): Voice {
  return {
    id: `cml-${speaker}`,
    label,
    language: "fr",
    licence: {
      dataset: "CML-TTS (kyutai/tts-voices)",
      spdx: "CC-BY-4.0",
      sourceUrl: `${SOURCE}/cml-tts/fr`,
      attributionRequired: true
    }
  };
}

export const KYUTAI16_VOICE_CATALOG: readonly Voice[] = [
  cml("577_394", "Camille"),
  {
    id: "estelle",
    label: "Estelle",
    language: "fr",
    licence: {
      dataset: "Unmute (kyutai/tts-voices)",
      spdx: "CC0-1.0",
      sourceUrl: `${SOURCE}/unmute-prod-website`,
      attributionRequired: false
    }
  },
  cml("10087_11650", "Alex"),
  cml("10177_10625", "Alix"),
  cml("10179_11051", "Andréa"),
  cml("12080_11650", "Ange"),
  cml("12205_11650", "Ariel"),
  cml("12977_10625", "Charlie"),
  cml("1406_1028", "Dany"),
  cml("1591_1028", "Dominique"),
  cml("1770_1028", "Éden"),
  cml("2114_1656", "Élie"),
  cml("2154_2576", "Gaby"),
  cml("2216_1745", "Jordan"),
  cml("2223_1745", "Joss"),
  cml("2465_1943", "Kim"),
  cml("7601_7727", "Loan"),
  cml("296_1028", "Lou"),
  cml("3267_1902", "Louison"),
  cml("4193_3103", "Maé"),
  cml("9834_9697", "Maël"),
  cml("7762_8734", "Manu"),
  cml("4482_3103", "Maxime"),
  cml("4724_3731", "Mika"),
  cml("4937_3731", "Morgan"),
  cml("5207_3078", "Nat"),
  cml("5476_3103", "Noa"),
  cml("8128_7016", "Noam"),
  cml("5790_4893", "Paz"),
  cml("579_2548", "Robin"),
  cml("5830_4703", "Sacha"),
  cml("6318_7016", "Sam"),
  cml("7142_2432", "Swann"),
  cml("928_486", "Val"),
  cml("7400_2928", "Yaël"),
  cml("7591_6742", "Yannick")
];
