# Agentic Acceptance Record

- Task id: bootstrap
- Profile: starter
- Deliverable: Phase 0 — review du CdC, brainstorm, revue sécurité, plan repo/CI, plan maître de délégation (agents → LLM → vérificateurs, pyramide de tests, phases)
- Validator: guilhem-bonnet (utilisateur) ; pré-validation concierge (Fable)

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | Review structurée du CdC avec incohérences citées par section et questions ouvertes P0/P1 | `_grimoire-output/planning-artifacts/review-cdc-v1.md` §3, §8 | passé |
| AC-002 | Brainstorm produit/technique avec slice vertical et décisions à trancher | `_grimoire-output/planning-artifacts/brainstorm-llm-voice-v1.md` §1, §10 | passé |
| AC-003 | Plan de délégation : chaque agent a un modèle LLM, un périmètre et un vérificateur | `master-plan-llm-voice-v1.md` §3 (tableau 17 agents) | passé |
| AC-004 | Chaîne de vérification/validation définie, vérificateur ≠ auteur | `master-plan-llm-voice-v1.md` §4 ; decisions-log 2026-09-08 | passé |
| AC-005 | Pyramide de tests couvrant AC-01..AC-17 du CdC + AC-SEC-01..10 | `master-plan-llm-voice-v1.md` §5 ; `security-privacy-review-v1.md` §3 | passé |
| AC-006 | Plan de création du repo GitHub public et de sa maintenance | `github-repo-ci-plan-v1.md` §1-7 ; `master-plan-llm-voice-v1.md` §7 | partiel (script à corriger, D-1) |
| AC-007 | Économie de tokens Fable : travail de fond délégué à Sonnet/Haiku | notifications de tâche : Sonnet ×3, Haiku ×1 ; Fable = orchestration + plan maître | passé |
| AC-008 | Repo GitHub public créé | non exécuté : confirmation utilisateur requise (L4) | à vérifier |

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests | non applicable (aucun code) | — |
| Build / lint | non applicable (aucun code) | — |
| Sécurité | revue STRIDE, 12 findings, 10 AC-SEC | `security-privacy-review-v1.md` |
| Design / accessibilité | non applicable en phase 0 | — |
| Evals IA | non applicable | — |
| Gates Grimoire | `grimoire standard gate check --task-id bootstrap --strict` → OK | sortie du 2026-09-08 |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Script bootstrap Haiku non exécutable tel quel (D-1) | retard phase 1 si exécuté sans revue | revue Sentinel (Sonnet) obligatoire avant exécution |
| 3 incohérences du CdC non tranchées | ADR-001/002/003 bloqués | questions P0 posées à l'utilisateur |
| Références externes du CdC non re-vérifiées | doc d'installation potentiellement obsolète | vérification par Atlas en phase 1 |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| en attente | guilhem-bonnet | 2026-09-08 | Pré-validation concierge : livrables complets ; attend réponses P0 + confirmation création repo |
