# Voix de narration haut de gamme : état des preuves (2026-11-06)

Recherche en lecture seule, rien n'a été écouté. Aucune qualité n'est déclarée : la décision se fait à l'oreille. Mention « tiers » : résumé ou blog, non confirmé à la source.

## Local

| Modèle | Français | Licence | Matériel | État pour nous |
|---|---|---|---|---|
| Chatterbox Multilingual | clonage, `language_id=fr` | MIT, filigrane PerTh | déjà en place sur la RX 9070 | à écouter d'abord, avec une bonne référence française |
| Qwen3-TTS 1,7 B | officiel, aucun locuteur préréglé francophone natif | Apache-2.0 | VRAM non documentée, ROCm par des guides tiers | second essai, VoiceDesign n'imite personne |
| Voxtral TTS 4 B | natif, environ 20 voix | CC BY-NC 4.0, poids et voix | au moins 16 Go, ROCm non prouvé sur Radeon | usage personnel seulement, à tenter si le reste déçoit |
| Fish S2 Pro | « Tier 2 » | non commercial, licence pour le commercial | au moins 24 Go | hors de portée, sauf quantification non vérifiée |
| Higgs Audio v3 | palier supérieur | recherche et non commercial | non indiquée | non retenu |
| F5-TTS FR, XTTS-v2 | ajustement FR, natif | non commercial | modeste, non vérifié | non retenus |

## Cloud : le texte quitte la machine (ADR-010)

| Service | Voix | Style | Prix pour 10 h, ordre de grandeur | Remarque |
|---|---|---|---|---|
| Gemini TTS | 30 voix, `fr-FR` disponible, `fr-CA` en préversion | invites en langage naturel, balises | environ 9 $ (tiers) | provider dédié probable |
| Voxtral API | voix américaines, britanniques, françaises | voix de référence | environ 8,6 $ | endpoint non vérifié |
| OpenAI `gpt-4o-mini-tts`, `tts-1-hd` | 13 voix optimisées pour l'anglais | `instructions` | 9 à 16 $ (tiers) | **retrait annoncé au 6 janvier 2027** : ne pas bâtir dessus |
| ElevenLabs | multilingue | balises | 22 à 43 $ | prix lus sur la page officielle |
| Chirp 3 HD, Azure HD, Polly, Cartesia | voir sources | variable | 16 à 26 $ (tiers) | noms et prix à vérifier |

Les voix des applications ChatGPT et Gemini ne sont pas forcément celles des API. Rien ne prouve qu'une API rende « la voix de l'application ». Conservation des données : à vérifier avant tout envoi.

## Voix de référence

Une licence de corpus ne vaut pas consentement au clonage. Usage personnel local : raisonnablement acceptable avec CC BY 4.0 ou domaine public, attribution gardée, sans présenter le résultat comme la personne ; droit français de la voix non vérifié. Redistribution d'un clone : non, sans consentement écrit.

## Sources principales

https://huggingface.co/ResembleAI/chatterbox , https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice , https://huggingface.co/mistralai/Voxtral-4B-TTS-2603 , https://speech.fish.audio/install/ , https://docs.cloud.google.com/text-to-speech/docs/gemini-tts , https://developers.openai.com/api/docs/deprecations , https://www.elevenlabs.io/pricing/api , https://mistral.ai/fr/news/voxtral-tts
