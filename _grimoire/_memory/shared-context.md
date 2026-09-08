# Contexte Partagé — TTS-Voice (produit : « LLM Voice »)

> Ce fichier est chargé par tous les agents au démarrage.
> Il est la source de vérité pour le contexte projet.
> Mis à jour par Marcel (concierge) le 2026-09-08 à partir de `cahier-des-charges.md`.

## Projet

- **Nom** : TTS-Voice (nom produit : **LLM Voice**)
- **Description** : Extension Visual Studio Code qui transforme du contenu textuel de l'IDE
  (Markdown, sélection, curseur, presse-papiers, réponses finales de Claude Code) en lecture
  vocale locale, avec profils de narration (transformation LLM facultative), plusieurs voix,
  surlignage synchronisé du segment lu, et contrôles Play/Pause/Stop/Précédent/Suivant.
- **Type** : extension VS Code (TypeScript) + scripts d'intégration (hook Claude Code) + services locaux optionnels
- **Stack** : TypeScript, Node.js 22, VS Code Extension API, unified + remark-parse + remark-gfm, Zod,
  vitest (unit), @vscode/test-cli + @vscode/test-electron (intégration), @vscode/vsce (packaging)
- **Providers locaux** : Ollama (narrator, `localhost:11434`, structured outputs) ; Chatterbox
  Multilingual V3 via serveur HTTP compatible `/v1/audio/speech` (TTS principal) ; Kokoro (fallback léger)
- **Plateforme prioritaire** : Linux (machine dev AMD RDNA4 / ROCm) ; cible Windows + macOS pour la 1.0
- **Spécification** : `cahier-des-charges.md` (88 sections, 17 critères d'acceptation AC-01..AC-17)

## Invariants non négociables (P0)

1. **Zéro autoplay** : aucun chemin de code `Claude Stop → Player.play()`. Le hook Claude ne fait que déposer dans l'Inbox.
2. **Local-first** : par défaut aucun contenu ne quitte la machine ; garde `localOnly` (localhost/127.0.0.1/::1).
3. **Provider agnostic** : Chatterbox, Kokoro, Ollama, Claude, Copilot derrière des interfaces ; jamais de dépendance forte.
4. **Profils configurables** plutôt que modes codés en dur.
5. **Modèles jamais embarqués dans le VSIX** ; le GPU est géré par le serveur TTS.

## Infrastructure

| Hôte | Rôle | Services |
|------|------|----------|
| Machine dev locale (Fedora, RDNA4) | dev + E2E réel | VS Code, Ollama :11434, Chatterbox-TTS-Server :8004, Weaviate/Neo4j/Redis (mémoire Grimoire) |
| GitHub `Guilhem-Bonnet/llm-voice` (à créer) | repo public, CI matrice 3 OS | GitHub Actions, Dependabot, CodeQL, Releases (VSIX) |

## Organisation du travail

- Plan maître : `_grimoire-output/planning-artifacts/master-plan-llm-voice-v1.md`
  (routage LLM par agent, chaîne de vérification, pyramide de tests, phases 0→6).
- Rapports phase 0 : `review-cdc-v1.md`, `brainstorm-llm-voice-v1.md`,
  `security-privacy-review-v1.md`, `github-repo-ci-plan-v1.md` (même dossier).
- Routage LLM : Fable = orchestration/gates uniquement ; Opus = ADR, state machine, audit sécurité ;
  Sonnet = code/tests/revues ; Haiku = CI/docs/mémoire. **Toujours passer `model:` au dispatch**
  (les agents `.claude/agents/*.md` en `inherit` tourneraient sinon sur Fable).
- Vérificateur ≠ auteur, contexte neuf. Gate de phase = `grimoire standard gate check --task-id <phase> --strict`.

## Conventions

- Langue de communication : Français
- Conventional Commits, SemVer, trunk-based, PR obligatoire sur `main`
- Toutes les décisions sont loggées dans `decisions-log.md`
- Briefs de sous-agents préfixés `MODE NON-INTERACTIF` ; sortie dans un fichier, retour ≤ 10 lignes
