# Evidence pack — GAO-studio-distr-001 (partiel, rapport d'état à la limite de tours)

## Fait
- `vscode-extension/src/views/castPanel/castPanelModel.ts` : modèle du panneau (lignes, voix, colonne `proposal` optionnelle), validation des messages de la page, description anglaise composée (`composeVoiceDescription`), message « voix manquantes » (`castNotice`).
- `vscode-extension/test/unit/views/castPanelModel.test.ts` : 3 tests (vitest) verts.

## Commandes exécutées (voir rapport) : typecheck, lint, test:unit.

## Pas fait
Contrôleur, webview (HTML/JS/CSS), câblage Pipeline/commande/bouton lecteur, client Qwen3 (`/voices/create`, `/voices/<id>/sample`), `multiVoice` Qwen3, mock serveur, test d'intégration, captures 500/900 px, intégration fake-tts/security/voice. Aucun commit.

## Reprise (arbitrages du coordinateur)
- Commit 73764a2 : Qwen3 multiVoice, voix créées listées (origin), événement utilisateur `userRecast`, préparation complète aussi à plusieurs voix ; typecheck 0, lint 0, test:unit 151 fichiers / 3159 tests verts, build 0.
- Incrément 2 : client `src/tts/qwen3Voices.ts` (urlencodé, aligné sur `parse_form`), `CastPanelController`, `CastPanel` (localResourceRoots en Uri.file), `media/castPanel/*`, commande `llmVoice.openCastPanel`, bouton Distribution du lecteur → panneau, faux serveur `/voices/create` et `/voices/<id>/sample`, test `test/integration-voice/cast-panel.test.ts`.
- `xvfb-run -a npx vscode-test --label voice-chain` : 52 passing, 0 failing (dont le test du panneau). fake-tts : 79 passing, 0 failing. integration-security : 8 passing, 0 failing. Ces trois suites ont tourné AVANT le remplacement de `friendlyTtsProviderLabel` par `engineLabelOf` (invariant command-ids) ; `--mute-audio` ajouté au label voice-chain après son passage.
- Captures 500/900 px : non faites.
