# Voix de référence (clonage Chatterbox, CdC §55)

Les 28 voix prédéfinies du serveur sont anglophones (accent perceptible en
français, `docs/e2e/report-2026-09-08.md`). Référence par défaut, validée
par retour utilisateur : extrait **SIWIS** (voix féminine jeune, studio),
`POST /tts`, `voice_mode: "clone"`, `language: "fr"`, `exaggeration: 0.4`,
`cfg_weight: 0.5`, `temperature: 0.6` — meilleur résultat testé face à une
référence Piper synthétique ou LibriVox.

## Sources et licences

- **SIWIS French Speech Synthesis Database** (Yamagishi et al., University
  of Edinburgh CSTR), **CC BY 4.0**. Extrait : 5 phrases
  (`wavs/part1/neut_parl_s01_{0106,0112,0304,0310,0338}.wav`, ~12,6 s),
  concaténées, 24 kHz mono, via le miroir HF
  `Aviv-anthonnyolime/SIWIS_French_Speech_Synthesis_Database`. Original :
  <https://datashare.ed.ac.uk/items/1de74991-eede-4b48-8fbe-6c2abaed88d8>.
- **Piper `fr_FR-siwis-medium`** (rhasspy/piper-voices, MIT) : alternative
  synthétique (`deploy/piper/`, niveau 1b ADR-009), même locutrice SIWIS.
- **LibriVox — *Les anciens canadiens*** (domaine public) : testée, écartée (timbre perçu trop âgé).

## Utiliser sa propre voix (recommandé)

```bash
pw-record --rate 24000 --channels 1 ~/.llm-voice/voices/ma-voix.wav   # 15 s, Ctrl-C
docker cp ~/.llm-voice/voices/ma-voix.wav deploy-chatterbox-1:/app/reference_audio/
# POST /tts avec voice_mode="clone", reference_audio_filename="ma-voix.wav"
```

N'utiliser que sa propre voix ou une voix avec accord explicite (CdC §55).
