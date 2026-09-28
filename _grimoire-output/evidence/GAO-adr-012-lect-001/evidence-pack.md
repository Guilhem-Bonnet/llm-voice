# Agentic Evidence Pack

## Summary

- Task id: GAO-adr-012-lect-001
- Profile: controlled
- Outcome: ADR-012 « Lecture audio native hors webview : Core Rust minimal (`llm-voice-core`) » rédigé, statut **Accepté (2026-09-27)** sur décision de guilhem-bonnet ; index `docs/adr/README.md`, `decisions-log.md` et `shared-context.md` mis à jour.
- Final state: vérifié (ACCEPTER AVEC CORRECTIONS MINEURES, 2026-09-28). Aucun fichier `.ts` modifié, aucun commit.

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Carte claim → running | `grimoire task claim` / `task move --to running` | platform-architect | `ready → claimed → running` (OK) |
| Enveloppe (écrite avant toute modification) | `_grimoire-output/evidence/GAO-adr-012-lect-001/task-envelope.md` | platform-architect (Opus) | écrite |
| Context bundle | `_grimoire-output/context/GAO-adr-012-lect-001/context-bundle.yaml` | `grimoire task context` | OK |
| Decision trace | `_grimoire-output/decisions/GAO-adr-012-lect-001/decision-trace.yaml` | `grimoire standard decision trace` | OK |
| ADR-012 | `docs/adr/ADR-012-native-audio-core.md` | platform-architect (Opus) | statut, contexte (mesure `NotAllowedError`, absence de voie sans natif, jonction `AudioSink`), décision en 9 sous-sections (architecture + Mermaid, ce qui reste TS, `AudioSink` v2, protocole, cycle de vie, sécurité loopback, packaging 5 cibles, remote/SSH/WSL, langage), conséquences sur ADR-001/009/011, alternatives avec scores, tests |
| Index des ADR | `docs/adr/README.md` | platform-architect | ligne ADR-012 ; ADR-001 « remplacé », ADR-011 « révisé » ; phrase de statut corrigée |
| Mémoire | `_grimoire/_memory/decisions-log.md` (entrée 2026-09-28), `shared-context.md` (1 ligne, section Organisation) | platform-architect | écrits |

### Fichiers lus

- `_grimoire/kit/agents/platform-architect.md` (persona)
- `_grimoire-output/planning-artifacts/debat-langage-core-synthese-v1.md` (en entier)
- `_grimoire-output/evidence/GAO-diagnostic-s-001/evidence-pack.md` (cause racine)
- `research_notes/Briques existantes pour LLM Voice/lecture-audio-native.md`, `controle-lecture-native-et-gapless.md` (extraits)
- `docs/adr/ADR-001`, `ADR-009`, `ADR-011` (en entier), `ADR-005` et `ADR-013` (structure), `README.md`
- `_grimoire/_memory/shared-context.md`, `decisions-log.md` (entrées 2026-09-11 Zéro Docker, 2026-09-27)
- `vscode-extension/src/playback/AudioSink.ts`, `WebviewAudioSink.ts` (en-tête), `PlaybackController.ts` (usages du sink), `package.json` (`extensionKind: ["ui"]`)

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Choix tranchés dans l'ADR (au-delà de la synthèse)

