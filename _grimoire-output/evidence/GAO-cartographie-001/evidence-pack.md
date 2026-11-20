# Evidence Pack — GAO-cartographie-001

## Livrable

`_grimoire-output/planning-artifacts/decision-points-map-v1.md` (5 sections demandées : points d'usage,
points d'implémentation, contrat de données proposé, risques/invariants/tests, table finale).

## Fichiers lus pendant cette tâche (Read réel, dans l'ordre)

1. `_grimoire-output/planning-artifacts/decision-models-jev-v1.md` (entier)
2. `_grimoire/_memory/decisions-log.md` (entier)
3. `_grimoire-output/evidence/GAO-diagnostic-s-001/task-envelope.md` (structure de référence)
4. `vscode-extension/src/core/profile.schema.ts` (entier)
5. `vscode-extension/src/core/profile.ts` (entier)
6. `vscode-extension/src/core/narration.ts` (entier)
7. `vscode-extension/src/narrator/createNarratorProvider.ts` (entier)
8. `vscode-extension/src/narrator/narrationContract.ts` (entier)
9. `vscode-extension/src/narrator/OllamaNarrator.ts` (entier)
10. `vscode-extension/src/net/EgressGuard.ts` (entier)
11. `vscode-extension/src/ui/StatusBar.ts` (entier)
12. `vscode-extension/src/profiles/bySource.ts` (entier)
13. `vscode-extension/src/profiles/profileQuickPick.ts` (entier)
14. `vscode-extension/src/claude/InboxQuickPick.ts` (entier)
15. `vscode-extension/src/commands/index.ts` (entier)
16. `vscode-extension/src/pipeline/resolveProviderConfig.ts` (entier)
17. `vscode-extension/src/commands/PipelineFacade.ts` (entier)
18. `vscode-extension/src/profiles/defaults.ts` (entier)
19. `vscode-extension/src/profiles/migrations.ts` (entier)
20. `vscode-extension/src/views/profiles/ProfilesTreeProvider.ts` (entier)
21. `vscode-extension/src/pipeline/Pipeline.ts` — lu par blocs successifs (offsets 1, 120, 180-400, 400-700,
    467-536, 700-900, 900-1100, 1100-1400, 1399-1600, 1600-1900, 1899-1959, 1958-1976) : couvre le fichier
    entier sauf de rares recouvrements volontaires, aucune zone significative sautée
22. `vscode-extension/src/core/index.ts` (entier)
23. `vscode-extension/src/profiles/ProfileRepository.ts` (lignes 1-120)
24. `vscode-extension/src/core/health.ts` (entier)
25. `vscode-extension/src/narrator/shared.ts` (entier)
26. `vscode-extension/package.json` (lignes 1-874, quasi entier)
27. `_grimoire/_memory/shared-context.md` (entier)
28. Un `Glob` sur `vscode-extension/src/**/*.ts` (liste de fichiers, 100 premiers résultats), un `Glob` sur
    `vscode-extension/src/views/**`, un sur `**/PipelineFacade*`, un sur `**/*speakLatestClaudeResponse*`
    (0 résultat — confirme qu'aucun fichier ne porte ce nom, seule la méthode dans `Pipeline.ts`), un sur
    `**/ProfileRepository.ts`

## Chemins cités dans le livrable, tous vérifiés par lecture directe ci-dessus

Voir la table finale (§5) du livrable — 25 chemins listés, tous lus entièrement ou en grande partie dans
cette tâche, sauf les deux exceptions ci-dessous explicitement marquées « non vérifié » dans le livrable
lui-même.

## Points explicitement non vérifiés (marqués comme tels dans le livrable, §1 et §5)

- `vscode-extension/src/ui/statusBarText.ts` — cité comme source probable du texte affiché par la barre
  d'état, jamais ouvert dans cette tâche.
- `vscode-extension/src/views/profiles/profileTreeItems.ts` — cité comme source probable du formatage de
  la vue Profils, jamais ouvert dans cette tâche.
- Existence d'un test unitaire dédié à `createNarratorProvider` aujourd'hui — non recherché.
- Le comportement de l'API native Ollama `/api/generate` avec `logprobs`/`top_logprobs` au-delà de la
  preuve déjà consignée dans `decisions-log.md` (2026-09-27) — repris tel quel, non ré-exécuté.

## Écarts par rapport au brief

- Le brief demandait de citer `PipelineFacade`, la barre d'état, la vue Profils, `InboxQuickPick`,
  `speakLatestClaudeResponse`, `PipelineFacade` : tous couverts. Le brief citait aussi une commande
  `selectProfile` — trouvée comme méthode `Pipeline.selectProfile()`/`selectProfileById()`, pas comme
  fichier séparé ; documenté tel quel (§1.4 du livrable).
- Aucune ligne de code produit modifiée ; aucun fichier sous `vscode-extension/src` écrit, conformément à
  la frontière d'outils de cette tâche.
- Lint des chemins et gate (`grimoire standard gate check --task-id GAO-cartographie-001 --strict`) hors
  frontière d'outils de cet agent (pas de Bash) — à exécuter par l'orchestrateur.

## Lint des chemins cités (orchestrateur, 2026-09-27)

Script Python : extraction des chemins `*.ts|js|json|md|yaml|mjs` entre backticks dans `decision-points-map-v1.md`, test d'existence à la racine ou sous `vscode-extension/`.

```
chemins cités : 30 ; existants : 27 ; introuvables : 3
  MANQUANT vscode-extension/src/core/decision.ts
  MANQUANT vscode-extension/src/decision/OllamaDecisionProvider.ts
  MANQUANT vscode-extension/src/decision/createDecisionProvider.ts
```

Les trois introuvables sont les fichiers **à créer** par la carte d'implémentation `GAO-mode-auto-im-001` (contrat, fournisseur, fabrique), annoncés comme tels dans la carte. Tous les fichiers cités comme existants existent : critère lint passé.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
