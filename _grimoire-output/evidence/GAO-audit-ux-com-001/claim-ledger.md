# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-audit-ux-com-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Le choix de voix (`applyVoiceTierChoice`) ne modifie jamais le `label` du profil, seulement son `tts`, et aucune des 3 surfaces persistantes (player, panneau Profils en ligne visible, barre de statut) n'affiche le provider/voix choisi | fait | lecture directe de `vscode-extension/src/pipeline/Pipeline.ts:1926-1937`, `vscode-extension/media/player/player.js:139`, `vscode-extension/src/views/profiles/profileTreeItems.ts`, `vscode-extension/src/ui/statusBarText.ts`, par deux agents indépendants (auteur de l'audit, puis relecteur Sentinel qui a revérifié chaque fichier lui-même) | prouvé | élevée | utiliser |
| CL-002 | L'éditeur de profil n'a pas reçu le même traitement que le panneau Profils (descriptions en clair) — ses `<select>` exposent des noms de produits bruts sans explication | fait | lecture directe de `vscode-extension/src/views/profileEditor/profileEditorHtml.ts` lignes 74-97, confirmée par le relecteur indépendant (y compris 3 détails supplémentaires non vus par l'auteur : champ Base URL brut, page en anglais `lang="en"`, titre "Profile Editor") | prouvé | élevée | utiliser |
| CL-003 | Le rapport initial contenait des affirmations trop absolues ou une erreur, corrigées avant clôture : ambiguïté Piper/système non signalée, nom de fonction erroné (`applyProviderChoice`), "aucune surface" trop absolu pour le panneau Profils (son tooltip change déjà) | résultat | rapport de relecture Sentinel (2026-11-05), citant `vscode-extension/src/onboarding/voiceTiers.ts:115-123`, `extension.ts:168-169`, `vscode-extension/src/profiles/profileQuickPick.ts:19` ; corrections appliquées dans `docs/ux/audit-2026-11-05.md` (diff de cette carte) | prouvé | élevée | utiliser |
| CL-004 | La relecture indépendante confirme la priorisation (bloque la compréhension de base / gênant / cosmétique) comme défendable, avec fusion des points 1 et 3 (même cause racine) | décision | rapport de relecture Sentinel, verdict "accepté avec réserves, aucune bloquante" ; fusion appliquée dans la synthèse priorisée du rapport | prouvé | élevée | utiliser |

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
| Affirmations bloquantes non prouvées | Aucune : les 4 affirmations ci-dessus sont prouvées par deux lectures indépendantes du code réel, pas seulement par le rapport de l'auteur. |
| Contradictions détectées | Les 3 réserves mineures de la relecture Sentinel (ambiguïté Piper/système, nom de fonction erroné, "aucune surface" trop absolu) — toutes corrigées dans le rapport avant clôture. |
| Hypothèses acceptées temporairement | Aucune. |
| Preuves à obtenir avant livraison | Aucune pour l'audit lui-même ; les limites déclarées (profileEditor.js/.css, UseOwnVoice.ts, package.json non lus en entier, aucun rendu visuel observé) restent des zones non couvertes, documentées comme telles dans le rapport plutôt que présentées comme vérifiées. |
