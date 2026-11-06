# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-fix-boucle-i-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Avant correctif, `installPiperVoice` n'avait aucune vérification d'installation existante — chaque appel repartait de zéro | fait | lecture directe de `vscode-extension/src/tts/PiperSetup.ts` avant édition | prouvé | élevée | utiliser |
| CL-002 | La nouvelle vérification `isPiperAlreadyInstalled` reproduit exactement la même logique que `SystemTtsProvider.detectManagedPiper` (même fichiers, même répertoire) | fait | lecture comparée des deux fichiers (`src/tts/PiperSetup.ts` et `src/tts/SystemTtsProvider.ts` lignes ~838-851) | prouvé | élevée | utiliser |
| CL-003 | Le court-circuit fonctionne (ni prompt ni téléchargement) et ne se déclenche pas sur une installation partielle | résultat | tests `test/unit/tts/PiperSetup.test.ts` ("reports already-installed without prompting or downloading", "win32 .exe", "still prompts and installs when only one of the two expected files is present") ; `npm --prefix vscode-extension run test:unit` → 109/109 fichiers, 1887/1887 tests | prouvé | élevée | utiliser |
| CL-004 | Aucune régression ; le test préexistant sur la sécurité de l'échange atomique a été adapté, pas supprimé | résultat | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint ... --max-warnings=0` → No issues ; diff du test "leaves a previous install's files untouched..." dans `test/unit/tts/PiperSetup.test.ts` | prouvé | élevée | utiliser |
| CL-005 | Le correctif est réellement packagé et installé | résultat | `npm run package:linux-x64` (exit 0) puis `code --install-extension llm-voice-linux-x64.vsix --force` ; `~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/dist/extension.js` contient 4 occurrences de "already-installed"/"déjà installée et prête" (grep sur le fichier réellement installé, horodaté 2026-11-05 16:03, postérieur au build) | prouvé | élevée | utiliser |
| CL-006 | Une fois Piper détecté, `SystemTtsProvider.listVoices()` ne renvoie qu'une seule voix — il n'y a structurellement rien à "choisir" dans ce palier, donc le second volet de la plainte utilisateur ("aucun moyen de réellement choisir une voix") n'est pas résolu par cette carte | fait | lecture directe de `vscode-extension/src/tts/SystemTtsProvider.ts` (`case "piper": return [{ id: PIPER_VOICE_ID, ... }]`), confirmé indépendamment par la relecture Sentinel | prouvé | élevée | utiliser |
| CL-007 | Relecture Sentinel (agent-optimizer) : accepté avec réserves (une bloquante pour la communication, pas pour le code : CL-006 ; une corrigée : invalidation du cache sur already-installed ; deux mineures non corrigées : double source de voiceId, pas de réparation d'install corrompue) | décision | rapport Sentinel du 2026-11-05 ; correctif appliqué dans `Pipeline.ts` (`this.autoTtsCache = undefined;` ajouté au branchement already-installed) ; re-vérifié vert : 109/109 fichiers, 1887/1887 tests | prouvé | élevée | utiliser |

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
| Affirmations bloquantes non prouvées | Aucune : les 5 affirmations ci-dessus sont prouvées, par lecture directe du code (CL-001, CL-002) et par exécution réelle (CL-003, CL-004, CL-005). |
| Contradictions détectées | Aucune. |
| Hypothèses acceptées temporairement | Aucune. |
| Preuves à obtenir avant livraison | Confirmation visuelle par l'utilisateur (reclique sur "Choisir une voix" après installation, vérifie l'absence de nouveau téléchargement) — seule preuve finale possible en l'absence d'outil de clic automatisé Wayland. |
