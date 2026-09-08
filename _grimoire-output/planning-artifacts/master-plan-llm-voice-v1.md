# Plan maître — LLM Voice (extension VS Code)

> Rédigé par Marcel (concierge) le 2026-09-08. Version 1.
> Objectif : livrer le MVP 0.1 du cahier des charges avec une équipe d'agents Grimoire,
> en réservant Fable 5.1 à l'orchestration et aux gates, et en routant le travail
> courant vers Sonnet 5 / Haiku 4.5.
>
> Rapports associés (même dossier) : `review-cdc-v1.md`, `brainstorm-llm-voice-v1.md`,
> `security-privacy-review-v1.md`, `github-repo-ci-plan-v1.md`.

---

## 1. Reformulation de la demande

Tu veux transformer le cahier des charges « LLM Voice » en un projet exécutable :
un repo GitHub public, une équipe d'agents avec un modèle LLM adapté à chaque rôle,
une chaîne de vérification indépendante de l'implémentation, et une pyramide de
tests qui couvre les 17 critères d'acceptation du MVP. Le tout en dépensant le
minimum de tokens Fable.

## 2. Règles de routage LLM (économie de tokens)

### 2.1 Grille de coût par tâche

| Tier | Modèle | Réservé à | Jamais pour |
|---|---|---|---|
| T0 | **Fable 5.1** (boucle principale) | Triage, handoffs, arbitrage de conflits entre agents, gate de fin de phase (lit l'evidence-pack, pas le code) | Écrire du code, des YAML, de la doc, lire des fichiers longs |
| T1 | **Opus 5** | ADR d'architecture (phase 2), state machine playback + synchronisation, audit sécurité pré-1.0, debug bloquant après 2 échecs Sonnet | Boilerplate, tests unitaires simples, docs |
| T2 | **Sonnet 5** | Implémentation TS, tests, revues de code, fix-loop, revue sécurité courante | — (modèle par défaut) |
| T3 | **Haiku 4.5** | CI/CD YAML, README/docs, CHANGELOG, labels/issues, fixtures, mémoire Grimoire, lint | Décisions d'architecture, sécurité |

### 2.2 Règle d'escalade

```
Haiku échoue 1× → Sonnet
Sonnet échoue 2× sur le même symptôme (boucle stérile fix-loop) → Opus
Opus en désaccord avec un autre agent → Fable arbitre (≤ 1 page de contexte)
```

### 2.3 Piège détecté dans la configuration actuelle

Les fichiers `.claude/agents/*.md` sont générés par Grimoire avec `model: 'opus'`
ou `model: 'inherit'`. **`inherit` = Fable dans cette session.** Neuf agents
(security-hardener, systems-debugger, creative-toolsmith, project-navigator,
pipeline-architect, agent-optimizer, monitoring-specialist, memory-keeper,
deploy-orchestrator) tourneraient donc sur Fable par défaut.

Règle obligatoire : **tout dispatch passe le paramètre `model:` explicitement**
(voir tableau §3). Ces fichiers étant `grimoire:managed`, ne pas les éditer à la
main ; le routage se fait au dispatch.

### 2.4 Discipline de contexte (deuxième levier d'économie)

- Un sous-agent reçoit un brief autonome (contexte, objectif, contraintes, fichier
  de sortie, format de retour ≤ 10 lignes). Il ne reçoit jamais l'historique.
- Il **écrit dans un fichier** et retourne un résumé court. Fable ne lit le fichier
  complet que si le résumé signale un conflit.
- Préfixe obligatoire des briefs : `MODE NON-INTERACTIF : pas de greeting, pas de
  menu, pas d'attente d'input` (les personas Grimoire affichent sinon un menu et
  s'arrêtent).
- Un sous-agent ne relit pas le cahier des charges entier : on lui indique les
  sections utiles.

## 3. Équipe : agent → modèle → périmètre → vérificateur

| Agent Grimoire | Persona | Modèle | Périmètre sur LLM Voice | Vérifié par |
|---|---|---|---|---|
| concierge | Marcel | Fable | Orchestration, handoffs, gates de phase | Utilisateur |
| platform-architect | Archie | **Opus** (ADR) puis Sonnet | ADR-001..006, interfaces `SourceAdapter`/`TtsProvider`/`NarratorProvider`, découpage modules | Sentinel (Sonnet) + Fable gate |
| backend-engineer | Stack | **Sonnet** ; Opus pour `PlaybackController` + `SourceSynchronizer` | Tout le code TS de `vscode-extension/src` en TDD | Sentinel (Sonnet, contexte neuf) |
| pipeline-architect | Flow | **Haiku** | Repo, CI matrice 3 OS, release VSIX, Dependabot, CodeQL | Sentinel (Sonnet) |
| security-hardener | Vault | **Sonnet** ; Opus pour l'audit pré-1.0 | Modèle de menace, CSP webview, garde `localOnly`, inbox/hook, profils importés | Fable gate (lit findings uniquement) |
| reliability-engineer | Guardian | **Sonnet** | Health providers, erreurs, retry, cancellation, tests de résilience | Sentinel |
| fix-loop-orchestrator | Loop | **Sonnet** → Opus si boucle stérile | Tout bug après phase 3 : FER, oracle, regression check | Sentinel (clôture FER) |
| agent-optimizer | Sentinel | **Sonnet** | Revue indépendante de chaque livraison, evidence gates, CC PASS | Fable (échantillon) |
| creative-toolsmith | Vulcan | **Sonnet** | FakeTtsProvider, générateur de WAV de test, fixtures Claude, mock HTTP TTS/Ollama | Sentinel |
| ops-engineer | Forge | **Sonnet** | `docker-compose.dev.yml` Chatterbox + Ollama (ROCm), doc d'installation locale | Guardian |
| project-navigator | Atlas | **Haiku** | README, docs/, repo map, matrice de traçabilité AC ↔ tests | Sentinel |
| memory-keeper | Mnemo | **Haiku** | decisions-log, failure-museum, shared-context, mémoire Weaviate | Marcel |
| deploy-orchestrator | Convoy | **Haiku** | Tag, release GitHub, VSIX, notes de version | Flow |
| monitoring-specialist | Hawk | **Haiku** | Output Channel, niveaux de log, politique « jamais de contenu » | Vault |
| art-director | Frida | **Haiku** | Icône extension, webview player, visuels README | Utilisateur |
| systems-debugger | Probe | **Opus, à la demande** | Audio Linux, ROCm/gfx1201, Chatterbox-TTS-Server | Guardian |
| k8s-navigator, backup-dr-specialist | Helm, Phoenix | — | Hors périmètre (pas d'infra déployée) | — |

Règle d'indépendance : le vérificateur n'est jamais l'auteur, et reçoit un
contexte neuf (le diff, les tests, l'evidence-pack), pas la session de l'auteur.

## 4. Chaîne de vérification et de validation

```
Auteur (Sonnet/Haiku)
  │ écrit tests d'abord, code, lance la suite complète
  │ joint : commande + sortie + exit code (proof-of-execution)
  ▼
CC PASS  ── bash _grimoire/kit/framework/cc-verify.sh
  │
  ▼
Sentinel (Sonnet, contexte neuf)
  │ checklist : AC couverts ? tests réels ? pas d'autoplay ? pas de contenu loggé ?
  │ verdict écrit dans _grimoire-output/team-build/test-reports/<story>.md
  ▼
Revue spécialisée si L3  (architecture → Archie/Opus ; sécurité → Vault)
  │
  ▼
Fable gate de fin de phase
  │ lit uniquement : evidence-pack + résumé Sentinel + liste des déviations
  │ décision : GO / NO-GO / arbitrage
  ▼
Mnemo (Haiku) logge décisions + incidents
```

Niveaux d'autonomie (ALS) appliqués : L1/L2 (fichier local, CI) = l'agent fonce
et notifie ; L3 (interface publique, architecture, sécurité) = plan → validation
Sentinel → exécution ; L4 (push public, release Marketplace) = confirmation
utilisateur.

## 5. Pyramide de tests

### 5.1 Vue d'ensemble

```
            ┌──────────────────┐
            │  E2E réel  (~5%) │  Chatterbox + Ollama sur la machine dev, hors CI
            ├──────────────────┤
            │ Intégration (~20%)│  @vscode/test-electron + mocks HTTP, 3 OS en CI
            ├──────────────────┤
            │   Unit  (~70%)   │  vitest, pur TS, FakeTts/FakeNarrator
            ├──────────────────┤
            │ Statique (~5%)   │  tsc strict, eslint, audit deps, CodeQL, licences
            └──────────────────┘
   Transverse : sécurité/confidentialité, performance, contrat providers
```

Seuils CI : couverture unit ≥ 80 % lignes sur `parser/`, `playback/`, `profiles/`,
`claude/` ; 0 test rouge ; temps d'activation extension < 500 ms mesuré en intégration.

### 5.2 Niveau statique — propriétaire Flow (Haiku)

- `tsc --noEmit` en `strict`, `eslint` (règles no-floating-promises), `prettier --check`.
- `npm audit --audit-level=high`, `license-checker` (MIT/Apache/BSD/ISC only).
- CodeQL JS/TS sur PR et hebdo.

### 5.3 Niveau unit — propriétaire Stack (Sonnet), outillage Vulcan

| Module | Cas clés | Réf. CdC |
|---|---|---|
| `MarkdownParser` | headings, code fences, tables, frontmatter skip, positions MDAST → `sourceRange` | §11-13 |
| `Segmenter` | phrases FR/EN, abréviations, code inline, URL, 1-3 phrases par chunk, paragraphe en mode narration | §14, §33 |
| `SpokenTextNormalizer` | liens → label, images → alt, code → skip/read/explain | §13 |
| `Profile` + Zod | profils par défaut valides, import invalide rejeté, migration `schemaVersion` | §18-19, §47 |
| `AudioCache` | clé SHA256 stable, changement de paramètre = nouvelle clé, éviction | §37 |
| `ClaudeInbox` | 8 fixtures Stop (normal, long, code, vide, unicode, FR, ×10 concurrents, JSON invalide), nom de fichier, écriture atomique | §40-41, §79 |
| `NarrationSegment` mapping | 1→N, N→1, `sourceIds` inconnus rejetés, JSON hors schéma | §21, §61 |
| `PlaybackController` | state machine complète, Pause conserve position, Stop annule prefetch, `Next` sur dernier chunk → `completed` | §34-36 |
| `AudioQueue` | `maxConcurrentTtsJobs=1`, prefetch 2-3, cancellation propagée | §32, §62, §65 |
| `localOnly` guard | localhost/127.0.0.1/::1 acceptés ; toute autre URL refusée sans opt-in explicite | §80 |
| Erreurs providers | retry ≤ 2 puis Skip/Stop, offline ne lève jamais d'exception non gérée | §52 |

Invariant à tester explicitement (P0 du CdC) : **aucun chemin d'appel de
`ClaudeInbox.append()` vers `PlaybackController.play()`** — test statique par
recherche de dépendance + test unitaire « 10 dépôts inbox ⇒ 0 appel play ».

### 5.4 Niveau intégration — propriétaire Stack + Guardian (Sonnet)

Environnement : `@vscode/test-cli` + `@vscode/test-electron`, `xvfb-run` sur
Ubuntu, matrice ubuntu/windows/macos, providers = `FakeTtsProvider` (WAV
prégénérés de 200 ms) et `FakeNarratorProvider`, serveur HTTP mock pour
`/v1/audio/speech` et `/api/chat`.

| Scénario | Vérifie | AC |
|---|---|---|
| Ouvrir .md → `Speak Document` | session créée, ≥ 1 chunk, décoration posée sur la bonne Range | AC-01, 02 |
| Lecture de 3 chunks | le highlight avance, `revealRange` seulement si hors écran | AC-03, §17 |
| Play → Pause → Resume | index + position conservés, highlight conservé | AC-04 |
| Stop | audio arrêté, highlight retiré, jobs annulés | AC-05 |
| Sélection puis `Speak Selection` | seuls les segments de la sélection sont lus | AC-06 |
| Profil sans narration | 0 requête vers le mock narrator | AC-09 |
| Profil avec narration | requête structurée reçue, segments mappés | AC-10 |
| Dépôt d'un fichier dans l'inbox | TreeView mise à jour, **aucun** appel TTS | AC-12, 13 |
| 4 dépôts simultanés | 4 entrées, 0 son | AC-14 |
| Lecture inbox avec profil X | pipeline complet via FakeTts | AC-15 |
| Mock TTS éteint | message d'erreur + actions Retry/Settings, pas de crash | AC-16 |
| Clé cloud saisie | présente dans `SecretStorage`, absente de `globalState` et des logs | AC-17 |
| Script hook `capture.sh`/`.py`/`.ps1` | spawn réel avec stdin JSON → fichier 0600 dans inbox temporaire | AC-12 |

Tests de contrat providers : une même suite (`describeTtsProviderContract`)
exécutée contre `FakeTts`, le mock OpenAI-compatible, et — hors CI, sous flag —
Chatterbox réel.

### 5.5 Niveau E2E réel — propriétaire Guardian, support Probe

Hors CI, script `npm run e2e:local` sur la machine RDNA4 : Ollama + Chatterbox
réels, profil « Lecture fidèle » puis « Professeur technique » sur un Markdown de
référence, mesure du temps jusqu'au premier audio et de la stabilité sur 20 min.
Résultat consigné dans `_grimoire-output/team-build/test-reports/e2e-<date>.md`.
AC-07, AC-08, AC-11 se valident ici.

### 5.6 Transverse sécurité / confidentialité — propriétaire Vault

- Unit : garde `localOnly`, sanitisation du Markdown injecté dans la webview
  (CSP + nonce), path traversal sur noms de fichiers inbox/cache.
- Intégration : aucun appel réseau sortant hors localhost en mode local
  (interception `http`/`fetch`), aucun contenu de document dans l'Output Channel.
- Détail dans `security-privacy-review-v1.md`.

### 5.7 Matrice de traçabilité

Atlas (Haiku) maintient `docs/traceability.md` : AC-01..AC-17 + AC-SEC-xx →
identifiants de tests. La CI échoue si un AC n'a aucun test associé
(script `scripts/check-traceability.mjs`).

## 6. Phases, livrables et gates

| Phase | Contenu | Agents (modèle) | Gate de sortie |
|---|---|---|---|
| 0 — Cadrage (fait) | Review CdC, brainstorm, sécurité, plan repo, plan maître | Archie, Stack, Vault (Sonnet) ; Flow (Haiku) ; Marcel (Fable) | Utilisateur valide les questions ouvertes P0 |
| 1 — Repo & squelette | `bootstrap-repo.sh`, monorepo, `package.json`, CI verte sur 3 OS avec 1 test, Dependabot, CodeQL, gouvernance | Flow (Haiku), Stack (Sonnet), Atlas (Haiku) | CI verte, branch protection active |
| 2 — Architecture | ADR-001 lecture audio (D4), 002 synchronisation (D6), 003 hook Claude (D7), 004 stockage/inbox (D3), 005 API providers + `synthesizeStream?` (D2), 006 segmentation, 007 protocole d'inbox ouvert + CLI (D8), 008 participant @voice (D8), 009 grille TTS local/entreprise/API (D9), 010 EgressGuard et preuve locale (D10), 011 layout UI minimal/full (D12) ; interfaces TS ; FakeTts/FakeNarrator | Archie (**Opus**), Vulcan (Sonnet) | Sentinel + Fable gate |
| 3 — Slice vertical | Markdown → segments → FakeTts → player webview → highlight → Play/Pause/Stop/Next | Stack (Sonnet ; Opus sur state machine), Frida (Haiku) | AC-01..06 verts en intégration |
| 4 — Providers réels | `OpenAICompatibleTtsProvider`, `ChatterboxProvider`, `OllamaNarrator`, cache, `docker-compose.dev.yml` | Stack, Forge (Sonnet) | AC-07..11 (E2E local documenté) |
| 5 — Claude & profils | Hook collector ×3 OS, inbox TreeView, profils par défaut, `Select Profile`, status bar | Stack (Sonnet), Vault revue (Sonnet) | AC-12..15 + invariant « 0 autoplay » |
| 6 — Hardening & release 0.1 | Erreurs, health, cancellation, logs, audit sécurité, docs installation, VSIX | Guardian, Vault (**Opus** audit), Hawk, Atlas, Convoy (Haiku) | AC-16, 17 ; `vsce package` ; tag v0.1.0 |

Chaque phase = un `task-envelope` + un `evidence-pack` sous
`_grimoire-output/evidence/<phase>/`, gate `grimoire standard gate check --task-id <phase> --strict`.

### Budget tokens estimé (ordre de grandeur, MVP 0.1)

| Modèle | Part | Usage |
|---|---:|---|
| Fable | ≤ 10 % | 7 gates + arbitrages |
| Opus | ~15 % | 6 ADR, state machine, audit |
| Sonnet | ~55 % | code, tests, revues, fix-loop |
| Haiku | ~20 % | CI, docs, mémoire, release |

## 7. Repo GitHub public et maintenance

Détail opérationnel (script, YAML, arborescence) dans `github-repo-ci-plan-v1.md`.
Décisions retenues ici :

- Création via `gh repo create` **après confirmation explicite de l'utilisateur**
  (action publique, L4). Un `git init` local préalable est sans risque.
- `main` protégée : PR obligatoire, 1 review (peut être un agent Sentinel via
  commentaire, mais l'approbation GitHub reste humaine), checks CI requis.
- Conventional Commits + SemVer ; pré-releases `0.x` ; release par tag → VSIX
  attaché à la GitHub Release ; Marketplace optionnel derrière `VSCE_PAT`.
- Maintenance récurrente : Dependabot hebdo (Haiku/Flow trie), CodeQL hebdo
  (Vault lit les alertes), triage issues (Marcel/Atlas), CHANGELOG à chaque
  release (Convoy), failure-museum après chaque incident (Mnemo).
- Le cahier des charges est versionné dans `docs/spec/` du repo ; toute
  modification passe par PR pour garder la traçabilité AC ↔ tests.

## 7b. Décisions de cadrage (2026-09-08)

Les 8 questions de la review sont tranchées dans `decisions-cadrage-v1.md`
(D1-D9). Copilot, Gemini, Kimi, Qwen, DeepSeek, Grok, Codex sont des **sources
de contenu** lues par notre TTS via une inbox ouverte (hooks/notify des CLI,
CLI `llm-voice-inbox add`, participant `@voice` pour Copilot en 0.2). Aucun
narrateur cloud n'est ajouté. D9 propose une grille TTS local / voix système /
serveur d'entreprise / API cloud sur le même contrat `TtsProvider`. Le MVP 0.1
est inchangé. D10-D12 (garantie locale prouvable, Linux first, UI minimale)
sont validées le même jour ; `EgressGuard`, la commande Verify Local Mode et
le mini-player entrent dans le périmètre 0.1 (phases 3 et 6).

## 8. Prochaines actions concrètes

1. Utilisateur : répondre aux questions P0 de `review-cdc-v1.md` et confirmer le
   nom du repo + la création publique.
2. Marcel → Flow (Haiku) : exécuter `bootstrap-repo.sh` et ouvrir la PR « chore: skeleton + CI ».
3. Marcel → Archie (Opus) : ADR-001 à 006 en un seul dispatch, sortie dans `docs/adr/`.
4. Marcel → Vulcan (Sonnet) : FakeTts + fixtures Claude, en parallèle de 3.
5. Gate Fable de fin de phase 2, puis phase 3.
