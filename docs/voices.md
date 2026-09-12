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

Ligne de commande (référence historique) :

```bash
pw-record --rate 24000 --channels 1 ~/.llm-voice/voices/ma-voix.wav   # 15 s, Ctrl-C
docker cp ~/.llm-voice/voices/ma-voix.wav deploy-chatterbox-1:/app/reference_audio/
# POST /tts avec voice_mode="clone", reference_audio_filename="ma-voix.wav"
```

Depuis l'extension (S8.2, CdC §55) : `LLM Voice: Use My Own Voice`, un assistant
en trois étapes.

1. **Consentement** : rappel explicite — n'utiliser que sa propre voix, ou une
   voix avec accord explicite. Aucune donnée ne quitte la machine ; le fichier
   n'est jamais envoyé ailleurs qu'au serveur TTS déjà configuré en local.
2. **Fichier existant ou enregistrement** : `showOpenDialog` (WAV/MP3/FLAC/OGG/OPUS/M4A,
   10 à 30 s conseillé), ou la commande d'enregistrement adaptée à la
   plateforme, copiée dans le presse-papiers et surveillée jusqu'à
   apparition du fichier :
   - Linux : `pw-record --rate 24000 --channels 1 <chemin>` (repli `arecord -f S16_LE -r 24000 -c 1 <chemin>`)
   - macOS : `ffmpeg -f avfoundation -i ":0" -ar 24000 -ac 1 <chemin>`
   - Windows : `ffmpeg -f dshow -i audio="Microphone" -ar 24000 -ac 1 <chemin>`
3. **Validation et application** : lecture d'en-tête WAV (durée, mono/stéréo,
   niveau non silencieux — `src/core/audioValidation.ts`), conversion en WAV
   24 kHz mono via `ffmpeg` si disponible (sinon le fichier original est
   conservé, avec avertissement), copie dans `globalStorageUri/voices/`,
   `profile.tts.referenceAudio` mis à jour, extrait de test joué
   immédiatement avec la voix clonée.

## Parcourir les voix

`LLM Voice: Browse Voices` (CdC §72) liste les voix du provider TTS actif
(`TtsProvider.listVoices()`), avec un bouton d'écoute immédiate par voix
(synthèse de la phrase de test + lecture, sans quitter la liste). La langue
déclarée est affichée quand le provider la fournit, et une voix anglophone
est signalée (`$(warning) voix anglophone`) quand le profil édité n'est pas
en anglais — exactement le piège documenté plus haut (Accent français).
Sélectionner une voix l'applique et la sauvegarde sur le profil courant.
Fonctionne avec Chatterbox, Kokoro, Piper et la voix système.

N'utiliser que sa propre voix ou une voix avec accord explicite (CdC §55).
