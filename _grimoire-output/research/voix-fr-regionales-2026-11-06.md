# Voix françaises par région : état des preuves (2026-11-06)

Recherche en lecture seule, rien n'a été écouté ni téléchargé. Sources citées : API et README Hugging Face (`kyutai/tts-voices`, `kyutai/pocket-tts`, `kyutai/pocket-tts-without-voice-cloning`), `rhasspy/piper-voices/voices.json` et ses cartes, `hexgrad/Kokoro-82M`, OpenSLR 146, `espeak-ng --voices=fr`, code local `pocket_tts`.

| Source | Région documentée | Voix | Licence | Accès | Utilisable |
|---|---|---|---|---|---|
| Pocket TTS, voix prédéfinies | non documentée, sauf Estelle (français, Kyutai) | 27 dont 20 retenues | par voix | public | oui |
| `tts-voices/cml-tts/fr` (WAV, LibriVox) | non documentée | 35 | CC BY 4.0 | clonage par le dépôt à accès restreint | à tester : export manuel en `.safetensors`, redistribution non tranchée |
| `tts-voices/voice-donations` (WAV) | aucune métadonnée, noms libres | 228 | CC0 | idem | à tester, sans accent déclaré |
| Piper `fr_FR` : gilles, mls (125 locuteurs), mls_1840, siwis, tom, upmc | France (code de langue) | 7 modèles | CC0, CC BY 4.0, CC BY-SA 4.0 (upmc), AGPLv3 (tom) | public | oui, hors tom à examiner |
| Piper `fr_CA`, `fr_BE`, `fr_CH` | | 0 | | | non |
| Kokoro `ff_siwis` | non documentée | 1 | Apache-2.0 | public | à tester |
| espeak-ng `fr-be`, `fr-ch`, `fr-canadian-mbrola` | code de variante | 1, 1, 2 | non vérifiée | local | oui, rendu supposé robotique |
| Common Voice FR | accent auto-déclaré, champ libre peu fiable | milliers | CC0 du projet, sans consentement au clonage | Mozilla Data Collective, fiche non lue | à tester |
| CommissionsQC, CEREALES | Québec d'après les titres | non vérifié | non vérifiée | non vérifié | non vérifié |

Les `.safetensors` de `tts-voices` visent le modèle 1.6B, pas Pocket TTS (code `tts_model.py`, non essayé).

**Conclusion** : aucune voix québécoise, belge ou suisse naturelle, à licence et accent prouvés, n'est disponible aujourd'hui. Voie sûre : enregistrements de volontaires avec consentement écrit. Une voix n'est étiquetée qu'avec preuve documentaire et écoute à l'aveugle par des auditeurs natifs ; un classifieur n'est qu'un indice. Une licence de corpus ne vaut pas consentement au clonage.

**Champs utiles du catalogue** : langue, région déclarée, région vérifiée et méthode, source, jeu de données, licence, attribution, consentement, qualité, taille, empreinte, accès, statut, réserves.
