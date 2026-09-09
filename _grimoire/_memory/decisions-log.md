# Journal de Décisions — TTS-Voice

> Les agents enregistrent ici les décisions architecturales et techniques significatives.
> Tu peux aussi en ajouter manuellement.

## Format

```
### [YYYY-MM-DD] Titre court de la décision
- **Contexte** : Pourquoi cette décision s'est posée
- **Décision** : Ce qui a été choisi
- **Alternatives rejetées** : Ce qui a été écarté et pourquoi
- **Agent** : Qui a pris/suggéré cette décision
```

## Décisions

*(Les décisions seront loguées ici au fil du projet)*

### [2026-09-08] Routage LLM par agent pour économiser Fable
- **Contexte** : Les agents `.claude/agents/*.md` sont générés avec `model: opus` ou `inherit` (= Fable). Le coût Fable doit être réservé à l'orchestration.
- **Décision** : Fable = triage/gates/arbitrage ; Opus = ADR, PlaybackController/Synchronizer, audit sécurité pré-1.0, escalade après 2 échecs Sonnet ; Sonnet = implémentation, tests, revues, fix-loop ; Haiku = CI/CD, docs, mémoire, release. Le paramètre `model:` est passé explicitement à chaque dispatch.
- **Alternatives rejetées** : éditer les fichiers `.claude/agents/` (grimoire:managed, écrasés par `grimoire host sync`) ; tout laisser en `inherit` (coût Fable ×5-10).
- **Agent** : concierge (Marcel)

### [2026-09-08] Vérificateur indépendant de l'auteur
- **Contexte** : fix-loop et agentic-standard exigent une preuve d'exécution et un evidence pack.
- **Décision** : chaque livraison passe par CC PASS → revue Sentinel (Sonnet, contexte neuf) → revue spécialisée si L3 (Archie/Vault) → gate Fable qui ne lit que l'evidence-pack. Le vérificateur n'est jamais l'auteur.
- **Alternatives rejetées** : auto-revue par l'auteur ; Fable relisant le code (coût).
- **Agent** : concierge (Marcel)

### [2026-09-08] Slice vertical avant narration/profils/inbox
- **Contexte** : la review du CdC juge le périmètre §71 trop chargé pour un premier lot.
- **Décision** : phase 3 = Markdown → segments → FakeTts → player webview → highlight (AC-01..06) ; providers réels en phase 4 ; Claude inbox + profils en phase 5. Le périmètre 0.1 du CdC reste la cible de la release, pas du premier lot.
- **Alternatives rejetées** : tout implémenter en parallèle (risque scope creep, bugs de state machine masqués par le cache).
- **Agent** : platform-architect (Archie, Sonnet) — proposé ; concierge — retenu

### [2026-09-08] Création du repo GitHub public soumise à confirmation
- **Contexte** : action publique et outward-facing (L4).
- **Décision** : plan + script `bootstrap-repo.sh` préparés ; exécution seulement après confirmation explicite de l'utilisateur (nom `llm-voice`, licence MIT).
- **Agent** : concierge (Marcel)

### [2026-09-08] Cadrage P0/P1 tranché (D1-D8)
- **Contexte** : 8 questions ouvertes de la review du CdC, réponses utilisateur.
- **Décision** : D1 `extensionKind: ["ui"]` ; D2 progressif par chunk en 0.1, streaming intra-chunk en 0.2 via `synthesizeStream?` ; D3 répertoire inbox = seule source de vérité ; D4 protocole postMessage load/play/pause/seek ↔ ready/timeupdate/ended/error/userAction, state machine côté Extension Host ; D5 Profile Editor en 0.2, `profiles.json` + JSON Schema en 0.1 ; D6 édition pendant lecture = session `stale`, jamais d'arrêt ; D7 install/uninstall du hook par commande explicite (détails après vérification) ; D8 Copilot via `vscode.lm` + participant `@voice` en 0.2 (UC-17 P2→P1), narrateurs cloud par presets OpenAI-compatibles, protocole d'inbox ouvert multi-agents.
- **Alternatives rejetées** : `["ui","workspace"]` (mode cassé silencieux en Remote) ; streaming intra-chunk en 0.1 (Web Audio API, complexité pause/seek/cache) ; index inbox dans globalStorageUri (double source) ; providers spécifiques par LLM cloud (un preset suffit).
- **Contradiction assumée** : CdC §45-46 (Copilot P2) et §56. L'utilisateur a explicitement demandé l'intégration Copilot et l'ouverture multi-LLM.
- **Agent** : concierge (Marcel) sur réponses de guilhem-bonnet
- **Détail** : `_grimoire-output/planning-artifacts/decisions-cadrage-v1.md`

