# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: bootstrap
- Profile: starter

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | 9 agents `.claude/agents/*.md` sont en `model: inherit` et tourneraient sur Fable sans override | fait | `grep -H "^model:" .claude/agents/*.md` (sortie lue le 2026-09-08) | prouvé | élevée | utiliser |
| CL-002 | Les fichiers `.claude/agents/*.md` sont régénérés par `grimoire host sync` (ne pas éditer) | fait | en-tête `grimoire:managed` dans chaque fichier + `.claude/README.md` | prouvé | élevée | utiliser |
| CL-003 | Le CdC contient 3 incohérences majeures (extensionKind, WAV vs streaming, inbox vs globalStorageUri) | résultat | `review-cdc-v1.md` §3 (Sonnet), sections CdC §56/§9/§25/§38/§41 relues par l'orchestrateur | prouvé | élevée | utiliser |
| CL-004 | Le script `bootstrap-repo.sh` produit par Haiku n'est pas exécutable tel quel (gh api -f, contexts de status checks, cache npm) | résultat | relecture lignes 30-91 de `github-repo-ci-plan-v1.md` par l'orchestrateur | prouvé | moyenne | vérifier (Sentinel en phase 1 avant exécution) |
| CL-005 | Webview `<audio>` + postMessage est la meilleure option de lecture audio pour le MVP | hypothèse | `brainstorm-llm-voice-v1.md` §2 ; CdC §9 et §85 | hypothèse | moyenne | vérifier (ADR-001, phase 2, Opus) |
| CL-006 | `gh` est authentifié sur le compte Guilhem-Bonnet ; Node 22 et npm 10 disponibles | fait | `gh auth status`, `node --version`, `npm --version` | prouvé | élevée | utiliser |
| CL-007 | Les URLs et versions citées dans le CdC (Chatterbox V3, ROCm 7.2, Kokoro 82M) sont exactes | hypothèse | non re-vérifiées dans cette tâche (déclaré dans task-envelope) | hypothèse | moyenne | vérifier (Atlas, phase 1, docs) |
| CL-008 | Les 4 rapports de sous-agents existent et respectent les limites de taille | fait | `wc -l _grimoire-output/planning-artifacts/*.md` → 119/238/137/191 lignes | prouvé | élevée | utiliser |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`,
`hypothèse`, `contredit`. Confiance : `faible`, `moyenne`, `élevée`. Décision :
`utiliser`, `vérifier`, `rejeter`.

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | aucune pour la phase 0 ; CL-005 bloque la phase 3 tant que l'ADR-001 n'est pas écrit |
| Contradictions détectées | 3 dans le CdC (CL-003), à trancher par l'utilisateur (questions P0 de la review) |
| Hypothèses acceptées temporairement | CL-005, CL-007 |
| Preuves à obtenir avant livraison | CL-004 : script corrigé + exécuté en dry-run ; CL-007 : liens vérifiés dans la doc |
