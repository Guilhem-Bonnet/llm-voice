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

### [2026-09-09] Phase 7 et release 0.1.1 : l'extension marche sans rien installer
- **Contexte** : retour utilisateur après installation réelle de la 0.1.0 (aucun son sans Chatterbox, page vide, Play muet, fonctions introuvables).
- **Décision** : trois niveaux de voix (système sans installation → Piper guidé → Chatterbox), sélection automatique du provider (`llmVoice.tts.provider = "auto"`), parcours de découverte à la première activation, README dans le VSIX, aucune commande silencieuse. Publié en v0.1.1.
- **Règle instaurée** : toute release passe par un test d'acceptation sur un profil VS Code neuf, sans service tiers démarré.
- **Agent** : concierge (Marcel)

### [2026-09-11] Zéro Docker : la voie par défaut doit être autonome
- **Contexte** : retour utilisateur — « le fait que Docker manque est un souci, les utilisateurs grand public ne l'installent pas eux-mêmes, il faut que tout soit autonome ». La 0.1.1 présentait encore Chatterbox/Docker comme la voie de référence.
- **Décision** : la voie par défaut devient un moteur TTS autonome installé en un clic, sans Docker ni Python (Piper : binaire natif + modèle ONNX téléchargés, ou moteur ONNX intégré au processus de l'extension si l'évaluation est concluante). Chatterbox est rétrogradé en option avancée, clairement marquée « nécessite Docker », jamais proposée comme prérequis. La voix système reste le repli immédiat.
- **Contrainte acceptée** : la meilleure qualité (Chatterbox + clonage) reste derrière Docker ; c'est un compromis assumé et affiché, pas un défaut caché.
- **Agent** : concierge (Marcel)

### [2026-09-11] Phase 8 livrée : autonomie sans Docker, confort des voix, outillage à jour
- **Contexte** : PR #48, #49, #47 mergées ; 919 tests unitaires ; VSIX 307 Ko.
- **Décision** : Piper devient le moteur par défaut, installé à la demande sans Docker ni Python (moteur intégré `kokoro-js` rejeté sur preuves : 737 Mo, aucune voix française réelle). Chatterbox reste l'option qualité maximale derrière Docker. Trois nouvelles commandes : parcourir les voix avec écoute, utiliser sa propre voix, éditer un profil en interface graphique.
- **En attente** : arbitrage utilisateur sur la qualité de la voix Piper par défaut ; retest de la 0.1.1 ; issue #50 (test AC-07 instable).
- **Agent** : concierge (Marcel)

