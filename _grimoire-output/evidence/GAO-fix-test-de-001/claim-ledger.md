# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-fix-test-de-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Le WAV réel de pocket-tts fait échouer le décodeur natif | résultat | `_grimoire-output/evidence/GAO-fix-test-de-001/evidence-pack.md` (reproduction `Failed to read enough bytes`) ; `crates/llm-voice-audio/src/player.rs` | prouvé | élevée | utiliser |
| CL-002 | Le correctif rend Estelle audible dans l'extension entière | résultat | `_grimoire-output/evidence/GAO-fix-test-de-001/native-real-kyutai.log` (WER 0,0, test vert ; 3 exécutions sur 3) | prouvé | élevée | utiliser |
| CL-003 | Le scénario détecte la panne quand le correctif est retiré | résultat | `_grimoire-output/evidence/GAO-fix-test-de-001/evidence-pack.md` (contrôle négatif, WER 2,25, capture muette) | prouvé | élevée | utiliser |
| CL-004 | La pause produit un vrai silence puis la lecture reprend jusqu'au bout | résultat | `_grimoire-output/evidence/GAO-fix-test-de-001/native-real-kyutai.log` (`silence_between_sounds_ms`) ; `vscode-extension/test/integration-native-real/kyutai-pause.test.ts` | prouvé | élevée | utiliser |
| CL-005 | Le bouton envoie `pause` en moteur natif | résultat | `vscode-extension/test/unit/views/player.behavior.test.ts` ; `vscode-extension/media/player/player.js` | prouvé (vrai script, DOM factice, sans clic réel) | moyenne | utiliser |
| CL-006 | Le clic réel dans VS Code fonctionne pour l'utilisateur | hypothèse | aucun clic exercé depuis cette session | hypothèse | moyenne | vérifier |

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
| Affirmations bloquantes non prouvées | CL-006 : clic réel dans la fenêtre de l'utilisateur. |
| Contradictions détectées | Corrige GAO-fix-l-url-du-001 sur l'origine du port 8004 et GAO-fix-voix-fra-001 sur l'anomalie de durée. |
| Hypothèses acceptées temporairement | CL-006. |
| Preuves à obtenir avant livraison | Essai par l'utilisateur après rechargement de la fenêtre. |
