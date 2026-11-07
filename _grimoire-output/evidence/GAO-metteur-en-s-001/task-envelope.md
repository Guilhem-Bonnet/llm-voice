# Task envelope — GAO-metteur-en-s-001

- Titre : metteur en scène local — propositions de voix d'après le texte, états joués, lecture qui démarre plus tôt
- Agent : backend-engineer (Stack), dispatché ; écrit le 2026-11-07 juste après la première édition (`stagePlay.ts`), avant tout test ou commit.
- Cadre : ADR-018 (amendement du 2026-11-07), ADR-015 (le modèle rend des identifiants ou des citations vérifiées, jamais du texte lu).
- Périmètre : `vscode-extension/src/direction/cast/`, `src/direction/director/`, `src/playback/` (clé de cache, plan), `src/views/castPanel/`, `src/pipeline/Pipeline.ts`, `src/tts/presets.ts` (capacité `instructions` de Qwen3), `scripts/audio-proof/native-real.sh`.
- Hors périmètre : `deploy/qwen3/`, voix du serveur, `global-voice.json` de l'utilisateur, VSIX, push.
- Contraintes : aucun son sur les enceintes (sink nul, `--mute-audio`), aucun texte hors machine, mode jeu respecté (`$XDG_RUNTIME_DIR/gpu-yield/active`), aucun téléchargement.
- Critères : typecheck, lint, test:unit, build, vscode-test (fake-tts, integration-security, voice-chain) verts ; unitaires (citation absente rejetée, prénom seul sans proposition, table d'états, clé de cache avec direction, démarrage anticipé) ; preuve réelle sur `docs/essais-voix/07-theatre-noms-seuls.md`.
- Sortie : reste en `running` (écoute humaine requise).
