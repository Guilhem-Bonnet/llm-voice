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
- **Étude modèles de décision (2026-09-27)** : `decision-models-jev-v1.md` (même dossier), §10 = vérification
  indépendante et arbitrage. **Retenu** : mode « Auto » = technique SemIf réimplémentée en TypeScript sur l'API native
  Ollama (logprobs prouvés localement, Ollama 0.21) ; Laya 322M en réserve (palier Python) ; Kev/Nimble/NanoJev/OpenJev
  écartés ; Jev cloud jamais par défaut. Spike sur 50 réponses étiquetées par l'utilisateur contre un témoin à règles
  avant tout code produit. Fonctionnalité 0.4, après ADR-012. Cartographie des points d'usage : `decision-points-map-v1.md`.
  **Exécution du 2026-09-27 (session concierge, 7 cartes du Mission Ledger)** : closes — `GAO-narrateur-in-001`
  (qwen2.5:7b installé, `/api/chat` structuré prouvé), `GAO-cartographie-001` (`decision-points-map-v1.md` livré,
  27 chemins vérifiés), `GAO-adr-013-four-001` (`docs/adr/ADR-013-decision-provider.md`, statut Proposé, relu par
  Sentinel sans point bloquant), `GAO-spike-valuat-001` (outillage `vscode-extension/scripts/decision-spike/`, chaîne
  prouvée sur 9 réponses synthétiques ; **mesure réelle impossible : inbox vide, hook Claude non installé** →
  l'utilisateur doit lancer « LLM Voice: Install Claude Hook », étiqueter 50 réponses dans `~/.llm-voice/eval/`, relancer
  `run-all.mjs`). Bloquée : `GAO-mode-auto-im-001` (attend ADR-012 + spike gagnant). À trancher : `GAO-fournisseur-001`
  (Jev cloud), `GAO-file-de-lect-001` (file multi-fenêtres). `project-context.yaml` déclare désormais
  `needs.commands.test-runner` → les gates exécutent `npm --prefix vscode-extension run test:unit`.
- **Veille briques existantes (2026-09-27)** : `_grimoire-output/research/reports/Briques existantes pour LLM Voice.md`
  (notes sourcées dans `research_notes/`). Retenus : sherpa-onnx, mpv IPC, pdf.js/mammoth/Readability ; risque Piper GPL-3.0
  et non-vérifiés listés dans decisions-log du même jour.
- **ADR-012 (accepté 2026-09-27, rédigé 2026-09-28)** : `docs/adr/ADR-012-native-audio-core.md` — lecture audio native par un Core Rust
  minimal `llm-voice-core` (loopback, jeton, instance unique, aucune socket sortante) ; orchestration en TypeScript ; ADR-001 remplacé.
- Routage LLM : Fable = orchestration/gates uniquement ; Opus = ADR, state machine, audit sécurité ;
  Sonnet = code/tests/revues ; Haiku = CI/docs/mémoire. **Toujours passer `model:` au dispatch**
  (les agents `.claude/agents/*.md` en `inherit` tourneraient sinon sur Fable).
  Registre de référence : `_grimoire/standard/llm-provider-registry.yaml`.
- Vérificateur ≠ auteur, contexte neuf. Gate de phase = `grimoire standard gate check --task-id <id-ledger> --strict`.
- **Depuis le 2026-09-13, chaque phase est une carte du Mission Ledger** (`grimoire task add … -a … ; claim ; move --to running`) :
  le board `_grimoire/standard/task-board.yaml` est projeté depuis le ledger (`_grimoire-runtime-output/ledger/events.jsonl`) et
  rend le gate opposable ; les preuves vont sous `_grimoire-output/evidence/<id-ledger>/` (enveloppe, pack), plus
  `grimoire task context <id>` et `grimoire standard decision trace --task-id <id>`. Un id hors board (dont l'ancien
  `bootstrap`) donne `gate.task_not_on_board`. Les critères d'acceptation doivent nommer un verdict reconnu (gate, test, lint)
  pour sortir de la classe de vérifiabilité V2. Première carte : `GAO-phase-10-gri-001` (closed · accepted).
- **Agents disponibles depuis Grimoire Kit 3.46.1 (2026-09-13)** — 9 agents, 10 skills attachés :

  | Rôle dans le plan maître v1 | Agent 3.46 à dispatcher | Skill à nommer dans le brief | Modèle |
  |---|---|---|---|
  | Marcel (orchestration) | `concierge` (boucle principale) | — | Fable |
  | Archie (ADR) | `platform-architect` | — | Opus puis Sonnet |
  | Stack (code TS, tests) | `backend-engineer` | — | Sonnet |
  | Convoy (release, VSIX) | `backend-engineer` | `platform-deploy-release` | Sonnet |
  | Guardian (santé providers, erreurs) | `backend-engineer` | `platform-reliability-sre` | Sonnet |
  | Flow (CI GitHub Actions) | `ops-engineer` | `infra-pipeline-cicd` | Haiku |
  | Vault (durcissement, secrets, CSP) | `ops-engineer` | `infra-security-hardening` | Sonnet |
  | audit offensif pré-release | `security-auditor` (nouveau) | — | Opus |
  | Sentinel (revue indépendante) | `agent-optimizer` | — | Sonnet |
  | Atlas (README, docs, repo map) | `agent-optimizer` | `meta-project-navigation` | Haiku |
  | Mnemo (qualité mémoire) | `agent-optimizer` | `meta-memory-quality` | Haiku |
  | Vulcan (outillage, fakes) | `agent-optimizer` | `meta-toolsmithing` | Sonnet |
  | Loop (fix-loop) | `fix-loop-orchestrator` | — | Sonnet → Opus si stérile |
  | Forge (docker-compose, infra locale) | `ops-engineer` | — | Sonnet |

  Un skill attaché vit dans `_grimoire/kit/skills/<skill>.md` et est replié dans le fichier hôte de son
  agent porteur : le brief du sous-agent doit nommer le skill pour qu'il l'applique.
