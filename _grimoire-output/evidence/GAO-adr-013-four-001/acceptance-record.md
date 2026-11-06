# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-adr-013-four-001
- Profile: controlled
- Deliverable: ADR-013 — fournisseur de décision : contrat DecisionProvider (choice/score/noul), SemIf sur API native Ollama, repli profiles.bySource, Jev cloud optionnel
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate : ADR rédigé dans docs/adr/ADR-013-*.md au format des ADR existants, relu par un vérificateur indépendant (Sonnet, contexte neuf) dont le verdict est dans evidence-pack | `docs/adr/ADR-013-decision-provider.md` (7 sections, indexé dans `docs/adr/README.md`) ; `review-sentinel.md` : ACCEPTER AVEC CORRECTIONS MINEURES, corrections 1-2 appliquées | passé |
| AC-002 | gate : grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-adr-013-four-001 --strict` → OK (voir ci-dessous) | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests |  | `npm --prefix vscode-extension run test:unit` via grimoire standard gate run-tests --task-id GAO-adr-013-four-001 (_grimoire-output/evidence/GAO-adr-013-four-001/test-run.json) |
| Build / lint | non applicable | document ADR, aucun code |
| Sécurité | passé | relecture point 3 : EgressGuard obligatoire, Jev cloud jamais par défaut |
| Design / accessibilité | non applicable | — |
| Evals IA | non applicable | — |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Statut « Proposé » : l'implémentation attend ADR-012 et le verdict du spike | aucun code avant ces deux conditions | acceptée, conforme à la décision du journal |
| Suggestion 3 du relecteur (diagramme) non appliquée | lisibilité seulement | différée à GAO-mode-auto-im-001 |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| accepté | concierge (Marcel), par délégation de guilhem-bonnet (demande du 2026-09-27) — ratification utilisateur attendue | 2026-09-27 | AC-001/AC-002 passés ; relecture indépendante sans point bloquant |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
