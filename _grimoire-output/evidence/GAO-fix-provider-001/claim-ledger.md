# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-fix-provider-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Le `<select>` de l'éditeur de profil ne listait pas `kyutai-pocket` avant ce correctif | fait | lecture directe de `vscode-extension/src/views/profileEditor/profileEditorHtml.ts` lignes 91-96, avant édition (4 options en dur) | prouvé | élevée | utiliser |
| CL-002 | `Pipeline.pickVoiceForProfile` exige `tts.listVoices !== undefined`, sans quoi « Parcourir les voix » affiche « ce provider ne fournit pas de liste de voix » | fait | lecture directe de `vscode-extension/src/pipeline/Pipeline.ts` lignes 1036-1052 | prouvé | élevée | utiliser |
| CL-003 | `KyutaiPocketProvider.listVoices()` renvoie le catalogue statique sans appel réseau | résultat | test `test/unit/tts/KyutaiPocketProvider.test.ts` ("listVoices() resolves the static catalogue with no network call at all, even through a denying EgressGuard"), `baseUrl` non-loopback refusé par le vrai `EgressGuard` : le test échouerait si un `fetch` était tenté — `npm --prefix vscode-extension run test:unit` → 108/108 fichiers, 1870/1870 tests, voir `_grimoire-output/evidence/GAO-fix-provider-001/test-run.json` | prouvé | élevée | utiliser |
| CL-004 | Le correctif est réellement packagé et installé, pas seulement présent dans le dépôt source | résultat | `npm run package:linux-x64` (exit 0) puis `code --install-extension llm-voice-linux-x64.vsix --force` ; `~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/dist/extension.js` contient `value="kyutai-pocket">Kyutai Pocket TTS (local, avancé)` (grep sur le fichier réellement installé, horodaté 2026-11-05 13:47, postérieur au build) | prouvé | élevée | utiliser |
| CL-005 | Aucune régression : `tsc`/`eslint`/tests unitaires restent verts après les deux modifications | résultat | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint src/tts/KyutaiPocketProvider.ts src/views/profileEditor/profileEditorHtml.ts test/unit/tts/KyutaiPocketProvider.test.ts --max-warnings=0` → No issues ; `npm run test:unit` → 108/108, 1870/1870 | prouvé | élevée | utiliser |

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
| Affirmations bloquantes non prouvées | Aucune : les 5 affirmations ci-dessus sont prouvées, par lecture directe du code (CL-001, CL-002) et par exécution réelle (CL-003, CL-004, CL-005), y compris sur le build effectivement installé, pas seulement le dépôt source. |
| Contradictions détectées | Aucune. |
| Hypothèses acceptées temporairement | Aucune. |
| Preuves à obtenir avant livraison | Aucune restante pour cette carte ; le catalogue de voix complet et l'ajout éventuel de kyutai-pocket à l'onboarding simplifié restent hors périmètre, déjà discutés comme des décisions séparées. |
