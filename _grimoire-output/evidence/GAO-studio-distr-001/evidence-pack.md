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

## Reprise 2 (priorités 1 à 4)
- Description : le caractère libre est remplacé par 12 caractères à cocher (libellé français, traduction anglaise fixe, 3 au plus) ; test « toujours ASCII » sur toutes les combinaisons ; le faux serveur refuse le non-ASCII (400) et compare les noms sans casse ni espaces (409).
- Attente : au moins 30 s annoncées pour la première écoute d'une voix créée par ce panneau (test unitaire du contrôleur).
- Captures (rendu de la page réelle castPanel.js/css dans Chromium headless --mute-audio, état fixe aux 9 voix réelles) : distribution-500px.png, distribution-500px-change.png, distribution-900px.png, distribution-900px-change.png ; button-check.txt : 0 bouton débordant ou replié aux deux largeurs.
- Essai réel en lecture seule (serveur 8021) : listVoices → 9 voix (1 catalogue + 8 créées, libellés du serveur) ; GET /voices/v-6562692073/sample → 437 804 octets, en-tête RIFF ; aucune création, aucune lecture.
- Suite relancée après les derniers changements : typecheck 0, lint 0, test:unit 152 fichiers / 3162 tests, build 0, fake-tts 79 passing, integration-security 8 passing, voice-chain vert (voir rapport). `--mute-audio` placé avant `--user-data-dir` : en dernier, il avalait le dossier de travail (V1 cause C échouait).
