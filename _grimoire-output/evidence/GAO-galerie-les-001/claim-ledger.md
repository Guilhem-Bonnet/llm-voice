# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-galerie-les-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | La galerie reçoit un 401 de VS Code sur la phrase d'essai, car la racine `trialDir` est en `vscode-userdata` et le fichier en `file` | fait | 401 reproduit, schéma journalisé, 206 après la seule correction de la racine | prouvé | haute | corrigé |
| CL-002 | Le moteur webview a le même refus sur le cache audio | fait | `player-webview-audio.test.ts` 401 puis 206 | prouvé | haute | corrigé |
| CL-003 | La barre d'attente manquait sur Ctrl+Alt+V R quand le panneau n'avait jamais été ouvert | fait | `shown:false` avant, `seenAfterMs` 1324 après | prouvé | haute | corrigé |
| CL-004 | `estelle` est une voix normale du 1.6B | fait | `src/tts/kyutai16VoiceCatalog.ts:41`, `deploy/kyutai16/voices.json:2` | prouvé | haute | rien à faire |

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
| Affirmations bloquantes non prouvées |  |
| Contradictions détectées |  |
| Hypothèses acceptées temporairement |  |
| Preuves à obtenir avant livraison |  |