### [2026-09-12] Vue dédiée dans la barre d'activité, sur demande utilisateur
- **Contexte** : test réel de la version 0.2. « le raccourci ctrl+alt+v n'est pas intuitif en procédure de démarrage, je préfère avoir une fenêtre dédiée à l'outil dans VS Code, comme Claude avec son chat ou GitFlow avec sa vue ».
- **Décision** : l'ADR-011 est révisé. Le point d'entrée devient une icône dans la barre d'activité ouvrant une vue dédiée LLM Voice (lecture en cours, inbox, profils, actions), affichée par défaut. Le raccourci en accord et la disposition minimale restent disponibles mais ne sont plus le chemin principal.
- **Alternative rejetée** : garder la disposition minimale par défaut (mon choix initial, jugé non découvrable à l'usage réel).
- **Agent** : concierge (Marcel), sur décision de guilhem-bonnet

### [2026-09-13] Phase 10 : Grimoire Kit 3.38.0 → 3.46.1, profil `controlled`, workflow adapté
- **Contexte** : CLI locale en 3.40.0, kit du projet généré en 3.38.0, dernière version publiée 3.46.1. Demande utilisateur : « met à jour le grimoire du projet avec la dernière version et adapte le workflow pour utiliser tous les meilleurs éléments de la nouvelle version, pense à nettoyer ensuite ».
- **Décision** : `pipx upgrade grimoire-kit` puis `grimoire up` (refresh kit, standard, host_sync sur 5 hôtes). Le profil du standard passe de `starter` à `controlled` (need `provider-neutral`), exigé par l'archétype `agentic-standard` depuis 3.46.1. Éléments adoptés : politiques temporelles par session (`policies.yaml` : approbation de `git push`/`gh pr merge`/`gh release` une fois par session, refroidissement `rm`, budget de session), registre de fournisseurs rempli avec le routage réel (Anthropic 4 paliers + Ollama local), registre d'outils avec les 9 serveurs MCP déclarés (8 Hostinger hors périmètre), matrice de risques et registre d'incidents avec owner, déclaration de conformité, hooks git Grimoire (6/6), 5 nouveaux hooks Claude Code (`UserPromptSubmit`, `PostToolUse`, `PreCompact`, `SubagentStop`, `Stop`), commandes `/grimoire-gate`, `/grimoire-proof`, `/grimoire-verify`, agent `security-auditor`.
- **Refonte des agents (kit 3.42)** : 18 agents → 9 agents + 10 skills attachés. Dix fichiers d'agents devenus skills (art-director, creative-toolsmith, memory-keeper, project-navigator, pipeline-architect, security-hardener, backup-dr-specialist, k8s-navigator, deploy-orchestrator, reliability-engineer) et trois manifestes d'équipe fantômes (team-build/ops/vision, retirés du kit en 3.42) supprimés du kit et des surfaces hôtes, car `grimoire up` régénère mais ne retire pas. La table de correspondance ancien rôle → agent + skill est dans `shared-context.md`.
- **Alternative rejetée** : `grimoire init --force` pour régénérer `.github/copilot-instructions.md` (écraserait `project-context.yaml`) ; le fichier est mis à jour à la main puisque le kit le considère comme appartenant au projet.
- **Décision d'acceptation phase 0** enregistrée a posteriori (`accepté`, preuves : repo créé le 2026-09-08, v0.1.0 le 2026-09-09) pour lever l'avertissement `acceptance.decision_pending`.
- **Agent** : concierge (Marcel)
- **Complément (hook `Stop`)** : le hook signalait `bootstrap` sans état sur un board inexistant. La phase 10 est enregistrée comme première carte du Mission Ledger (`GAO-phase-10-gri-001`, closed · accepted), le board est projeté et vérifié ; en conséquence les gates des anciens ids (`bootstrap`, `phase-N`) répondent désormais `gate.task_not_on_board` — les phases passées gardent leurs dossiers de preuve, les prochaines phases ouvrent une carte ledger.

### [2026-09-27] Mode « Auto » : SemIf sur Ollama retenu pour le spike, Laya en réserve, Jev cloud jamais par défaut
- **Contexte** : l'utilisateur veut qu'un pseudo-profil « Auto » choisisse le profil de lecture d'une réponse Claude (3–4 options). Une session précédente avait classé Laya premier (`decision-models-jev-v1.md` §5). Vérification indépendante des sources (§10 du même document) : écosystème Jev à profil de ferme SEO, et Ollama expose bien les logprobs sur son API native (testé localement, Ollama 0.21.0, qwen2.5:3b, distribution A/B/C retournée).
- **Décision** : le fournisseur de décision local par défaut est la technique SemIf réimplémentée en TypeScript sur `/api/generate` d'Ollama (logprobs du premier jeton parmi des options à une lettre). Laya 322M multilingue reste en réserve comme palier avancé Python si SemIf ne bat pas trois règles simples sur un jeu de 50 réponses étiquetées par l'utilisateur. Kev, Nimble, NanoJev, OpenJev écartés. Jev cloud uniquement derrière `privacy.localOnly = false`. Aucun nouveau composant à installer chez l'utilisateur ; sans Ollama, « Auto » se replie sur `profiles.bySource`.
- **Alternatives rejetées** : Laya en premier (Python + fine-tuning, contraire à la voie « rien à installer ») ; basculer le narrateur sur llama.cpp pour obtenir les logits (inutile, Ollama natif les fournit) ; étiquetage du jeu d'évaluation par un LLM (apprendrait le goût du LLM, pas celui de l'utilisateur).
- **Calendrier** : fonctionnalité 0.4, après ADR-012 (son). Cartographie des points d'usage et d'implémentation en cours (`_grimoire-output/planning-artifacts/decision-points-map-v1.md`).
- **Agent** : concierge (Marcel), validé par guilhem-bonnet (« Ok, enregistre »)