- Garde-fous de session (`_grimoire/standard/policies.yaml`) : `git push`, `gh pr merge`, `gh release`
  demandent une approbation utilisateur une fois par session ; rafale de `rm` → refroidissement ;
  budget indicatif 400 écritures / 2000 appels d'outils par session.
- Hooks git Grimoire installés (`grimoire hooks install`) : `pre-commit` exécute `cc-verify.sh --changed-only`
  sur les fichiers `.ts/.sh/.py` stagés ; `commit-msg` refuse un message < 10 caractères ; `post-commit`
  journalise dans `_grimoire-output/Grimoire_TRACE.md`. Bypass déconseillé : `git commit --no-verify`.
- Concierge : quand aucun spécialiste ne convient, appeler `grimoire agent-miss --category <catégorie>`
  avant de router vers un généraliste (jamais le contenu de la demande).

## Conventions

- Langue de communication : Français
- Conventional Commits, SemVer, trunk-based, PR obligatoire sur `main`
- Toutes les décisions sont loggées dans `decisions-log.md`
- Briefs de sous-agents préfixés `MODE NON-INTERACTIF` ; sortie dans un fichier, retour ≤ 10 lignes

## Requêtes inter-agents

- [ ] [forge→backend-engineer] `OpenAICompatibleTtsProvider` (`vscode-extension/src/tts/OpenAICompatibleTtsProvider.ts`)
      ne colle pas au contrat réel de Chatterbox-TTS-Server (confirmé en E2E réel, S4.3, 2026-09-08,
      `docs/e2e/report-2026-09-08.md`) : (1) `POST /v1/audio/speech` répond HTTP 422 sans `model` **et**
      `voice` dans le corps — le provider ne les envoie que `if (request.xxx !== undefined)`, donc un
      `TtsRequest` sans voix/modèle explicite (cas courant) échoue contre ce serveur ; (2)
      `GET /v1/audio/voices` répond `{ status, voices: string[] }` (noms de fichiers, ex. `"Emily.wav"`),
      pas `{ voices: { id, name, language }[] }` — `listVoices()` mapperait chaque entrée sur `id:
      undefined`. À réconcilier (soit adapter le provider à ce serveur précis, soit documenter/adapter
      côté `deploy/tts/config.yaml` un contrat différent) avant de considérer ADR-009 "un seul code pour
      1/2/3" validé de bout en bout contre ce serveur communautaire.
      **(3) Accent anglophone confirmé sur du texte FR** (retour utilisateur, diagnostiqué 2026-09-08,
      2 itérations) : `POST /v1/audio/speech` accepte un champ optionnel `language` (schéma
      `OpenAISpeechRequest`), mais l'envoyer (`"language":"fr"`) produit un WAV **strictement
      identique octet pour octet** à ne pas l'envoyer (checksums MD5 comparés) — donc **ignoré** par cet
      endpoint sur ce serveur. `POST /tts` (endpoint natif, hors contrat OpenAI), lui, **honore** bien
      `language` (checksums différents entre `language` absent/`"fr"`/`"en"` sur les mêmes texte/voix).
      Modèle bien `chatterbox-multilingual` chargé côté serveur (logs : `ChatterboxMultilingualTTS`,
      23 langues dont `fr` confirmées via `GET /api/model-info`) — ce n'est donc pas un modèle anglais
      chargé par erreur, c'est spécifiquement `/v1/audio/speech` qui n'applique pas `language`. Aucune
      voix prédéfinie étiquetée française parmi les 28 embarquées (`GET /get_predefined_voices`), ni
      dans `reference_audio/` (`Gianna.wav`, `Robert.wav`) — probable accent résiduel même avec
      `language` correctement appliqué ; le clonage vocal avec un échantillon FR (CdC §55) reste la
      vraie solution pour une voix nativement française. **Pertinent pour `ChatterboxProvider` (PR #28)**
      si ce serveur communautaire est retenu comme défaut livré : il devra soit utiliser `/tts` au lieu
      de `/v1/audio/speech` pour que `language` soit pris en compte, soit documenter/contourner
      autrement. Non corrigé ici (hors périmètre ops, S4.3) ; validation à l'oreille du résultat non
      faite par cet agent (pas de perception audio) — un humain doit confirmer sur
      `~/.llm-voice/e2e/reference.wav` (régénéré via `/tts` + `language=fr`, `docs/e2e/report-2026-09-08.md`).
      **Cause racine confirmée par retour utilisateur direct** : les 28 voix prédéfinies sont anglophones,
      Chatterbox clone l'accent de la référence quel que soit `language`. `voice_mode: "clone"` avec une
      référence FR (testé : Piper `fr_FR-siwis-medium` synthétique, puis extrait LibriVox humain domaine
      public, 3 jeux de paramètres A/B/C) améliore le résultat mais reste un correctif, pas une solution
      produit. **Le mode voix prédéfinie du serveur communautaire donne un accent anglais en français ;
      le provider Chatterbox doit supporter `voice_mode: clone` avec un échantillon français, et LLM
      Voice doit embarquer ou générer une référence FR par défaut (Piper siwis) — point de revue pour la
      PR #28 et exigence CdC §55.** Détail complet, sources et tableau latence/paramètres :
      `docs/e2e/report-2026-09-08.md`.
