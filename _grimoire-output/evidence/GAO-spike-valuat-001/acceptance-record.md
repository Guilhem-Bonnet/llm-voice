# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-spike-valuat-001
- Profile: controlled
- Deliverable: Spike évaluation décision FR : jeu de 50 réponses inbox à étiqueter par l'utilisateur, témoin à règles, SemIf sur Ollama, classifieur embeddings
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | test : les scripts du spike s'exécutent de bout en bout sur le jeu (mode non étiqueté accepté) et produisent un tableau exactitude/latence, sortie dans evidence-pack | `run-all.mjs` sur `decision-spike-smoke.jsonl` → tableau complet, exit 0 (evidence-pack.md, recontrôle orchestrateur) | passé |
| AC-002 | test : jeu de 50 réponses exporté hors git (~/.llm-voice/eval/) avec colonne label vide, comptage vérifié | `export-dataset.mjs` → 0 ligne (inbox vide, hook absent) ; `--synthetic` → 9 lignes hors git ; comptage vérifié | échoué sur le fond (0/50 réponses réelles), écart déclaré : prérequis utilisateur |
| AC-003 | gate : grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-spike-valuat-001 --strict` → OK | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests |  | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-spike-valuat-001 (_grimoire-output/evidence/GAO-spike-valuat-001/test-run.json) |
| Build / lint | passé | `npm run lint` (eslint . --max-warnings=0) et `npm run typecheck` verts, dossier scripts/ inclus |
| Sécurité | passé | jeu de données hors git (`~/.llm-voice/eval/`), aucun texte de message dans le dépôt ni les preuves (AC-SEC-07) ; cibles loopback uniquement |
| Design / accessibilité | non applicable | — |
| Evals IA | partiel | chaîne d'évaluation prouvée sur 9 réponses synthétiques ; mesure réelle en attente du jeu étiqueté |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Aucune réponse Claude réelle capturée (hook non installé) | la mesure de qualité, objet du spike, n'a pas eu lieu | carte close sur l'outillage ; la mesure reste condition d'entrée de GAO-mode-auto-im-001 |
| SemIf répond « B » 8 fois sur 9 sur le jeu synthétique | possible biais de prompt ou de modèle | à examiner sur le jeu réel avant toute conclusion |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| ajustement demandé | concierge (Marcel), par délégation de guilhem-bonnet — ratification utilisateur attendue | 2026-09-27 | outillage accepté ; l'utilisateur doit installer le hook Claude, laisser tourner quelques sessions, étiqueter 50 réponses, puis relancer `run-all.mjs` |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
