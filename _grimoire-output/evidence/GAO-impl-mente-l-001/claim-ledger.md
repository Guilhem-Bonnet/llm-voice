# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-impl-mente-l-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | `friendlyTtsProviderLabel` est mise à jour aux 8 sites où `Pipeline.currentProfileLabel` l'est, et branchée dans `statusBarModel()`/`pushPlayerState()` | fait | lecture directe de `vscode-extension/src/pipeline/Pipeline.ts` (8 occurrences de `currentVoiceLabel = friendlyTtsProviderLabel(...)`, vérifié par `grep -c`) | prouvé | élevée | utiliser |
| CL-002 | Le `#voice` du panneau lecture est visible en permanence, pas seulement pendant une lecture (le `#title-line` n'est pas masqué par `data-state="idle"`) | fait | lecture directe de `vscode-extension/media/player/player.css` (règles `body[data-state="idle"]` ne ciblent que `#transport`/`#progress-track`, jamais `#title-line`) | prouvé | élevée | utiliser |
| CL-003 | Aucune régression ; nouveaux tests couvrent le label et le tooltip | résultat | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint ... --max-warnings=0` → No issues ; `npm run test:unit` → 109/109 fichiers (108→109), 1880/1880 tests (1874→1880) | prouvé | élevée | utiliser |
| CL-004 | Le correctif est réellement packagé et installé | résultat | `npm run package:linux-x64` (exit 0) puis `code --install-extension llm-voice-linux-x64.vsix --force` ; `~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/dist/extension.js` contient `id="voice"` et "Chatterbox (qualit[é]..." (grep sur le fichier réellement installé, horodaté 2026-11-05 14:42, postérieur au build) | prouvé | élevée | utiliser |
| CL-005 | L'ambiguïté Piper/système n'est pas résolue par cette carte — limitation assumée, pas un oubli | fait | commentaire de code `vscode-extension/src/profiles/ttsProviderLabel.ts` et section "Hors périmètre" de `task-envelope.md` | prouvé (par déclaration explicite) | élevée | utiliser |
| CL-006 | Relecture Sentinel (agent-optimizer) : accepté avec réserves non bloquantes (champ `voice` non couvert par la couche dynamique anti-XSS ; test `friendlyTtsProviderLabel` trop faible avec `toContain`) ; les deux corrigées | décision | rapport Sentinel du 2026-11-05 ; correctifs dans `test/unit/security/webview-injection.test.ts` (`voice` ajouté au DOM factice, à `it.each(XSS_PAYLOADS)` et au test de tolérance) et `test/unit/profiles/ttsProviderLabel.test.ts` (`toBe` exact + nouveau test "never returns the raw providerId unchanged") ; re-vérifié vert : 109/109 fichiers, 1881/1881 tests | prouvé | élevée | utiliser |

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
| Affirmations bloquantes non prouvées | Aucune : les 5 affirmations ci-dessus sont prouvées, par lecture directe du code (CL-001, CL-002, CL-005) et par exécution réelle (CL-003, CL-004), y compris sur le build effectivement installé. |
| Contradictions détectées | Aucune. |
| Hypothèses acceptées temporairement | Aucune. |
| Preuves à obtenir avant livraison | Aucune restante pour cette carte ; l'ambiguïté Piper/système reste non résolue, assumée et déclarée (CL-005), carte séparée si retenue. |
