# Moteurs expressifs et voix de référence pour la direction de lecture

Synthèse de la carte `GAO-veille-moteu-001` (2026-09-29). Notes sourcées, URL par affirmation, dans
`_grimoire-output/research/research_notes/Direction de lecture expressive/` : `moteurs-expressifs.md` et
`voix-de-reference.md`. Ce qui n'a pas pu être vérifié y est marqué « non vérifié ».

## Ce que la veille établit

Les moteurs déjà installés ne savent pas suivre une consigne de jeu. Piper ne règle que la vitesse. Le serveur Chatterbox
en place ne règle que l'intensité émotionnelle et refuse les balises expressives. Une nouvelle génération de moteurs locaux
accepte une consigne en texte libre ou des balises, et plusieurs annoncent le français ; leur qualité française réelle
et leur fonctionnement sur ROCm restent à mesurer chez nous, pas à croire sur la foi des éditeurs.

## Shortlist à tester en une journée

| Rang | Moteur | Pourquoi | À vérifier |
|---|---|---|---|
| 1 | Qwen3-TTS 1,7B (CustomVoice + VoiceDesign) | consigne libre ; conception d'une voix par description | fonctionnement ROCm |
| 2 | Fish S2 Pro | plafond de qualité, balises et texte libre | licence d'usage |
| 3 | Kyutai Pocket TTS FR | plancher sans GPU, français natif | expressivité |
| témoin | Chatterbox Multilingual (déjà en place) | référence de base | — |
| réserve | CosyVoice 3 (mode instruct) | si Qwen3-TTS échoue sur ROCm | — |

Protocole : 12 phrases françaises fixes (neutre, chuchoté, colère, fatigue, vieil homme ivre, enfant, narration grave,
dialogue à deux voix, chiffres et sigles, phrase longue, phrase très courte, question) × 4 consignes identiques pour tous ;
mesures maison (ROCm, VRAM, facteur temps réel, temps au premier son) ; intelligibilité par le banc (WER faster-whisper) ;
écoute aveugle ABX par l'utilisateur sur un sous-ensemble, grille 0–5 : respect de la consigne, naturel, prononciation,
stabilité. À ne lancer qu'en dehors du mode jeu (gpu-yield).

## Bibliothèque de voix de personnages

Grille de 12 à 15 voix (âge, genre, timbre, rôle). Amorce sans risque : voix données avec consentement explicite
(CC0 de Kyutai, voix prédéfinies des moteurs) et Common Voice français (CC0) filtré par âge et genre déclarés. Cases
manquantes (âgé, enfant, rauque) : voix conçues par description, qui n'imitent personne, ou enregistrements consentis
gardés en local, hors dépôt. Une fiche de traçabilité par voix (source, licence, consentement, attribution). Jamais de
clonage d'une personne identifiable sans consentement, y compris depuis LibriVox. Le cadre juridique français du droit à
la voix n'est pas vérifié : à faire valider avant toute distribution publique.

## Suite

La décision de moteur reste ouverte jusqu'au banc d'une journée ; l'ADR-015 reste agnostique (partition traduite selon
les capacités du moteur) et prévoit ce banc comme une carte distincte.
