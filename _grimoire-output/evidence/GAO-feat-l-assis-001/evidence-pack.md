# Evidence pack — GAO-feat-l-assis-001

## Origine du correctif

Réserve bloquante de la relecture Sentinel sur GAO-fix-boucle-i-001 : « au
second clic il affiche seulement « déjà installée et prête à l'emploi ».
Aucun sélecteur de voix ne s'ouvre [...] la moitié « choisir une voix » de
la plainte n'est donc pas traitée. » Lecture du code confirmant le
diagnostic : `handleVoiceTier` (`src/onboarding/handleVoiceTier.ts`)
appliquait un palier de provider puis s'arrêtait — jamais d'appel à
`Pipeline.browseVoices()`, le vrai sélecteur de voix (Quick Pick déjà
existant, déjà branché à la commande `llmVoice.browseVoices`).

## Diff

- `vscode-extension/src/onboarding/handleVoiceTier.ts` : nouvelle action
  `browseVoices: () => PromiseLike<void>` sur `VoiceTierActions` ; appelée
  après `SYSTEM_VOICE_READY_MESSAGE` pour le palier "system", et après
  `executeCommand(INSTALL_PIPER_VOICE_COMMAND)` pour le palier "piper" —
  jamais pour "chatterbox" (son serveur peut ne pas être lancé, l'ouvrir
  échouerait silencieusement ou donnerait une liste vide trompeuse).
- `vscode-extension/src/onboarding/SetupVoice.ts` : `setupVoice()` prend
  désormais un second paramètre `BrowseVoices`, transmis à `realActions`.
- `vscode-extension/src/extension.ts` : le second argument de `setupVoice`
  est branché sur `pipelineRef.current?.browseVoices()`.

## Résultat des vérifications

```
cd vscode-extension
npx tsc -p ./ --noEmit                                       → No errors found
npx eslint src/onboarding/handleVoiceTier.ts \
  src/onboarding/SetupVoice.ts src/extension.ts \
  test/unit/onboarding/handleVoiceTier.test.ts --max-warnings=0 → No issues found
npm run test:unit   → Test Files 109 passed (109) / Tests 1890 passed (1890)
```

Nouveaux tests dans `test/unit/onboarding/handleVoiceTier.test.ts` :
- "'system': opens the real voice picker right after" → `browseVoices`
  appelé exactement une fois.
- "'piper': opens the real voice picker right after installing/confirming"
  → idem.
- "'chatterbox': never opens the voice picker" → `browseVoices` jamais
  appelé pour ce palier.

## Reconstruction et réinstallation réelles

`npm run package:linux-x64` puis `code --install-extension
llm-voice-linux-x64.vsix --force` ; vérifié sur le fichier réellement
installé, pas seulement le dépôt source.

## Risques et limites

- Le palier Piper n'a toujours qu'une seule voix disponible
  (`SystemTtsProvider.listVoices()` pour `case "piper"`) — le sélecteur
  s'ouvrira avec une seule entrée, ce qui est honnête (reflète la réalité)
  mais peut sembler anticlimatique après l'avoir attendu.
- Le palier "chatterbox" n'ouvre toujours pas de sélecteur immédiatement —
  l'utilisateur doit lancer Docker puis utiliser "Parcourir les voix"
  séparément depuis l'éditeur de profil.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
