# LLM Voice

Extension VS Code pour la narration vocale locale de documents Markdown et des
réponses d'agents LLM (Claude Code, Codex, Gemini CLI, etc.), via un moteur
TTS local (Chatterbox, Kokoro) et un narrateur optionnel (Ollama, llama.cpp,
compatible OpenAI).

## Invariants

- **Zéro autoplay** : rien n'est jamais lu automatiquement, y compris le
  contenu déposé par un hook d'agent dans l'inbox.
- **Local-first** : le moteur TTS et le narrateur tournent sur `localhost`
  par défaut ; tout hôte distant demande un consentement explicite.
- **Provider agnostic** : un seul contrat `TtsProvider` pour le TTS local, un
  serveur d'entreprise ou une API cloud compatible OpenAI.
- **Linux first** : développé et testé en priorité sur Linux, avec support
  Windows et macOS en CI.

## État du projet

Phase 1 — repo, squelette d'extension et CI. Aucune fonctionnalité utilisateur
n'est encore livrée. Voir le cahier des charges complet et les décisions de
cadrage :

- [`cahier-des-charges.md`](./cahier-des-charges.md)
- [`_grimoire-output/planning-artifacts/`](./_grimoire-output/planning-artifacts/)

## Structure du repo

```
vscode-extension/        # Extension VS Code (TypeScript)
integrations/claude-code/ # Plugin et scripts d'intégration Claude Code
docs/                     # Documentation
.github/workflows/        # CI, release, CodeQL, Dependabot
```

## Licence

MIT — voir [`LICENSE`](./LICENSE).
