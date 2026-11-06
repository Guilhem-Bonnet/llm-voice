# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-fix-le-choix-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Avant correctif, `applyVoiceTierChoice`/`browseVoices` ne poussaient jamais le panneau lecture ni la barre de statut après un simple changement de voix | fait | lecture directe de `vscode-extension/src/pipeline/Pipeline.ts` avant édition ; `pushPlayerState()`/`statusBar.update()` grep confirmant leurs seuls appelants (événements de lecture, `selectProfileById`→`refreshLocalModeBadge`) | prouvé | élevée | utiliser |
| CL-002 | `refreshLocalModeBadge()` est le motif déjà établi ailleurs dans le fichier pour ce type de rafraîchissement, pas une mécanique inventée pour ce correctif | fait | `selectProfileById` (ligne ~848) appelle déjà `await this.refreshLocalModeBadge();` dans le même but | prouvé | élevée | utiliser |
| CL-003 | Aucune régression après l'ajout des deux appels | résultat | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint src/pipeline/Pipeline.ts --max-warnings=0` → No issues ; `npm run test:unit` → 109/109 fichiers, 1881/1881 tests | prouvé | élevée | utiliser |
| CL-004 | Le correctif est réellement packagé et installé | résultat | `npm run package:linux-x64` (exit 0) puis `code --install-extension llm-voice-linux-x64.vsix --force` ; `~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/package.json` horodaté 2026-11-05 14:59, postérieur au build | prouvé | élevée | utiliser |
| CL-005 | Ce correctif ne peut pas être prouvé par un clic réel dans VS Code depuis cette session (aucun outil Wayland) | fait | mémoire projet `_grimoire/_memory/feedback-tests-autonomes-claude.md` ; limite déclarée explicitement dans `task-envelope.md` | prouvé (par déclaration explicite) | élevée | utiliser |

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
| Affirmations bloquantes non prouvées | Aucune : les 5 affirmations ci-dessus sont prouvées, par lecture directe du code (CL-001, CL-002, CL-005) et par exécution réelle (CL-003, CL-004). |
| Contradictions détectées | Aucune. |
| Hypothèses acceptées temporairement | Que `pushPlayerState()` est sûr à appeler hors session de lecture — déduit de la lecture de son corps (lit des getters qui retournent des valeurs par défaut sûres), pas observé en exécution réelle (CL-005, limite assumée). |
| Preuves à obtenir avant livraison | Confirmation visuelle par l'utilisateur, seule preuve finale possible en l'absence d'outil de clic automatisé Wayland sur ce poste. |
