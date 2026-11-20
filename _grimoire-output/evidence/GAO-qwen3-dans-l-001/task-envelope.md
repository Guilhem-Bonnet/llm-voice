# Agentic Task Envelope

## Task

- Task id: GAO-qwen3-dans-l-001
- Request: Qwen3 dans l'extension : voix par défaut, lecture préparée sans coupure (étape 1 sur 2 ; le jeu par consignes est l'étape 2)
- Owner agent: guilhem-bonnet (exécution : backend-engineer « Stack », skills platform-reliability-sre, platform-deploy-release)
- Profile: controlled
- Current state: `executing`
- Risk level: `medium` (change la voix par défaut de l'extension, charge GPU locale)

## Périmètre de l'étape 1

1. Fournisseur Qwen3 (même contrat HTTP que Kyutai 1.6B, port 8021), voix « Voix des essais 21 et 22 », champ `direction` prévu par segment mais non utilisé.
2. Qwen3 en tête du choix automatique ; repli Kyutai 1.6B puis voix système, avec message, si Qwen3 ne répond pas ou en mode jeu.
3. Lecture préparée en entier avant le premier son pour un moteur plus lent que l'écoute ; barre d'attente « n passages prêts sur N » ; Annuler/Stop pendant la préparation.
4. Tests verts et lus ; preuve réelle via le vrai VS Code, sink nul, `--mute-audio`.

Hors périmètre : jeu d'acteurs par consignes (étape 2), installation du VSIX, push.

## Ambiguïtés résolues

| Question posée | Résolution | Source (contexte vérifié / question ciblée / hypothèse) |
|---|---|---|
| Le choix explicite de Camille (global-voice.json = kyutai-1-6b / cml-577_394) doit-il être remplacé ? | Non : respecté tel quel, aucune migration. Qwen3 devient le défaut du choix automatique et se choisit en un clic dans la galerie ou l'éditeur | Brief du coordinateur (« s'il avait choisi explicitement Camille, respecter son choix ») ; fichier lu le 2026-11-07 |
| Préparer tout, ou une avance calculée ? | Tout : `startAhead = N-1`, fenêtre = N passages. Plus simple à prouver qu'une avance calculée | Brief (« tous les segments synthétisés avant le premier son ») |
| Ordre de repli | Qwen3 → Kyutai 1.6B → (Chatterbox → Piper local, ordre auto existant) → voix système | Brief (« Kyutai, puis voix système ») ; Chatterbox/Piper conservés pour ne pas casser l'ordre automatique existant : hypothèse signalée |
| Libellé | Voix « Voix des essais 21 et 22 » (nom du serveur), moteur « Voix Qwen3 (carte graphique) » | Proposition, à valider par guilhem-bonnet |

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Fournisseur Kyutai | vscode-extension/src/tts/KyutaiPocketProvider.ts, presets.ts | même contrat HTTP | 2026-11-07 | n/a |
| Lecture | src/pipeline/Pipeline.ts (startInternal, prepareEngine, wait), PlaybackController.ts (startAhead) | point d'insertion de la préparation | 2026-11-07 | n/a |
| Serveur | deploy/qwen3/server.py, deploy/docker-compose.tts.yml | contrat /health (`gpu_yield`, `state`) | 2026-11-07 | n/a |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| _grimoire/_memory/shared-context.md | read | contexte projet | lu au démarrage |

## Garde-fous

- Aucun son sur les enceintes : VS Code de test `--mute-audio`, sink nul vérifié avant toute lecture.
- Mode jeu : `$XDG_RUNTIME_DIR/gpu-yield/active` vérifié avant toute charge GPU.
- Pas de push, pas d'installation de VSIX, pas de reload de la fenêtre de l'utilisateur, `deploy-kyutai16-1` jamais arrêté.
