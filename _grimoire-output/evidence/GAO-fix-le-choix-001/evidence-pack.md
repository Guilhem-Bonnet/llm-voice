# Evidence pack — GAO-fix-le-choix-001

## Origine du correctif

Après GAO-impl-mente-l-001, l'utilisateur a testé réellement l'assistant
"Choisir une voix" et rapporté "je vois aucun changement" (capture d'écran).
Lecture du code (pas seulement la description du correctif précédent) :

- `Pipeline.applyVoiceTierChoice` (`src/pipeline/Pipeline.ts`) mettait bien
  à jour `this.currentVoiceLabel`, mais n'appelait ni
  `this.pushPlayerState()` ni `this.statusBar.update(...)` — ces deux appels
  n'existent qu'aux endroits suivants : événements de lecture
  (`controller.onProgress`, changement d'état), et
  `selectProfileById()`→`refreshLocalModeBadge()` (changement de profil
  actif). Un simple changement de voix sur le profil déjà actif ne
  déclenchait donc jamais de rafraîchissement.
- Même constat pour `browseVoices()` ("Parcourir les voix" / commande "LLM
  Voice: Browse Voices").

Donc le correctif précédent (GAO-impl-mente-l-001) était réel mais
insuffisant seul : il avait rendu l'indicateur possible, pas son
déclenchement immédiat.

## Diff

- `vscode-extension/src/pipeline/Pipeline.ts`, `applyVoiceTierChoice` : ajout
  de `await this.refreshLocalModeBadge();` et `this.pushPlayerState();`
  juste après la mise à jour de `currentVoiceLabel`, avant le toast.
- Même ajout dans `browseVoices()`.

`refreshLocalModeBadge()` est le motif déjà établi ailleurs dans ce fichier
(`selectProfileById`) pour "recalculer et pousser la barre de statut après
un changement affectant le profil" — pas une nouvelle mécanique inventée ici.
`pushPlayerState()` est sûr à appeler même hors session de lecture (il lit
`controller.getChunks()`/`getCurrentIndex()`/`getState()`, tous valides à
vide).

## Résultat des vérifications

```
cd vscode-extension
npx tsc -p ./ --noEmit                        → No errors found
npx eslint src/pipeline/Pipeline.ts --max-warnings=0 → No issues found
npm run test:unit  → Test Files 109 passed (109) / Tests 1881 passed (1881)
```

Aucune régression. Aucun nouveau test unitaire dédié : `Pipeline.ts` dépend
fortement de l'API `vscode` et n'a pas de suite de tests unitaires couvrant
`applyVoiceTierChoice`/`browseVoices` (seuls des tests d'intégration
`vscode-test` existent, hors `npm run test:unit`) — limite assumée, déjà le
cas avant ce correctif.

## Reconstruction et réinstallation réelles

`npm run package:linux-x64` puis `code --install-extension
llm-voice-linux-x64.vsix --force` ; vérifié sur le fichier réellement
installé (`~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/dist/
extension.js`), pas seulement le dépôt source.

## Limite de preuve assumée

Aucun outil de clic automatisé Wayland sur ce poste (mémoire du projet) —
ce correctif ne peut pas être prouvé par un clic réel dans VS Code depuis
cette session. Seule la relecture de code (confirmant l'appel manquant puis
ajouté) et la non-régression des tests existants constituent la preuve
automatisée ; la confirmation visuelle finale revient à l'utilisateur.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