### [2026-09-08] Hook Claude Code : plugin officiel en priorité, collector Node unique
- **Contexte** : vérification factuelle des docs Claude Code (hooks.md, settings.md, vs-code.md) et de `~/.claude/settings.json` local.
- **Décision** : `last_assistant_message` lu sur stdin (pas de parsing JSONL) ; installation via plugin Claude Code `llm-voice` (`hooks/hooks.json`) en voie principale, commande d'édition ciblée de `~/.claude/settings.json` en voie secondaire ; collector en Node, cross-platform, timeout 15 s, exit 0 toujours.
- **Alternatives rejetées** : parser `transcript_path` (asynchrone, en retard) ; trois scripts bash/python/powershell (dépendance Python sous Windows) ; édition silencieuse à l'activation.
- **Agent** : claude-code-guide (Sonnet) pour les faits, concierge pour la décision
- **Détail** : `_grimoire-output/planning-artifacts/claude-hook-verification-v1.md`

### [2026-09-08] Correction D8 : les LLM tiers sont des sources à lire, pas des narrateurs ni des voix ; D9 grille TTS local / entreprise / API
- **Contexte** : l'utilisateur a corrigé ma lecture du point 8. Copilot, Gemini, Kimi, Qwen, DeepSeek, Grok, Codex sont des contenus à lire avec le TTS de LLM Voice.
- **Décision** : mécanisme unique = inbox ouverte (JSON + CLI `llm-voice-inbox add`), hooks/notify des CLI quand ils existent, participant `@voice` pour Copilot en 0.2, sélection/presse-papiers sinon, jamais de scraping. Aucun narrateur cloud ajouté. Grille TTS proposée : local (0.1), voix système sans installation (0.2), serveur d'entreprise via le même provider compatible OpenAI (0.2), API cloud compatible OpenAI (0.2) puis dédiées (0.3). Garde réseau à trois listes : localhost, hôtes de confiance verrouillables par la DSI, reste sous consentement.
- **Alternatives rejetées** : presets de narrateurs cloud (hors demande) ; laisser les LLM tiers parler avec leur propre TTS.
- **Agent** : concierge (Marcel), après correction de l'utilisateur

### [2026-09-08] Validation utilisateur D1-D9 et création du repo public
- **Contexte** : réponse « Je valide tout » aux propositions D8 corrigé, D9 (grille TTS) et création du repo.
- **Décision** : phase 1 lancée. Repo `Guilhem-Bonnet/llm-voice` public MIT, créé par Flow (Sonnet) après revue Sentinel du script. Exigences ajoutées par l'utilisateur : garantie 100 % local prouvable, Linux en priorité, UI dédiée compacte dans VS Code → trois études en cours (`local-guarantee-v1.md`, `linux-first-v1.md`, `ui-compact-v1.md`).
- **Agent** : concierge (Marcel)

### [2026-09-08] D10-D12 : garantie locale prouvable, Linux first validé, UI minimale par défaut
- **Contexte** : trois études Sonnet avec sources web (`local-guarantee-v1.md`, `linux-first-v1.md`, `ui-compact-v1.md`).
- **Décision** : D10 `EgressGuard` unique + CSP `connect-src 'none'` + commande Verify Local Mode + recette pare-feu Linux ; D11 ROCm 7.2 conteneur RDNA4 pour Chatterbox, Piper comme TTS léger FR sans GPU (openedai-speech archivé, wrapper actif ou maison), checklist Linux 1.0 ; D12 layout minimal (status bar + Quick Picks + CodeLens + mini-player 3 lignes dans le Panel), container complet en option `llmVoice.ui.layout`.
- **Alternatives rejetées** : Secondary Side Bar par défaut (non ciblable par une extension) ; View Container complet par défaut (place) ; espeak comme niveau léger (qualité).
- **Agent** : concierge (Marcel) sur études general-purpose (Sonnet)

### [2026-09-08] Phase 1 livrée : repo public llm-voice, CI verte, protection active
- **Contexte** : exécution après revue Sentinel (GO avec corrections).
- **Décision** : repo https://github.com/Guilhem-Bonnet/llm-voice ; commit racine 99c640e ; HEAD 17fbf8e ; 7 jobs CI requis ; plus de merge `--admin` à partir de la phase 2 ; triage des 10 PR Dependabot confié à Flow (Haiku) en ouverture de phase 2.
- **Agent** : concierge (Marcel) ; exécution pipeline-architect (Sonnet)
### [2026-09-08] Règle de merge tant que le projet est solo
- **Contexte** : branch protection exige 1 review humaine ; un seul mainteneur.
- **Décision** : les PR d'agents sont revues par Sentinel (commentaire consigné dans la PR), puis mergées en squash `--admin` par l'orchestrateur. Les PR Dependabot majeures ne sont jamais mergées sans CI verte et note de compatibilité. Règle à revoir dès qu'un second mainteneur arrive.
- **Agent** : concierge (Marcel)

### [2026-09-08] Économie de tokens en phase 2 : Opus limité aux ADR difficiles
- **Décision** : Opus sur ADR-001..005 uniquement ; Sonnet sur ADR-006..011, fakes, revue ; Haiku sur Dependabot. Agents en worktrees isolés, une branche et une PR chacun.
- **Agent** : concierge (Marcel)

