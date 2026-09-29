# Voix françaises de référence libres de droits pour le clonage (2026-09-29, carte GAO-veille-moteu-001)

« non vérifié » = non trouvé en source primaire. Point clé : une licence de corpus (CC0, CC-BY, domaine public) porte sur le droit d'auteur de l'enregistrement, PAS sur le droit à la voix/personnalité ni sur le consentement au clonage. Aucune des sources ci-dessous ne mentionne le clonage : à traiter comme un risque résiduel, pas comme réglé (non vérifié juridiquement).

| Source | Licence | Qualité / métadonnées | Durée et locuteurs | Risques |
|---|---|---|---|---|
| **Common Voice FR v25** https://datacollective.mozillafoundation.org/datasets/cmn5zugst00w3nv07upovf2bg | CC0 | Micros de contributeurs, qualité hétérogène ; âge/genre/accent **auto-déclarés et facultatifs** (âge renseigné pour 20,9 % des locuteurs) | 1 209,71 h, 21 003 locuteurs, clips ~5 s | Contributeurs n'ont pas consenti au clonage (non vérifié) ; peu de durée par personne ; bruit |
| **MLS français** https://www.openslr.org/94/ (article https://arxiv.org/pdf/2012.03411) | CC BY 4.0 (attribution) | Lecture d'audiobooks LibriVox, 16 kHz ; métadonnées locuteur : non vérifié dans la page | 1 076,58 h, 142 lecteurs, 157 livres (résumé tiers du jeu de données HF) | Lecteurs bénévoles non consultés sur le clonage ; 16 kHz limite |
| **CML-TTS FR** https://www.openslr.org/146/ | CC BY 4.0 | LibriVox, 24 kHz, conçu pour la synthèse | Durée/locuteurs FR : non vérifié ; Kyutai en tire des voix FR (https://huggingface.co/kyutai/tts-voices) | Idem LibriVox |
| **M-AILABS FR** https://www.caito.de/2019/01/03/the-m-ailabs-speech-dataset/ | Licence M-AILABS (BSD-3 adaptée) ; audio LibriVox en domaine public (https://github.com/i-celeste-aurora/m-ailabs-dataset) | Livres audio, peu de locuteurs distincts | 190 h 30 min | Peu de variété ; LibriVox |
| **LibriVox** (source amont) https://librivox.org | Domaine public (page officielle inaccessible pendant la passe : statut confirmé seulement via les jeux dérivés ci-dessus) | Qualité variable ; lecteurs identifiables nommément ; âge/genre non structurés | Choix libre du lecteur, dizaines d'heures possibles | **Voix de personnes réelles, identifiables** : domaine public du texte/enregistrement n'implique pas consentement au clonage |
| **SIWIS** https://datashare.ed.ac.uk/handle/10283/2353 | Non vérifié (page non chargée) | Voix pro, propre ; c'est la base de `fr_FR-siwis` | ~9 750 énoncés, une locutrice professionnelle | Une seule voix |
| **CSS10 FR** https://www.isca-archive.org/interspeech_2019/park19c_interspeech.pdf | Non vérifié | Mono-locuteur, LibriVox | non vérifié | Une seule voix |
| **VoxPopuli, SynPaFlex** | Non vérifié dans cette passe | VoxPopuli = débats du Parlement européen (non vérifié) ; SynPaFlex = livres audio d'un lecteur pro (non vérifié) | — | Personnes identifiables |
| **Unmute Voice Donation (Kyutai)** https://huggingface.co/kyutai/tts-voices | **CC0**, dons explicites, 228 voix vérifiées sur 374 propositions (juin 2025-fév. 2026) | Voix déjà préparées, versions nettoyées `_enhanced` ; langues précises des 228 : non vérifié | 228 voix | Le seul lot avec **consentement explicite** ; usage cadré à ce projet (à relire sur la page) |
| **Voix intégrées Pocket TTS** https://github.com/kyutai-labs/pocket-tts | Licence par voix (https://huggingface.co/kyutai/tts-voices) ; CC-BY-NC pour Expresso/EARS, CC-BY pour VCTK et CML-TTS | 23+ voix, plusieurs langues | — | Vérifier voix par voix avant redistribution |

## Méthode pour 10 à 15 voix propres et consenties
1. Cahier des charges : grille de 12 à 15 cases (âge : enfant/jeune/adulte/âgé ; genre ; timbre : clair, grave, rauque ; rôle : narrateur grave, etc.).
2. Amorce sans risque : puiser d'abord dans les lots à consentement explicite (voix données CC0 de Kyutai) et les voix prédéfinies des moteurs ; y ajouter des voix issues de Common Voice (CC0) filtrées par métadonnées d'âge/genre déclarés.
3. Combler les cases manquantes (voix âgée, enfant, rauque) par : (a) la **conception de voix par description** (Qwen3-TTS VoiceDesign, Parler-TTS) qui n'imite personne ; (b) des **enregistrements de proches ou de comédiens volontaires** avec un consentement écrit précisant : usage (clonage local dans LLM Voice), durée, redistribution ou non, retrait. Pour un enfant : consentement d'un parent.
4. Extraction : 10 à 30 s de parole nette par voix (le clonage zero-shot n'exige pas plus ; Qwen3 ~3 s selon l'éditeur), sans bruit ni musique ; nettoyage léger (Pocket TTS recommande de nettoyer l'échantillon car la qualité est reproduite : https://github.com/kyutai-labs/pocket-tts).
5. Traçabilité : fiche par voix (source, URL, licence, date, preuve de consentement, contraintes d'attribution) ; ne distribuer dans l'extension que les voix CC0/CC-BY avec attribution, garder les enregistrements de proches en local, hors dépôt.
6. Garde-fous : ne jamais cloner une personne identifiable sans consentement, y compris depuis LibriVox ; conserver le filigrane de Chatterbox (PerTh, cité dans tts-locaux.md).
7. Validation : chaque voix passe le même test (WER faster-whisper + écoute) sur les phrases du protocole de moteurs-expressifs.md.

Non vérifié : le cadre juridique français précis du droit à la voix ; à faire valider avant toute distribution publique.