1. Protocole : `GET /health` + WebSocket `/v1/ws`, port éphémère ; vocabulaire des messages repris d'ADR-001, plus `enqueue`, `underrun`, `hello` (versions ; majeure différente → repli webview).
2. Source audio = chemin absolu du cache ; le Core refuse tout chemin hors du dossier de cache déclaré.
3. Jeton et dossier de cache transmis par environnement ou stdin, jamais par argv.
4. Instance unique : verrou `0600` (PID, port, jeton), seconde fenêtre = client du Core existant ; arrêt sur délai de grâce sans client ou disparition du parent ; relance bornée puis repli webview.
5. Spawn à la première lecture, jamais à l'activation.
6. VSIX universel sans binaire possible avec le seul moteur webview (lecture sur clic).

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Relecture indépendante | agent-optimizer (Sonnet, contexte neuf) | ACCEPTER AVEC CORRECTIONS MINEURES, aucun point bloquant | correction 2 appliquée (mention « rendu Mermaid non vérifié » sous le diagramme) ; correction 1 sans objet : la section « ## Cause racine établie le 2026-09-27 — politique d'autoplay de Chromium » existe bien dans `GAO-diagnostic-s-001/evidence-pack.md` (grep -c = 1) |
| Gate strict | `grimoire standard gate check --task-id GAO-adr-012-lect-001 --strict` | voir acceptance-record | premier passage : claim-ledger manquant (ajouté) |
| Standard | `grimoire standard verify .` | OK, exit 0 (0 erreur, avertissements préexistants : bootstrap, dispatch.cost_slo) |  |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | yes | décision utilisateur journalisée (2026-09-27) ; carte ledger | — |
| Quality | yes | relecture indépendante | — |
| Runtime | no | ADR seul, rien d'exécuté côté produit | tests de l'ADR portés par les cartes suivantes |
| Knowledge | yes | sources citées ; non-vérifiés marqués | — |
| Model/provider | yes | Opus rédaction, Sonnet vérification | — |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Le brief cite « `autoplayPolicy: "user-gesture-required"` confirmé dans le binaire VS Code » dans l'evidence-pack de `GAO-diagnostic-s-001` : **introuvable** dans ce pack (grep). Seule la veille le mentionne (« contexte de la tâche »). L'ADR s'appuie donc sur la mesure `NotAllowedError` (reproduite deux fois) et présente la politique comme « cohérente avec » | aucun sur la décision (la mesure suffit) | platform-architect | si la preuve binaire est versée, citer sa localisation |
| Protocole et cycle de vie précisés au-delà de la synthèse (choix 1 à 6) | noms de champs affinables par la carte « Protocole Core v1 » | platform-architect | carte protocole |
| Seuils du banc (blanc, dérive, reprise), tailles de binaires, signature macOS, SmartScreen : non mesurés | marqués « non vérifié » dans l'ADR | platform-architect | spike et carte packaging |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Vérification indépendante (agent-optimizer, Sonnet, 2026-09-28)

Contexte neuf, aucune écriture hors de cette section. Sources lues en entier ou par extraits ciblés : `docs/adr/ADR-012-native-audio-core.md`, `_grimoire/_memory/decisions-log.md` (entrées 2026-09-11 « Zéro Docker », 2026-09-27 débat + validation, 2026-09-28), `_grimoire-output/planning-artifacts/debat-langage-core-synthese-v1.md` (§B.3, §C, §D, §F), `_grimoire-output/evidence/GAO-diagnostic-s-001/evidence-pack.md` (grep « Cause racine », section non trouvée telle quelle — voir point 3), `_grimoire/_memory/shared-context.md` (Invariants P0, lignes 22-28), `vscode-extension/src/playback/AudioSink.ts` (lignes 1-59), `vscode-extension/package.json` (ligne 24, `extensionKind: ["ui"]`), `docs/adr/README.md`.

### Grille

