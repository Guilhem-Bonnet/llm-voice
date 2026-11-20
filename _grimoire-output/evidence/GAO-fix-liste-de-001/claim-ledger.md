# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-fix-liste-de-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Avant correctif, le panneau Profils affichait une paire technique illisible au lieu de la description humaine déjà présente dans les données | fait | lecture directe de `vscode-extension/src/views/profiles/profileTreeItems.ts` avant édition, et `vscode-extension/src/profiles/defaults.ts` (chaque profil a déjà un champ `description` en français) | prouvé | élevée | utiliser |
| CL-002 | `description` est un champ persistant du schéma de profil, donc les profils déjà installés chez l'utilisateur la portent déjà sans migration | fait | lecture directe de `vscode-extension/src/core/profile.schema.ts` ligne 132 (`description: z.string().optional()`) | prouvé | élevée | utiliser |
| CL-003 | La nouvelle ligne visible affiche la description humaine, pas la paire technique, pour un profil qui en a une ; un profil sans description retombe sur l'ancien format | résultat | tests `vscode-extension/test/unit/views/profiles/profileTreeItems.test.ts` ("shows the plain-language description..." et "falls back to the technical provider pair...") — `npm --prefix vscode-extension run test:unit` → 108/108 fichiers, 1872/1872 tests | prouvé | élevée | utiliser |
| CL-004 | Le correctif est réellement packagé et installé, pas seulement présent dans le dépôt source | résultat | `npm run package:linux-x64` (exit 0) puis `code --install-extension llm-voice-linux-x64.vsix --force` ; `~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/dist/extension.js` contient la chaîne "analogies quand elles aident" (grep sur le fichier réellement installé, horodaté 2026-11-05 14:12, postérieur au build) | prouvé | élevée | utiliser |
| CL-005 | Aucune régression : `tsc`/`eslint`/tests unitaires restent verts après la modification | résultat | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint src/views/profiles/profileTreeItems.ts test/unit/views/profiles/profileTreeItems.test.ts --max-warnings=0` → No issues ; `npm run test:unit` → 108/108, 1874/1874 (après corrections Sentinel) | prouvé | élevée | utiliser |
| CL-006 | Relecture indépendante Sentinel (agent-optimizer) : accepté avec réserves non bloquantes (R1 description vide, R2 identifiant de carte erroné dans un commentaire, trou de couverture actif+description) ; les trois corrigées | décision | rapport Sentinel du 2026-11-05 ; correctifs appliqués dans `profileTreeItems.ts` (repli sur `technical` si `description` vide après `trim()`) et `profileTreeItems.test.ts` (identifiant corrigé, 2 tests ajoutés) ; re-vérifié vert : `npm --prefix vscode-extension run test:unit` → 108/108, 1874/1874 | prouvé | élevée | utiliser |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`,
`hypothèse` (ou `non vérifié`, son synonyme), `contredit`, `réfuté`. Confiance :
`faible`, `moyenne`, `élevée`. Décision : `utiliser`, `vérifier`, `rejeter`,
`écarter`. Une précision entre parenthèses ou après `;` est tolérée
(`prouvé (par lecture)`) ; une barre dans une cellule s'écrit `\|`.

## Preuve minimale par type d'affirmation

| Type | Preuve minimale |
|---|---|
| Fichier ou code | chemin lu, diff ou extrait |
| Test | commande et résultat |
| API ou norme | contrat, documentation officielle ou code |
| Design | charte, design system, maquette ou validation |
| Sécurité | scan, règle, revue ou threat model |
| Mémoire | source originale, date, score, portée |
| Décision client | validation explicite ou ticket |

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | Aucune : les 5 affirmations ci-dessus sont prouvées, par lecture directe du code (CL-001, CL-002) et par exécution réelle (CL-003, CL-004, CL-005), y compris sur le build effectivement installé. |
| Contradictions détectées | Aucune. |
| Hypothèses acceptées temporairement | Aucune. |
| Preuves à obtenir avant livraison | Aucune restante pour cette carte ; `profileQuickPick.ts` (surface séparée, garde le format technique) et l'ajout éventuel d'un profil Kyutai par défaut restent hors périmètre, déjà notés comme suites possibles. |
