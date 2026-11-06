# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-feat-v-rific-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | `checkTtsHealth` réutilise le même chemin (`ttsFor()` + `.health()`) que tout le reste de l'extension, pas une nouvelle mécanique réseau | fait | lecture directe de `vscode-extension/src/pipeline/Pipeline.ts` : `ttsParametersFor` et `checkTtsHealth` utilisent tous deux `this.ttsFor(profile)` | prouvé | élevée | utiliser |
| CL-002 | La vérification se déclenche au bon moment — après l'auto-remplissage de l'URL quand on change de provider, pas avant | résultat | test `"checks automatically when the provider changes — after the base URL auto-fill, so it probes the corrected address"` : vérifie que le message `checkHealth` posté contient déjà l'URL corrigée (8000), pas l'ancienne (8004) | prouvé | élevée | utiliser |
| CL-003 | Les 6 nouveaux tests couvrent déclenchement (bouton, changement de provider, perte de focus), affichage (ok/erreur), et remise à zéro au changement de profil | résultat | `test/unit/views/profileEditor.behavior.test.ts`, describe "live connection check" ; `npm --prefix vscode-extension run test:unit` → 110/110 fichiers, 1903/1903 tests | prouvé | élevée | utiliser |
| CL-004 | Aucune régression | résultat | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint ... --max-warnings=0` → No issues ; `npm run test:unit` → 110/110, 1903/1903 | prouvé | élevée | utiliser |
| CL-005 | Le correctif est réellement packagé et installé dans le profil VS Code effectivement utilisé | résultat | `npm run package:linux-x64` (exit 0) puis `code --install-extension llm-voice-linux-x64.vsix --force` ; `~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/dist/extension.js` contient 6 occurrences de "checkHealth"/"connection-status"/"normalizeLoopbackUrl" (grep sur le fichier réellement installé, horodaté 2026-11-05 16:47) | prouvé | élevée | utiliser |

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
| Affirmations bloquantes non prouvées | Aucune : les 5 affirmations ci-dessus sont prouvées, par lecture directe du code (CL-001) et par exécution réelle (CL-002 à CL-005). |
| Contradictions détectées | Aucune. |
| Hypothèses acceptées temporairement | Aucune. |
| Preuves à obtenir avant livraison | Confirmation visuelle par l'utilisateur (le bouton et le statut apparaissent bien, le résultat correspond à la réalité). `ProfileEditorPanel.ts` n'a pas de test unitaire dédié pour `handleCheckHealth` (limite préexistante du fichier, même motif que `handleTest`). |
