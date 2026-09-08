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

Le slice vertical (S3.5) câble la chaîne complète — source → segmentation →
synthèse → lecteur → surlignage — sans encore dépendre d'un vrai serveur TTS :

1. Ouvrir `vscode-extension/` dans VS Code, `npm ci`, puis **F5** (Run
   Extension) : une nouvelle fenêtre VS Code s'ouvre avec l'extension activée
   en mode développement.
2. Ouvrir un fichier `.md` (`vscode-extension/test/fixtures/markdown/short.md`
   par exemple) et lancer **LLM Voice: Speak Document** (palette de commandes).
3. Sans serveur TTS local, la commande affiche proprement « LLM Voice: TTS
   unavailable » (Retry / Open provider settings) plutôt que de planter — le
   provider réel (`OpenAICompatibleTtsProvider`) attend un serveur compatible
   OpenAI sur `http://127.0.0.1:8004` (Chatterbox en phase 4).
4. Pour entendre une lecture complète dès aujourd'hui (sans GPU), lancer avec
   `LLM_VOICE_TEST_FAKE_TTS=1` dans l'environnement avant **F5** : l'extension
   bascule alors sur `FakeTtsProvider` (audio silencieux généré localement) —
   voir `vscode-extension/docs/testing.md`. C'est aussi le mode utilisé par la
   suite d'intégration (`npm run test:integration`).
5. Chatterbox réel en phase 4 : `docker run -p 8004:8004 ...` (à venir),
   pointé par le profil actif (**LLM Voice: Select Profile** /
   **LLM Voice: Open Profiles**).

## État du projet

Phase 3 (S3.5) — le slice vertical est câblé : sources (document/sélection/
presse-papiers), profils par défaut (CdC §19), pipeline
source→segmentation→synthèse→lecteur→surlignage, cache disque LRU, bundling
esbuild pour un VSIX installable. Le provider TTS réel (Chatterbox) et le
narrateur (Ollama) restent à intégrer en phase 4. Voir le cahier des charges
complet et les décisions de cadrage :

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
