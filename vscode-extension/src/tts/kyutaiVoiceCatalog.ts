/**
 * ADR-016 §4: the Kyutai Pocket TTS voices this extension offers, each with
 * its source and licence, read on 2026-11-05 from
 * https://huggingface.co/kyutai/tts-voices/raw/main/README.md and the voice
 * list of https://huggingface.co/kyutai/pocket-tts-without-voice-cloning.
 *
 * Left out on purpose:
 *  - `cosette`, `jean`: CC BY-NC 4.0 (Expresso, EARS).
 *  - `giovanni`, `lola`, `juergen`, `rafael`, `daan`: no licence found for
 *    their files; add one here only once a licence text has been read.
 *
 * `language` is `fr` because every entry was measured speaking French on a
 * server started with `--language french` (transcription error at most 7 %
 * on one test sentence, 2026-11-05). It says nothing about accent or quality.
 */

import type { Voice, VoiceLicence } from "../core/tts.js";

const TTS_VOICES = "https://huggingface.co/kyutai/tts-voices/blob/main";

function voice(
  id: string,
  label: string,
  dataset: VoiceLicence["dataset"],
  licence: "CC0-1.0" | "CC-BY-4.0",
  file: string
): Voice {
  return {
    id,
    label,
    language: "fr",
    preview: `voices/${id}.ogg`,
    licence: {
      dataset,
      spdx: licence,
      sourceUrl: `${TTS_VOICES}/${file}`,
      attributionRequired: licence === "CC-BY-4.0"
    }
  };
}

function vctk(id: string, label: string, speaker: string): Voice {
  return voice(id, label, "VCTK", "CC-BY-4.0", `vctk/${speaker}_023_enhanced.wav`);
}

function voiceZero(id: string, label: string): Voice {
  return voice(id, label, "Voice Zero (LibriVox)", "CC0-1.0", `voice-zero/${id}.wav`);
}

export const KYUTAI_POCKET_VOICE_CATALOG: readonly Voice[] = [
  voice("estelle", "Estelle", "Unmute (Kyutai)", "CC0-1.0", "unmute-prod-website/developpeuse-3.wav"),
  voice("alba", "Alba", "Alba MacKenna", "CC-BY-4.0", "alba-mackenna/casual.wav"),
  vctk("anna", "Anna", "p228"),
  vctk("azelma", "Azelma", "p303"),
  voiceZero("bill_boerst", "Bill Boerst"),
  voiceZero("caro_davy", "Caro Davy"),
  vctk("charles", "Charles", "p254"),
  vctk("eponine", "Éponine", "p262"),
  vctk("eve", "Eve", "p361"),
  vctk("fantine", "Fantine", "p244"),
  vctk("george", "George", "p315"),
  vctk("jane", "Jane", "p339"),
  voice("javert", "Javert", "Dons de voix Unmute", "CC0-1.0", "voice-donations/Butter.wav"),
  voice("marius", "Marius", "Dons de voix Unmute", "CC0-1.0", "voice-donations/Selfie.wav"),
  vctk("mary", "Mary", "p333"),
  vctk("michael", "Michael", "p360"),
  vctk("paul", "Paul", "p259"),
  voiceZero("peter_yearsley", "Peter Yearsley"),
  voiceZero("stuart_bell", "Stuart Bell"),
  vctk("vera", "Vera", "p229")
];
