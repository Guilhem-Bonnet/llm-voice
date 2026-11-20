# Agentic Evidence Pack

## Summary

- Task id: GAO-essai-qwen3-001 (carte non avancée, reste `running`)
- Profile: controlled
- Outcome: essai Qwen3-TTS en français, voix créées sur description (6 voix x 3 textes), voix figées, page d'écoute. Aucune qualité déclarée : l'utilisateur écoute.
- Point de départ git : HEAD 72d2299 ; aucun commit, aucun push, vscode-extension/ non touché.

## Sources et révisions

| Élément | Valeur |
|---|---|
| Paquet officiel | `qwen-tts` 0.1.1 (PyPI), wheel sha256 `11a290d8dabc7ef91a90c54478c8ab19b3edb1d85c0882313721892bdc4af15d`, licence Apache-2.0, dépôt QwenLM/Qwen3-TTS (révision git non relevée : seule la wheel PyPI a été utilisée) |
| Modèle VoiceDesign | `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`, révision `5ecdb67327fd37bb2e042aab12ff7391903235d3`, Apache-2.0 (carte et API Hub) |
| Modèle CustomVoice | `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`, révision `0c0e3051f131929182e2c023b9537f8b1c68adfe`, Apache-2.0 ; carte lue, modèle non téléchargé : ses 9 voix natives sont chinois, anglais, japonais, coréen, aucune française |
| Modèle Base (écart) | `Qwen/Qwen3-TTS-12Hz-1.7B-Base`, révision `fd4b254389122332181a7c3db7f27e918eec64e3`, hors de la liste de sources donnée ; téléchargé car la carte décrit « Voice Design then Clone » avec lui, seul moyen documenté de figer une voix |
| Dépendances | `pip install --target ~/.llm-voice/voices-lab/qwen3/extras` depuis un conteneur : qwen-tts (sans deps), accelerate 1.12.0 (sans deps), transformers 4.57.3 (épinglé par qwen-tts, l'image a 4.46.3), sox, onnxruntime ; torch 2.9.1 ROCm de l'image réutilisé, image et compose inchangés |
| Revue du code tiers | wheel dépaquetée et lue par grep : pas de subprocess, socket, pickle ; seul `urlopen` sert à charger une URL d'audio de référence (non utilisée) ; un `eval` sur une constante dans le tokenizer 25 Hz (non utilisé). Dépendance `gradio` du paquet volontairement non installée (démo seulement) ; `sox` Python signale l'absence du binaire SoX, sans effet sur la génération |

## Ce qui tourne

- GPU (RX 9070, ROCm, `cuda:0`), bfloat16, attention `sdpa` (pas de flash-attn), conteneur `docker run --rm` sur `deploy-chatterbox:latest`, `/dev/kfd` + `/dev/dri`, groupes 39 et 105, `ROCBLAS_USE_HIPBLASLT=0`, sans `HSA_OVERRIDE_GFX_VERSION`. Le GPU a fonctionné au premier essai : pas de repli CPU.
- Hors ligne : `HF_HUB_OFFLINE=1` exigé par le script ; téléchargement fait avant dans un conteneur séparé. Piège : transformers 4.57.3 appelle `model_info` du Hub même hors ligne si on passe un identifiant de dépôt ; le script passe donc le chemin local du cache.
- Mode jeu : `$XDG_RUNTIME_DIR/gpu-yield/active` vérifié à la main avant chaque lancement (absent) et par le script avant le chargement et avant chaque génération (dossier monté en lecture seule). Il n'est jamais apparu pendant l'essai.
- VRAM : 6 742 Mo utilisés sur 16 301 Mo avant l'essai (kyutai16 en cours, intact). Pic mesuré par torch : 4 510 à 5 349 Mo ; aucun manque de mémoire, aucun service touché.

## Fichiers écrits

- `scripts/voice-lab/qwen3.py` (étapes `gen --stage probe|design|frozen` et `page`) ; `.gitignore` (3 lignes ecoute-qwen3).
- `~/.llm-voice/voices-lab/qwen3/` : `extras/`, `hf/`, `src/` (wheel, journal de téléchargement), `card/` (cartes lues), `out/raw/*.wav|json`, `out/prompts/*.pt` (amorces figées), `out/stability.json`.
- `_grimoire-output/evidence/GAO-essais-voix-001/ecoute-qwen3/` : `results.json`, `index.html`, `*.ogg` (audio embarqué en base64 dans la page).

## Mesures (results.json, stability.json, raw/*.json)

- Génération : 18 voix créées (6 x 3 textes), 12 voix figées (6 x 2 textes), 2 essais de description. Page : 32 éléments, 0 erreur.
- Facteur temps réel (temps de génération / durée audio, donc plus lent que le temps réel) : créées 1,95 en moyenne ; figées 1,85 ; première génération de chaque chargement plus lente (2,62). Une phrase courte de 9 s demande environ 18 s, un texte de 20 s environ 38 s.
- Premier son : non mesurable, `generate_voice_design` renvoie l'audio entier (pas de diffusion utilisée) ; la carte annonce 97 ms en diffusion, non vérifié.
- Chargement : VoiceDesign 3,8 à 4,1 s (cache disque chaud, hors ligne), Base 5,8 s. Le premier chargement avait suivi un téléchargement de deux modèles.
- VRAM (torch, octets alloués) : 4 510 Mo phrase courte, 5 000 à 5 220 Mo textes longs, 5 350 Mo avec le modèle Base.
- Déterminisme : `probe-en` et `design-court-grave-1` (même graine, même texte, même description) donnent la même durée 8,72 s.
- Description en français (`probe-fr`) acceptée sans erreur, durée 9,52 s, WER 3,7 % ; la carte ne documente que le chinois et l'anglais, les six voix utilisent donc des descriptions traduites en anglais plus « accent français standard de France » (écart signalé).
- Stabilité d'une voix entre textes : sans figer, VoiceDesign réinvente la voix à chaque appel (même description, même graine, textes différents). Similarité cosinus des empreintes vocales (x-vector du modèle Base) entre la voix de la phrase courte et celle du récit / de la documentation : 0,975 à 0,992 ; figée : 0,994 à 0,996. Ces chiffres montrent que la figée est plus proche de la référence ; ils ne disent pas ce que l'oreille entend.
- Figer : pas de `create_voice_design` dans la wheel 0.1.1 ; méthode de la carte = générer un extrait avec VoiceDesign, `create_voice_clone_prompt(ref_audio=(wav, sr), ref_text=...)` sur le modèle Base, puis `generate_voice_clone(voice_clone_prompt=...)`. Les amorces sont sauvées dans `~/.llm-voice/voices-lab/qwen3/out/prompts/<voix>.pt` (ref_code, ref_spk_embedding, ref_text).
- WER (faster-whisper small, CPU) par voix, phrase courte / récit créé / récit figé / documentation créée / documentation figée : clair-1 3,7 / 5,2 / 8,6 / 0 / 0 % ; clair-2 7,4 / 8,6 / 5,2 / 0 / 0 % ; clair-3 25,9 / 5,2 / 10,3 / 0 / 0 % ; grave-1 3,7 / 3,4 / 3,4 / 0 / 0 % ; grave-2 7,4 / 3,4 / 5,2 / 1,8 / 1,8 % ; grave-3 11,1 / 10,3 / 3,4 / 0 / 0 %. clair-3 phrase courte à 25,9 % : à écouter, non analysé.

## Vérification de la page dans Firefox

`/home/guilhem/.cache/cct/claude-1000/-mnt-Travail-Projets-Dev-TTS-Voice/2afc355f-1a6f-4749-8260-26c00fa0dc52/scratchpad/ffcheck.sh` : copie de index.html seule dans un dossier temporaire, sonde canplay ajoutée, Firefox Flatpak headless, capture `shot.png` (40 Ko) dans `ffcheck-qwen3/`. Message du bac à sable `CanCreateUserNamespace() EPERM` (sans empêcher la capture). Résultat : la page s'affiche (titre, résumé, première section, texte « voix créées, prénom à choisir ») mais la sonde affiche « canplay 0/32 » : la capture est prise à l'instant du chargement, avant tout décodage audio ; la lecture audio dans Firefox n'est donc PAS prouvée (AC-001 partiel).

## Echecs et limites

- Premier essai GPU échoué par un appel réseau de transformers hors ligne (corrigé en passant le chemin local) ; aucun échec GPU.
- Les 12 sorties figées utilisent la graine fixe mais le modèle Base ; la phrase courte figée n'est pas régénérée (c'est la référence).
- Qualité, naturel, calme de l'assistant : non jugés, à écouter.
