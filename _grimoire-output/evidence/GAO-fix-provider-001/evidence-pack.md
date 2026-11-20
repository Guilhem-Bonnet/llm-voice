# Evidence pack — GAO-fix-provider-001

## Origine du correctif

Après le rebuild + réinstallation réels de l'extension (GAO-fix-voix-fra-001),
l'utilisateur a demandé une capture d'écran de l'éditeur de profil ("Je ne vois
nulle part écrit la voix Estelle ou une nouvelle voix qu'on aurait ajoutée").
Vérification du code source (pas seulement de la capture) :

- `src/views/profileEditor/profileEditorHtml.ts:91-96` : le `<select
  id="field-tts-provider">` liste en dur 4 options
  (`chatterbox`/`kokoro`/`system`/`openai-compatible`) — `kyutai-pocket` n'y a
  jamais été ajouté, dans aucune des cartes précédentes.
- `src/pipeline/Pipeline.ts:1036-1052` (`pickVoiceForProfile`, utilisée par le
  bouton « Parcourir les voix ») exige `tts.listVoices !== undefined` ; or
  `KyutaiPocketProvider` ne l'implémentait pas (décision documentée dans son
  ancien commentaire de fichier : "Never implements listVoices()"). Même après
  ajout de l'option au menu, ce bouton serait resté inopérant pour ce
  provider.

Confirmé que le menu d'onboarding simplifié (`SetupVoice.ts`, capturé dans la
première image) est un choix délibéré à 3 options, pas un oubli — ADR-016
qualifie Kyutai de palier avancé optionnel, atteint via l'éditeur de profil,
donc hors périmètre ici.

## Diff

- `vscode-extension/src/views/profileEditor/profileEditorHtml.ts` : ajout de
  `<option value="kyutai-pocket">Kyutai Pocket TTS (local, avancé)</option>`
  au `<select>` du provider TTS.
- `vscode-extension/src/tts/KyutaiPocketProvider.ts` : ajout de
  `listVoices()`, qui retourne `[...KYUTAI_POCKET_VOICE_CATALOG]` sans appel
  réseau (même donnée que `getCapabilities()`, qui ne contactait déjà jamais
  le serveur pour cette liste). Commentaire de fichier mis à jour pour retirer
  l'ancienne justification ("no such endpoint" ne justifiait pas l'absence de
  la méthode elle-même, seulement l'absence d'appel réseau dedans).
- `vscode-extension/test/unit/tts/KyutaiPocketProvider.test.ts` : nouveau test
  `listVoices() resolves the static catalogue with no network call at all,
  even through a denying EgressGuard` — utilise `baseUrl:
  "http://example.com"` (non-loopback, refusé par le vrai `EgressGuard`) pour
  prouver qu'aucune requête réseau n'est tentée : si `listVoices()` appelait
  `fetch`, le test échouerait avec une erreur `denied`.

## Résultat des vérifications

```
cd vscode-extension
npx tsc -p ./ --noEmit                                    → No errors found
npx eslint src/tts/KyutaiPocketProvider.ts \
  src/views/profileEditor/profileEditorHtml.ts \
  test/unit/tts/KyutaiPocketProvider.test.ts \
  --max-warnings=0                                         → No issues found
npm run test:unit   → Test Files 108 passed (108) / Tests 1870 passed (1870)
```

## Reconstruction et réinstallation réelles

```
npm run package:linux-x64   → llm-voice-linux-x64.vsix reconstruit
code --install-extension llm-voice-linux-x64.vsix --force
```

Build et installation confirmés par : date de modification du
`package.json` installé postérieure au build, et présence de
`kyutai-pocket` dans `dist/extension.js` du dossier réellement installé
(`~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0`), pas seulement dans
le dépôt source — même méthode de preuve que GAO-fix-voix-fra-001.

## Risques et limites

- Le catalogue de voix reste minimal (`estelle`/`alba`) — carte séparée déjà
  annoncée (ADR-016 §4).
- L'assistant d'onboarding simplifié n'offre toujours pas `kyutai-pocket` —
  décision volontaire, pas un bug, donc non modifié ici.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
