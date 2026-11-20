# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-fix-l-url-du-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Avant correctif, aucun écouteur `change` n'existait sur `field-tts-provider` — le champ Base URL ne suivait jamais le provider sélectionné | fait | lecture directe de `vscode-extension/media/profileEditor/profileEditor.js` avant édition (grep `ttsProvider` ne montrait que des lectures `.value`, aucun `addEventListener`) | prouvé | élevée | utiliser |
| CL-002 | Le port 8004 vu par l'utilisateur est bien le défaut Chatterbox, pas celui de Kyutai (8000) | fait | `vscode-extension/src/tts/presets.ts` : `CHATTERBOX_LOCAL_PRESET.baseUrl = "http://localhost:8004"`, `KYUTAI_POCKET_LOCAL_PRESET.baseUrl = "http://localhost:8000"` | prouvé | élevée | utiliser |
| CL-003 | Le correctif reproduit et corrige exactement le cas rapporté, **y compris l'adresse exacte citée par l'utilisateur** (`http://127.0.0.1:8004`, pas seulement `localhost:8004`), sans jamais écraser une URL tapée à la main | résultat | `test/unit/views/profileEditor.behavior.test.ts` : **7 tests** dans le describe "TTS provider change auto-fills the base URL", dont "recognizes the 127.0.0.1 spelling too" (adresse exacte du message d'erreur réel), "also recognizes a trailing slash or different case", "never overwrites a custom loopback URL on a non-default port" — exécute le vrai `profileEditor.js` contre un DOM factice ; `npm --prefix vscode-extension run test:unit` → 110/110 fichiers, 1905/1905 tests — **corrigé après relecture Sentinel** : la version initiale ne couvrait que `localhost`, pas `127.0.0.1`, et ce claim était alors surévalué en confiance | prouvé | élevée | utiliser |
| CL-004 | Aucune régression | résultat | `npx eslint test/unit/views/profileEditor.behavior.test.ts --max-warnings=0` → No issues ; `npm run test:unit` → 110/110, 1903/1903 | prouvé | élevée | utiliser |
| CL-005 | Le correctif est réellement packagé et installé dans le profil VS Code effectivement utilisé par ce workspace | résultat | `npm run package:linux-x64` (exit 0) puis `code --install-extension llm-voice-linux-x64.vsix --force` ; `~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/package.json` horodaté 2026-11-05 16:39 ; `storage.json` → `profileAssociations.workspaces["file:///mnt/Travail/Projets/Dev/TTS-Voice"] == "__default__profile__"`, confirmant que c'est bien le profil mis à jour | prouvé | élevée | utiliser |
| CL-006 | Relecture Sentinel (agent-optimizer) : accepté avec une réserve bloquante (comparaison `localhost`-only, ne couvrait pas l'adresse `127.0.0.1` réellement citée) ; corrigée par normalisation de la comparaison | décision | rapport Sentinel du 2026-11-05 ; correctif de normalisation dans `profileEditor.js` (`normalizeLoopbackUrl`) ; 2 nouveaux tests dont un reproduisant l'adresse exacte du message d'erreur réel ; re-vérifié vert : 110/110 fichiers, 1903/1903 tests | prouvé | élevée | utiliser |

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
| Affirmations bloquantes non prouvées | Aucune : les 6 affirmations ci-dessus sont prouvées (correction du chiffre, relecture Sentinel), par lecture directe du code (CL-001, CL-002) et par exécution réelle contre le vrai script webview (CL-003, CL-004, CL-005). |
| Contradictions détectées | Aucune. |
| Hypothèses acceptées temporairement | Aucune. |
| Preuves à obtenir avant livraison | Confirmation visuelle par l'utilisateur (la synthèse Kyutai fonctionne désormais après un simple changement de provider, sans correction manuelle de l'URL). |