1. **Fidélité à la décision utilisateur** — OK. `decisions-log.md:184` cite exactement « Ok, je valide l'option E » (2026-09-27) ; l'ADR (lignes 5-13) reprend option E (Core Rust minimal, audio natif puis sherpa-onnx, spawné par l'extension, HTTP+WS loopback, instance unique, orchestration/pipeline/profils/inbox/narrateur/mode Auto en TS), D en repli documenté (ADR lignes 217, 278), A/B/C/mpv seul rejetés (ADR lignes 270-283).
2. **Fidélité à la synthèse §B.3/§C/§D/§F** — OK. Scores vérifiés identiques mot pour mot : E 82,1, D 81,6, F 72,1, A 66,4, C 59,9, B 54,4 (synthèse ligne 167 ↔ ADR ligne 277-283) ; sensibilité sans critère 11 : D 83,5, E 81,4, F 77,5 (synthèse ligne 200-201 ↔ ADR ligne 285) — identique. Aucun fait inventé détecté ; les non-vérifiés de la synthèse (§F, notamment « non sourcée dans la veille » sur le WebSocket, licences mpv, seuils du banc) sont repris tels quels dans l'ADR (lignes 181, 259-260, 298).
3. **Cause racine** — Partiel (formel, pas de fond). Le fichier `GAO-diagnostic-s-001/evidence-pack.md` ne contient pas littéralement un intitulé « Cause racine » (grep sans résultat sur ce terme exact) ; le pack de `GAO-adr-012-lect-001` lui-même le cite comme raccourci (« cause racine » en ligne 26 de ce pack). Sur le fond, la mesure que l'ADR décrit (lignes 26-42 : `NotAllowedError`, 0 flux PipeWire, deux reproductions, `audio.muted=true` aussi rejeté, cohérent avec `autoplayPolicy: "user-gesture-required"`) est cohérente avec ce que documente le Deviations de ce même pack (ligne 73 : la citation exacte du binaire est introuvable, l'ADR le formule prudemment en « cohérent avec », pas en fait établi) — l'ADR est donc fidèle et prudent, mais le nom exact de la section source cité dans le brief de vérification n'existe pas tel quel.
4. **Invariants P0 et Zéro Docker** — OK. Zéro autoplay : ADR ligne 187-189 (aucun chemin inbox/hook vers `CoreClient`, invariant statique étendu) conforme à `shared-context.md:24`. Local-first : ADR ligne 183-186 (aucune connexion sortante du Core) conforme à `shared-context.md:25`. Provider agnostic : ADR ligne 113-115 (`CoreTtsProvider` implémente `TtsProvider` existant) conforme à `shared-context.md:26`. Modèles jamais dans le VSIX : ADR ligne 198 (« Aucun modèle n'est embarqué (P0 n°5) ») conforme à `shared-context.md:28`. Zéro Docker (`decisions-log.md:131-135`) : non contredit, l'ADR ne réintroduit Docker nulle part.
5. **Complétude des sections** — OK. Toutes les sections demandées sont présentes et à l'endroit attendu : architecture + Mermaid (lignes 80-100), ce qui reste TS (117-124), AudioSink v2 (126-139), protocole (141-157), cycle de vie (159-174), sécurité loopback (176-189), packaging 5 cibles (191-199), remote/SSH/WSL via `extensionKind: ["ui"]` (201-207), conséquences ADR-001 remplacé / ADR-011 révisé / ADR-009 inchangé (223-240), alternatives avec scores (270-286), tests (banc audio, deux clients une lecture, zéro NotAllowedError, aucune socket sortante — lignes 288-322).
6. **Cohérence avec le code réel** — OK. `AudioSink.ts` lignes 47-58 confirme exactement `load/play/pause/stop/seek` et les événements `timeupdate/ended/error` cités par l'ADR (ligne 66-67, 147-149). `package.json:24-26` confirme `extensionKind: ["ui"]`, cité correctement (ADR ligne 74, 203). `docs/adr/README.md` (lignes 8, 18-19, 22-26) reflète l'ADR-012 sans divergence : ADR-001 marqué « remplacé », ADR-011 « révisé », ADR-009 non modifié dans l'index.
7. **Format MADR court et Mermaid** — OK. Structure Statut/Contexte/Décision/Conséquences/Alternatives rejetées/Tests respectée intégralement. Le diagramme Mermaid (lignes 82-100) est syntaxiquement cohérent (flowchart LR, sous-graphes fermés, labels entre guillemets) ; non exécuté dans un rendeur, donc validité de rendu **non vérifiée** ici (hors outillage disponible).

### Points bloquants

Aucun.

### Corrections mineures proposées

1. Dans un futur pack de preuve, citer explicitement le fichier et la ligne portant l'intitulé « Cause racine » si un tel intitulé doit exister littéralement dans `GAO-diagnostic-s-001/evidence-pack.md` — actuellement ce terme n'y figure pas sous cette forme exacte (point 3 de la grille), même si le contenu factuel est fidèle.
2. Marquer explicitement dans l'ADR (section Sécurité, ligne 181) que le rendu Mermaid n'a pas été vérifié par un outil de rendu, pour cohérence avec la discipline « non vérifié » déjà appliquée ailleurs dans le document.

### Verdict

**ACCEPTER AVEC CORRECTIONS MINEURES** (les deux points ci-dessus sont cosmétiques et ne remettent en cause ni la décision, ni les invariants, ni la traçabilité).
