# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-feat-l-assis-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Avant correctif, `handleVoiceTier` n'ouvrait jamais de sélecteur de voix, seulement un dialogue de palier | fait | lecture directe de `vscode-extension/src/onboarding/handleVoiceTier.ts` avant édition | prouvé | élevée | utiliser |
| CL-002 | `browseVoices` est maintenant appelé pour les paliers "system" et "piper", jamais pour "chatterbox" | résultat | tests `test/unit/onboarding/handleVoiceTier.test.ts` ("opens the real voice picker right after" ×2, "never opens the voice picker" pour chatterbox) ; `npm --prefix vscode-extension run test:unit` → 109/109 fichiers, 1890/1890 tests | prouvé | élevée | utiliser |
| CL-003 | `Pipeline.browseVoices()` (réutilisé ici) existait déjà et était déjà branché à la commande `llmVoice.browseVoices` — pas de nouvelle mécanique inventée | fait | `src/commands/index.ts` ligne 168 : `vscode.commands.registerCommand("llmVoice.browseVoices", () => pipeline.browseVoices())` | prouvé | élevée | utiliser |
| CL-004 | Aucune régression | résultat | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint ... --max-warnings=0` → No issues ; `npm run test:unit` → 109/109, 1890/1890 | prouvé | élevée | utiliser |
| CL-005 | Le correctif est réellement packagé et installé | résultat | `npm run package:linux-x64` (exit 0) puis `code --install-extension llm-voice-linux-x64.vsix --force` ; `~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/package.json` horodaté 2026-11-05 16:10, postérieur au build | prouvé | élevée | utiliser |

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
| Affirmations bloquantes non prouvées | Aucune : les 5 affirmations ci-dessus sont prouvées, par lecture directe du code (CL-001, CL-003) et par exécution réelle (CL-002, CL-004, CL-005). |
| Contradictions détectées | Aucune. |
| Hypothèses acceptées temporairement | Aucune. |
| Preuves à obtenir avant livraison | Confirmation visuelle par l'utilisateur (le sélecteur s'ouvre bien après avoir choisi "Voix système" ou "Voix française autonome") — seule preuve finale possible en l'absence d'outil de clic automatisé Wayland. |
