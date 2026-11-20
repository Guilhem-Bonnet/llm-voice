# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-kyutai-pocke-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | `KyutaiPocketProvider` respecte le contrat `TtsProvider` et n'appelle jamais `fetch` directement | résultat | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint ... --max-warnings=0` → No issues (règle anti-fetch-direct incluse) | prouvé | élevée | utiliser |
| CL-002 | `health()` ne renvoie jamais un faux `ok` | résultat | 4 tests dédiés (healthy/starting/500/port fermé) dans `KyutaiPocketProvider.test.ts` | prouvé | élevée | utiliser |
| CL-003 | Aucune requête hors `127.0.0.1`/`trustedHosts` | résultat | 2 tests contre un vrai `EgressGuardHandle` en mode `local` ciblant `http://example.com`, rejet confirmé | prouvé | élevée | utiliser |
| CL-004 | Suite complète du projet verte, zéro régression | test | `npm --prefix vscode-extension run test:unit` → 108 fichiers / 1865 tests passés, `_grimoire-output/evidence/GAO-kyutai-pocke-001/test-run.json` | prouvé | élevée | utiliser |
| CL-005 | `voice_url="alba"` est une entrée reconnue côté serveur `pocket-tts`, pas un nom arbitraire | fait | recherche `web-fetch` antérieure (code source `pocket_tts/main.py`, `_ORIGINS_OF_PREDEFINED_VOICES`), citée dans l'evidence-pack §« Clarification de l'orchestrateur » | prouvé (par lecture de code, non par exécution contre un serveur réel) | moyenne | utiliser ; vérifier le nom côté serveur avant d'ajouter une nouvelle entrée au catalogue |
| CL-006 | `KyutaiPocketProvider` n'est câblé dans aucun preset/registre/profil par défaut | fait | lecture de `KyutaiPocketProvider.ts`, `presets.ts`, `ProviderRegistry.ts` (non modifiés) | prouvé | élevée | utiliser (décision volontaire, hors périmètre de cette carte) |

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