### [2026-09-08] Phase 2 livrée : 11 ADR, contrats src/core, outillage de test
- **Contexte** : 3 PR d'agents (#16, #17, #18) revues par Sentinel puis mergées ; 45 tests unitaires verts.
- **Décision** : phase 3 démarre par `EgressGuard` (garde réelle du badge Local), puis le slice vertical Markdown → segments → FakeTts → mini-player → highlight. Le hook Grimoire interdit `git push --force` : les agents rebasent par merge. `zod` sera bundlé par esbuild en phase 3.
- **Agent** : concierge (Marcel)

### [2026-09-08] Phase 3 livrée : slice vertical, AC-01..06 verts
- **Contexte** : 5 PR (#20-#24) revues et mergées ; 281 tests unit, 14 intégration, VSIX activable.
- **Décision** : phase 4 = providers réels (Chatterbox via compose ROCm, Ollama narrator, Piper léger), backoff/buffering/pinning, E2E réel sur la machine RDNA4 (AC-07..11). Règle apprise : toute URL assignée dans un webview passe par `new URL()` + allowlist (CodeQL), et un circuit breaker à 2 tentatives identiques.
- **Agent** : concierge (Marcel)

### [2026-09-08] Voix française par défaut : référence humaine SIWIS en mode clonage
- **Contexte** : premier E2E réel sur RX 9070 (ROCm, conteneur). Les voix prédéfinies de Chatterbox-TTS-Server sont toutes anglophones → accent anglais en français malgré `language_id=fr`. Référence Piper = timbre synthétique. Lectrice LibriVox jugée trop âgée par l'utilisateur.
- **Décision** : référence par défaut = extrait de la base SIWIS (locutrice française, CC BY 4.0, attribution dans `docs/voices.md`), Chatterbox en `voice_mode: clone`, paramètres = dernière combinaison validée à l'oreille par l'utilisateur (consignée dans le rapport E2E de Forge). L'utilisateur peut remplacer par sa propre voix (consentement, CdC §55). Le provider Chatterbox doit supporter le clonage (point de revue PR #28).
- **Alternatives rejetées** : voix prédéfinies anglophones ; Piper comme référence de clonage ; LibriVox (timbre non souhaité).
- **Agent** : concierge (Marcel), sur écoute et validation de guilhem-bonnet

### [2026-09-08] Phase 4 livrée : providers réels, E2E réel validé à l'oreille
- **Contexte** : PR #27, #28, #30 mergées ; 369 tests unit, 14 intégration, 5 E2E réels.
- **Décision** : Chatterbox passe par `/tts` natif (le endpoint compatible OpenAI ignore la langue) ; clonage de voix par défaut avec référence SIWIS ; phase 5 = inbox Claude + hook, profils (Quick Pick, `profiles.json`), status bar complète, commande Provider Status ; phase 6 = hardening, latence, docs, VSIX 0.1.
- **Agent** : concierge (Marcel)

### [2026-09-08] Phase 5 livrée : inbox Claude, profils, erreurs ; AC-01..17 couverts
- **Contexte** : PR #32, #33, #34 mergées ; 484 unit, 28 intégration, 5 E2E réels.
- **Décision** : phase 6 = audit sécurité (Opus, `src/claude` + `src/net` + webview), latence Chatterbox, E2E manuel complet par l'utilisateur (hook réel, VSIX), docs, CHANGELOG, tag v0.1.0.
- **Agent** : concierge (Marcel)

### [2026-09-09] Phase 6 livrée : audit, latence, docs ; release 0.1.0 prête
- **Contexte** : PR #36, #37, #38 mergées ; 751 unit, 37 intégration, 6 E2E réels ; TTFA 3,9 s.
- **Décision** : tag `v0.1.0` et release GitHub avec le VSIX, sans publication Marketplace (pas de `VSCE_PAT`). Windows et macOS restent non validés manuellement : la 0.1 est annoncée « Linux validé ». Suites possibles : test manuel utilisateur, PR Dependabot majeures, version 0.2 (Profile Editor, clipboard, historique, Kokoro, streaming, participant @voice).
- **Agent** : concierge (Marcel)

### [2026-09-09] Release v0.1.0 publiée
- **Contexte** : tag `v0.1.0` sur `95d55fe`, workflow Release vert.
- **Décision** : release GitHub publique avec `llm-voice.vsix` (265 Ko), sans publication Marketplace. Un correctif a été nécessaire : le job de release cherchait le VSIX sous `vscode-extension/` alors que le répertoire de travail était déjà celui-là.
- **Suite** : checklist de test manuel pour l'utilisateur (`_grimoire-output/team-build/manual-e2e-checklist-0.1.md`), puis 0.2 (Profile Editor, clipboard, historique, reprise, Kokoro, streaming, participant @voice) ou dette Dependabot.
- **Agent** : concierge (Marcel)
