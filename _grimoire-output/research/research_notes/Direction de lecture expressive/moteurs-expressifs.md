# Moteurs TTS locaux à consigne de style/émotion — français (état au 2026-09-29, carte GAO-veille-moteu-001)

Convention : « non vérifié » = non trouvé dans une source primaire lors de cette passe. Les sources sont des pages de dépôt/modèle quand c'est indiqué, sinon des synthèses tierces (moins fiables). Pas de test d'écoute effectué : la qualité française est donc en grande partie NON VÉRIFIÉE.

## Tableau (par pertinence pour le français + consigne libre)

| Moteur | Licence code / poids (commercial ?) | Français | Forme du contrôle | Clonage | Latence / matériel | Distribution |
|---|---|---|---|---|---|---|
| **Qwen3-TTS** (jan. 2026) https://github.com/QwenLM/Qwen3-TTS | Apache-2.0 (dépôt). Poids : Apache-2.0 annoncé par synthèses tierces https://qwen.ai/blog?id=qwen3tts-0115 (à confirmer sur la carte HF : non vérifié) | Officiel parmi 10 langues (dépôt). Qualité FR : non vérifié | **Texte libre** : VoiceDesign (décrire une voix), CustomVoice (voix prédéfinies + instruction d'émotion/ton). Les 1,7B ont un meilleur contrôle d'émotion que les 0,6B (synthèse tierce https://medium.com/@zh.milo/qwen3-tts-the-complete-2026-guide-to-open-source-voice-cloning-and-ai-speech-generation-1a2efca05cd6) | Oui (modèle Base, ~3 s d'audio) | Streaming, « 97 ms » annoncé par l'éditeur (GPU, non mesuré chez nous). Exemples de la doc en chinois/anglais. ROCm : non documenté ; CPU : non vérifié | Python/PyPI |
| **Fish Audio S2 Pro** https://github.com/fishaudio/fish-speech | « FISH AUDIO RESEARCH LICENSE » pour code ET poids : usage commercial encadré, lire le LICENSE (dépôt) | Français en « Tier 2 » parmi 80+ langues (dépôt) | **Balises et texte libre en ligne** : `[whisper]`, `[excited]`, `[whisper in small voice]`, pauses (https://fish.audio/s2/) | Oui | TTFA ~100 ms annoncé sur H200 ; présence d'un `compose.rocm.yml` suggère un chemin AMD (dépôt) ; taille/VRAM : non vérifié | Python, serveurs SGLang/vLLM |
| **Kyutai TTS 1.6B (en/fr)** https://huggingface.co/kyutai/tts-1.6b-en_fr | Poids CC-BY-4.0 (carte HF) : commercial OK avec attribution | **Natif FR + EN** | Pas de contrôle de style documenté ; identité vocale par **embeddings pré-calculés** ; clonage arbitraire volontairement bloqué (carte HF) | Non (voix prédéfinies uniquement) | Streaming ; GPU implicite ; CPU non vérifié | Python/Rust (kyutai-labs/delayed-streams-modeling) |
| **Kyutai Pocket TTS** (jan. 2026, 100M) https://github.com/kyutai-labs/pocket-tts | Code MIT ; poids CC-BY-4.0 (https://huggingface.co/kyutai/pocket-tts) ; licence par voix (https://huggingface.co/kyutai/tts-voices) | FR officiel (avec EN, DE, IT, ES, PT) | **Aucun contrôle de style** ; le style vient de l'audio de référence | **Oui**, interdit sans consentement licite (dépôt) | **CPU temps réel** : ~6x temps réel sur MacBook Air M4, ~200 ms au premier chunk (dépôt) ; ROCm : non mentionné | `pip install pocket-tts`, `pocket-tts serve` (HTTP :8000) |
| **CosyVoice 3 (0.5B)** https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512 | Apache-2.0 (carte HF) | FR dans les 9 langues ; aucune métrique FR isolée (carte HF) | **Instruct** en texte (exemples : dialecte, vitesse ; émotion/volume cités). Exemples de la carte en chinois | Oui (zero-shot) | 150 ms annoncé ; GPU conseillé ; ROCm/CPU : non vérifié | Python |
| **Chatterbox Multilingual** (déjà en place) https://github.com/resemble-ai/chatterbox | MIT | FR parmi 23 langues | **Deux boutons seulement** : `exaggeration` (0,25 à 2,0) et `cfg_weight` ; pas de balises (tokenizer multilingue les jette : https://huggingface.co/ResembleAI/chatterbox-turbo/discussions/21 et synthèse https://docs.nvidia.com/nvigi-sdk/1.7.0/docs/ProgrammingGuideTTSChatterbox.html) | Oui | Déjà tourne chez vous | déjà servi |
| **Chatterbox Turbo** https://huggingface.co/ResembleAI/chatterbox-turbo | MIT (à reconfirmer sur la carte) | **Anglais uniquement** (résultats de recherche ci-dessus) : **inutilisable en FR** | Balises `[laugh] [sigh] [cough]…` | Oui | ~2x plus rapide que le Multilingual | — |
| **Voxtral TTS** (Mistral, 2026) https://huggingface.co/mistralai/Voxtral-4B-TTS-2603 | Poids **CC-BY-NC-4.0** (non commercial) selon https://www.therundown.ai/tools/voxtral-tts | FR officiel, éditeur français | Expressivité issue de la référence audio ; texte libre : non vérifié | Oui (~3 s) | 4B, GPU ; ROCm : non vérifié | HF / vLLM : non vérifié |
| **Orpheus (3B)** https://github.com/canopyai/Orpheus-TTS | Apache-2.0 (dépôt) | Famille multilingue « research release » dont un fine-tune FR (`canopylabs/3b-fr-ft-research_release`, cité dans la note tts-locaux) ; qualité : non vérifié | Balises `<laugh> <sigh> <gasp>…` (liste anglaise ; balises multilingues : non vérifié) | Limité | LLM 3B, GPU ; ROCm : non vérifié | Python/vLLM |
| **IndexTTS 2 / 2.5** https://github.com/index-tts/index-tts | « bilibili Model Use License Agreement » (dépôt) : pas une licence libre standard, commercial à valider (sources tierces se contredisent) | **Non** : 2.5 = zh/en/ja/es/ar ; pas de français | Le plus riche : audio d'émotion, **vecteur à 8 valeurs** (happy, angry, sad, afraid, disgusted, melancholic, surprised, calm), texte, `emo_alpha` | Oui | RTF ~0,20 sur RTX 4090 ; ROCm non mentionné | Python |
| **Zonos v0.1** https://huggingface.co/Zyphra/Zonos-v0.1-hybrid | Apache-2.0 (code et poids) | FR parmi 5 langues, 200k h | Conditionnement numérique : émotions (joie, peur, tristesse, colère), débit, hauteur | Oui | 1,6B, GPU ; ROCm : non vérifié ; dépôt peu actif : non vérifié | Python |
| **Parler-TTS Mini Multilingual** https://huggingface.co/parler-tts/parler-tts-mini-multilingual | Apache-2.0 | FR parmi 8 langues européennes ; qualité : non vérifié | **Description en langage naturel** (genre, débit, hauteur, réverbération ; émotion limitée à ce que le prompt capte) | Non (voix décrites, pas clonées) | Petit modèle ; CPU/ROCm : non vérifié | Python/transformers |
| **Dia** | Apache-2.0 | **Pas de FR officiel** (https://huggingface.co/nari-labs/Dia-1.6B/discussions/19) | Balises non verbales, dialogue multi-locuteurs | Oui (EN) | — | — |
| F5-TTS, StyleTTS2 FR, MaskGCT, Spark-TTS | Non revus (F5 : poids CC-BY-NC d'après tts-locaux.md) | non vérifié | pas de consigne textuelle documentée ici | — | — | — |

Aucun nouveau venu 2026 hors Qwen3-TTS, Pocket TTS, Voxtral TTS, Fish S2 trouvé ; un papier 2026 sur le contrôle émotion/durée en langage naturel existe (https://arxiv.org/html/2609.11523v1) mais sans modèle vérifié.

## Lecture
- Seul **Qwen3-TTS** combine : texte libre de style + FR officiel + Apache-2.0 + clonage + streaming. C'est exactement la « consigne de jeu » (« chuchoté, fatigué, voix rauque »).
- **Fish S2** a le contrôle le plus fin (balises + texte libre par mot) mais licence Research : à écarter du produit distribué sauf accord.
- **Kyutai Pocket TTS** est le seul chemin sans GPU avec bon FR, mais sans contrôle de style : l'expressivité viendrait uniquement du choix/clonage de la voix (donc une bibliothèque de références expressives, cf. voix-de-reference.md), plus tempo/pauses côté texte.
- Chatterbox Multilingual (déjà là) : exaggeration/cfg_weight suffisent pour l'intensité, pas pour le timbre décrit.

## Shortlist à tester en priorité
1. **Qwen3-TTS 1,7B** (CustomVoice + VoiceDesign) : test de la consigne libre en FR ; vérifier ROCm.
2. **Fish S2 Pro** (test qualité seulement, licence à trancher) : plafond de qualité des balises/texte libre.
3. **Kyutai Pocket TTS FR** : plancher CPU ; puis Chatterbox Multilingual comme référence de base déjà en place (pas un candidat, un témoin).
Réserve : CosyVoice 3 en 4e si Qwen3 échoue sur ROCm.

## Protocole d'une journée
- Corpus fixe de 12 phrases FR (neutre, chuchoté, colère, fatigue, vieil homme ivre, enfant, narration grave, dialogue à deux voix, chiffres/sigles, phrase longue, phrase très courte, question) ; 4 consignes de jeu identiques pour tous, exprimées dans la forme native du moteur (texte libre, balise, exaggeration).
- Matin : installer chacun dans un venv séparé, noter ROCm oui/non, VRAM, RTF, temps au premier son (mesures chez nous, pas les chiffres éditeurs).
- Après-midi : générer 12 x 4 échantillons par moteur, voix de référence identique quand le clonage existe.
- Évaluation sans test manuel : boucle faster-whisper (WER) pour l'intelligibilité + écoute aveugle en ABX par vous sur un sous-ensemble ; grille : respect de la consigne, naturel FR, prononciation, stabilité (0 à 5).
- Décision : garder le moteur qui obtient le meilleur respect de consigne avec ROCm fonctionnel, sinon Pocket TTS/Piper en repli sans GPU.