### [2026-09-27] Veille « briques existantes » : sherpa-onnx, mpv IPC, pdf.js/mammoth/Readability ; Piper 2025 sous GPL-3.0
- **Contexte** : demande utilisateur de chercher des projets équivalents ou des briques à récupérer avant la maquette. Rapport : `_grimoire-output/research/reports/Briques existantes pour LLM Voice.md` (7 dossiers de notes sourcées).
- **Constats enregistrés** : aucun projet réutilisable en bloc ; aucune source ne documente une lecture audio native gapless avec surlignage dans VS Code (développement propre à budgéter, quelle que soit l'architecture). Briques à intégrer : sherpa-onnx (Apache-2.0, TTS+STT+VAD, addon Node, charge les modèles Piper ONNX) ; mpv en sous-processus piloté par IPC JSON (seule voie documentée avec pause/position/gapless/PCM stdin, à bundler par plateforme via `vsce --target`) ; pdfjs-dist ou unpdf + mammoth + officeParser + Readability pour l'ingestion ; Docling (MIT) en palier Python optionnel. Patrons à imiter : découpage de flux en phrases avec `Intl.Segmenter`, concaténation PCM sans crossfade et position par octets écrits (RealtimeTTS, Pipecat) ; VoiceMode comme serveur MCP voix pour Claude Code.
- **Risque de licence** : la réécriture 2025 de Piper (piper1-gpl) est en GPL-3.0 alors que Piper est notre moteur par défaut depuis la phase 8 ; sortie envisagée : garder les voix (siwis CC-BY) et charger les modèles via sherpa-onnx. Statut juridique d'un binaire GPL lancé en sous-processus à valider, pas à déduire. À écarter : MuPDF (AGPL), poids XTTS-v2 / F5-TTS / Fish Speech (non commerciaux).
- **Point contesté** : le rapport recommande kokoro-js pour le français ; la décision du 2026-09-11 l'a rejeté sur preuves (737 Mo, aucune voix française réelle). La décision du projet prévaut.
- **Non vérifié, à prouver par test direct avant ADR-012** : persistance du geste utilisateur dans un webview après un cycle masqué/affiché ; mpv embarqué sous PipeWire, Windows 11 et sandbox macOS ; licence de node-web-audio-api. ONNX Runtime a retiré ROCm depuis la 1.23 : chemin Node = CPU, GPU via serveurs Python.
- **Agent** : concierge (Marcel), sous-agents de recherche Sonnet

### [2026-09-27] Langage du Core : débat Rust / Go / TypeScript, verdict du juge = option E (Core Rust minimal + orchestration TS), **proposé, en attente de validation utilisateur**
- **Contexte** : l'utilisateur a remis en cause le choix TypeScript pour le démon LLM Voice Core (« Rust est mon préféré, surtout pour les IA ») et demandé un débat en sous-agents. Trois plaidoiries sourcées (Sonnet) : `_grimoire-output/research/debate-language-core/position-{rust,go,typescript}.md`. Juge indépendant Opus (platform-architect), synthèse : `_grimoire-output/planning-artifacts/debat-langage-core-synthese-v1.md`.
- **Verdict (scores pondérés /100)** : E Core Rust minimal (audio puis inférence) + orchestration TS 82,1 ; D TS + module Rust napi-rs audio seul 81,6 ; F TS + mpv sous-processus 72,1 ; A Rust pur 66,4 ; C TS pur 59,9 ; B Go pur 54,4. D et E sont à égalité dans la précision de l'exercice et partagent le même moteur Rust : D est le repli de E ; F sert de référence de mesure au spike.
- **Faits décisifs** : (1) le refus d'autoplay mesuré impose une lecture native, aucune option Node sans compilation ne la couvre, donc composant natif et matrice `vsce --target` inévitables ; (2) `AudioSink` est déjà une interface séparée testée avec un faux lecteur ; `PlaybackController.ts` (593 l.) et `AudioQueue.ts` (586 l.) n'importent pas `vscode`, `Pipeline.ts` (2 329 l.) l'importe : remplacer la surface de lecture conserve les tests, sortir l'orchestration obligerait à découper `Pipeline.ts`.
- **Réponse à « surtout pour les IA »** : Rust n'est réellement supérieur ici que pour candle et pour brancher la synthèse directement sur la sortie audio dans un même processus ; Ollama, Chatterbox, le SDK MCP et sherpa-onnx (Node, Go, Rust) ne départagent pas ; aucun langage ne rend le GPU ROCm à ONNX Runtime (retiré en 1.23).
- **Affirmations rejetées** : chiffres génériques Node vs Rust (RSS, démarrage) issus de blogs sans méthode ; position TS : 24 fichiers importent `vscode` (pas 25), 87/111 sans import (78 %), « `src/pipeline/` prêt pour le démon » faux.
- **Statut** : proposé. La décision appartient à guilhem-bonnet ; ADR-012 sera rédigé après sa validation (carte ouverte le même jour). Risque signalé : aucun spécialiste Rust dans l'équipe d'agents, brief Rust explicite requis pour `backend-engineer`.
- **Agent** : concierge (Marcel) ; juge `platform-architect` (Opus) ; avocats Sonnet

### [2026-09-27] Langage du Core : **option E validée par l'utilisateur** — Core Rust minimal (audio puis inférence locale) + orchestration TypeScript dans l'extension
- **Contexte** : suite du débat Rust / Go / TypeScript (entrée précédente, verdict du juge proposé).
- **Décision** : guilhem-bonnet valide l'option E (« Ok, je valide l'option E », 2026-09-27). ADR-012 sera rédigé sur cette base (carte `GAO-adr-012-lect-001`, passée en `ready`). Option D (TS + module Rust napi-rs audio seul) reste le repli documenté, même moteur Rust. Aucun spécialiste Rust dans l'équipe d'agents : chaque carte Rust porte un brief Rust explicite pour `backend-engineer`.
- **Maquette** : brief validé en même temps — périmètre produit entier (vue VS Code + futur client bureau dans une même charte), haute fidélité alignée sur les thèmes VS Code sombre et clair, identité discrète native (Codicons, couleurs du thème, une seule couleur d'accent pour la lecture en cours). Carte `GAO-maquette-com-001`.
- **Agent** : concierge (Marcel), sur décision de guilhem-bonnet

### [2026-09-28] ADR-012 rédigé : lecture audio native hors webview, Core Rust minimal `llm-voice-core`
- **Contexte** : option E validée le 2026-09-27 (entrée précédente). Carte `GAO-adr-012-lect-001`.
- **Décision** : `docs/adr/ADR-012-native-audio-core.md`, statut Accepté (2026-09-27). Core Rust spawné par l'extension, HTTP + WebSocket sur 127.0.0.1 avec jeton et contrôle `Origin`/`Host`, instance unique par verrou 0600, aucune connexion sortante ; lecture native d'abord, sherpa-onnx ensuite derrière `CoreTtsProvider` ; jonction `NativeAudioSink` + `AudioSink` v2 (préchargement, position absolue, underrun) ; 5 cibles `vsce --target` ; `extensionKind: ["ui"]` conservé. ADR-001 remplacé (webview `<audio>` = repli sur clic), ADR-011 révisé (webview = affichage), ADR-009 inchangé. Repli : D (napi-rs, même crate) si cycle de vie ou audit échouent ; F (mpv) si le spike Rust échoue au banc.
- **Agent** : platform-architect (Archie), vérification indépendante agent-optimizer (Sonnet)

### [2026-09-28] Phasage par OS et organisation en sprints
- **Contexte** : demande utilisateur — « on commence par Fedora avec Wayland, version principale ; Mac possible ; Windows envisagé dans le futur ».
- **Décision** : cible principale **Fedora / Wayland / PipeWire (linux-x64)** jusqu'à la release 0.3 ; **macOS** (darwin-arm64 puis x64, CoreAudio, signature et notarisation) en S3 ; **Windows** (win32-x64, WASAPI, SmartScreen) en S4, conditionnel. Amende ADR-012 : le packaging 5 cibles devient progressif, la carte `GAO-packaging-5-001` est bloquée au profit de `GAO-s1-fedora-pa-001`. Cartes préfixées par sprint : S0 hygiène, S1 Fedora, S2 design, S3 macOS, S4 Windows ; dépendances déclarées dans le ledger.
- **Règle de design** (utilisateur) : un bouton a une taille fixe, ne s'étire jamais et ne passe jamais à la ligne ; c'est le contenu autour qui s'adapte. Critère automatisé dans la carte `GAO-s2-design-ma-001`.
- **Agent** : concierge, sur décision de guilhem-bonnet

### [2026-09-28] Protocole Core v1 : commandes sur HTTP, événements sur WebSocket (clarification d'ADR-012 §4), **proposé, à confirmer**
- **Contexte** : carte `GAO-protocole-co-001` — écrire les JSON Schema (draft 2020-12) et les exemples de référence du protocole Core v1, testés des deux côtés (vitest/ajv, cargo test/serde). ADR-012 §4 plaçait « les commandes et les événements » tous les deux sur la WebSocket, HTTP réservé à `GET /health`.
- **Décision (autonome, mode non-interactif)** : `contracts/core-v1/` sépare les deux — `POST /v1/{enqueue,play,pause,resume,stop,seek}` en HTTP synchrone (jeton dans le corps de chaque requête, réponse `ack.response`), et sept événements asynchrones sur la WebSocket (`state`, `position`, `segment_started`, `segment_ended`, `underrun`, `ended`, `error`, sans jeton par message : la connexion elle-même est authentifiée à l'ouverture). Raison : requête/réponse HTTP est plus simple à tester des deux côtés qu'un multiplexage commandes+événements sur un seul canal WS, et sépare proprement le rejet synchrone d'une commande (`ack.response.ok:false`) d'une erreur asynchrone (`error` event).
- **Statut** : implémenté dans le contrat et les deux suites de tests (vitest 37/37, `cargo test` 2/2 sur `llm-voice-protocol`) ; **pas encore confirmé par guilhem-bonnet ni répercuté sur le texte d'ADR-012 §4**, qui reste à jour avec l'ancienne esquisse (tout sur WS). À trancher avant l'implémentation du binaire `llm-voice-core` : soit amender ADR-012, soit revenir au tout-WS.
- **Autre clarification** : `segment_ended` est explicitement soumis à la même règle que `ended` (CL-004, `GAO-spike-moteur-001`) — posté seulement après vidange complète du tampon audio, jamais dès l'écriture du dernier échantillon dans le tampon applicatif.
- **Agent** : backend-engineer, mode non-interactif, sur brief de l'orchestrateur

### [2026-09-28] Budget de session Grimoire relevé : 400 → 1 500 écritures, 2 000 → 3 000 appels
- **Contexte** : le budget de 400 écritures (fixé en phase 10) a été atteint en cours de sprint S1, bloquant deux cartes de code déléguées ; les écritures des sous-agents comptent dans la session. Les compteurs ont ensuite été remis à zéro sans trace d'une commande `reset-session` (origine non établie, signalée à l'utilisateur).
- **Décision** : plafond relevé dans `_grimoire/standard/policies.yaml` (`per_session`) sur accord de guilhem-bonnet (« tu peux continuer »), en réponse à la proposition explicite du concierge. Les approbations de `git push`, `gh pr merge`, `gh release` restent inchangées.
- **Agent** : concierge

### [2026-09-28] Sortie audio du Core : comportement d'application de bureau sous PipeWire
- **Contexte** : validation Wayland (GAO-s1-fedora-va-001) — le Core ne suivait pas un changement de sortie par défaut ; cause : WirePlumber restaure la sortie mémorisée de chaque application (entrée `PipeWire ALSA [llm-voice-core]` → `sc_media`).
- **Décision** : LLM Voice se comporte comme toute application de bureau (sortie mémorisée, déplaçable dans les réglages son). Le Core est lancé avec une identité PipeWire stable (`application.name "LLM Voice"`, `media.role "Accessibility"`) pour être visible et réglable par l'utilisateur. Pas de forçage de cible dans le produit ; le banc de preuve garde son ciblage explicite.
- **Alternative rejetée** : forcer le suivi du défaut système (contraire au fonctionnement PipeWire, empêcherait l'utilisateur de dédier LLM Voice à une sortie).
- **Agent** : concierge

### [2026-09-29] ADR-015 « Direction de lecture » acceptée
- **Contexte** : demande utilisateur — pas de règles de prosodie codées en dur (effet robot) ; consigne de jeu par phrase venue d'un LLM qui voit tout le contexte ; mémoire des personnages ; narrateur distinct ; valable aussi pour la documentation et les réponses d'IA. Architecture multi-agents proposée par le concierge, ADR rédigée par platform-architect (Opus), relue par un vérificateur indépendant (accepter avec corrections, appliquées).
- **Décision** : cinq rôles (analyste, bible des personnages, metteur en scène, traducteur moteur, contrôleur) ; partition par segment indépendante du moteur ; mémoire en ajout seul, le LLM n'écrit que dans la portée du document ; garde-fous en bornes, jamais en règles de style ; repli non dirigé en cas de panne, de retard ou de mode jeu (gpu-yield) ; désactivée par défaut jusqu'à une écoute A/B ≥ 7/10. Moteur à consignes non choisi : banc d'une journée (Qwen3-TTS, Fish S2 Pro, Kyutai Pocket TTS, témoin Chatterbox).
- **Agent** : concierge, sur validation de guilhem-bonnet (« ok je valide »)

### [2026-11-05] Refonte UX : voix et mode de lecture séparés, périmètre resserré
- **Contexte** : l'utilisateur ne comprend pas qu'il faille passer par un profil pour choisir une voix ; audit `docs/ux/audit-2026-11-05.md` et maquette https://claude.ai/artifact/MKLSqQJXmNhPBc2LczJonj (mission MIS-refonte-ux-llm-voice-002).
- **Décision** : voix globale séparée du mode de lecture ; le mot « profil » quitte l'interface (profils et identifiants conservés, commandes en alias, ADR-017 à rédiger). Une seule maquette, la nouvelle, qui reprend de celle de septembre le thème clair, la planche système et les états déjà dessinés. Mode Auto et badges de direction en emplacements réservés. Livraison par étapes : galerie et panneau testables dès qu'ils sont prêts.
- **Hors périmètre** : Documents et Dialogue (proposition, derrière ADR-014), tri des réponses (après le mode Auto), client bureau (cartes S3 et S4).
- **Agent** : concierge, sur validation de guilhem-bonnet (« ok je valide »)

### [2026-11-05] Refonte UX : maquette validée, échantillons embarqués
- **Décision** : maquette https://claude.ai/artifact/MKLSqQJXmNhPBc2LczJonj validée ; courts échantillons compressés des voix inclus dans le VSIX (pas de modèle) ; catalogue limité à 20 voix Kyutai ; pas d'option « nouvelle interface », chaque écran refait remplace l'ancien.
- **Agent** : concierge, sur validation de guilhem-bonnet (« oui pour le tout »)

### [2026-11-05] ADR-017 : choix validés
- **Décision** : voix globale dans un fichier séparé ; vitesse = voix × mode ; fin de la disposition `minimal` ; mode dans une autre langue : voix globale conservée, avec avertissement et action « Donner une voix propre à ce mode ».
- **Agent** : concierge, sur validation de guilhem-bonnet (« Ok, vas-y. Envoie pour le tout. »)

### [2026-11-06] Voix : aucun service cloud
- **Décision** : le texte lu ne sort pas de la machine. Gemini, Voxtral API et les autres services distants sont écartés pour la recherche de voix de narration ; seules des solutions locales sont étudiées.
- **Agent** : concierge, sur décision de guilhem-bonnet (« je n'accepte pas que le texte sorte de la machine »)
