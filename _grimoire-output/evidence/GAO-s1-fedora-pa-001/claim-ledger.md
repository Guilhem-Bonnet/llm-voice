# Agentic Claim Ledger

- Task id: GAO-s1-fedora-pa-001
- Profile: controlled

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Le VSIX linux-x64 contient le binaire du Core de sa cible | résultat | `unzip -l`, check-vsix | prouvé | élevée | utiliser |
| CL-002 | Le Core embarqué démarre et répond sur /health | résultat | smoke-core-vsix.sh exit 0 | prouvé | élevée | utiliser |
| CL-003 | Le workflow CI est vert sur linux-x64 | hypothèse | job ajouté, jamais exécuté | hypothèse | moyenne | vérifier après push |
