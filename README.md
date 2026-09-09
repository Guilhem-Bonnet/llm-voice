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

## Essayer en 2 minutes

Voir [`docs/user-guide.md`](./docs/user-guide.md) pour le guide complet
(installation, premier « Speak Document », profils, erreurs courantes,
mode local). En bref :

1. Ouvrir `vscode-extension/` dans VS Code, `npm ci`, puis **F5** (Run
   Extension) : une nouvelle fenêtre VS Code s'ouvre avec l'extension activée
   en mode développement.
2. Ouvrir un fichier `.md` (`vscode-extension/test/fixtures/markdown/short.md`
   par exemple) et lancer **LLM Voice: Speak Document** (palette de commandes).
3. Sans serveur TTS local, la commande affiche proprement « Chatterbox is
   unavailable. » (Retry / Open provider settings) plutôt que de planter —
   voir `docs/install-linux.md` et `docs/providers.md` pour installer
   Chatterbox (recommandé) ou Kokoro (léger, sans GPU) en local.
4. Pour entendre une lecture complète sans GPU, lancer avec
   `LLM_VOICE_TEST_FAKE_TTS=1` dans l'environnement avant **F5** : l'extension
   bascule alors sur `FakeTtsProvider` (audio silencieux généré localement) —
   voir `vscode-extension/docs/testing.md`. C'est aussi le mode utilisé par la
   suite d'intégration (`npm run test:integration`).

## État du projet

Phase 5 en cours. Phases 3-4 livrées : slice vertical (sources, profils,
pipeline source→segmentation→synthèse→lecteur→surlignage, cache disque LRU),
providers TTS réels (`ChatterboxProvider`, `KokoroProvider`,
`OpenAICompatibleTtsProvider`, `EgressGuard`/D10, `Verify Local Mode`) et
narrateur (`OllamaNarrator`, `OpenAICompatibleNarrator`, mode dégradé
ADR-005). Phase 5 : gestion d'erreurs UX (CdC §52), Output Channel avec
journalisation redigée (CdC §81, AC-SEC-07), timeouts/anti-spam, guide
utilisateur. Voir le cahier des charges complet et les décisions de cadrage :

- [`cahier-des-charges.md`](./cahier-des-charges.md)
- [`docs/user-guide.md`](./docs/user-guide.md)
- [`docs/adr/`](./docs/adr/) — décisions d'architecture (ADR-001..011)
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
