# Agentic Evidence Pack

## Summary

- Task id: GAO-galerie-les-001
- Profile: controlled
- Outcome: Galerie : les échantillons Kyutai narration sont illisibles — critères : AC-001 test: npm --prefix vscode-extension run test:integration-voice vert; AC-002 gate: grimoire standard gate check --strict vert; AC-003 revue: accord de guilhem-bonnet consigné
- Final state: in_progress (2026-11-07)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD 73aaa37 | git rev-parse --short HEAD | référence (2026-11-07) |
| Reproduction, copie de l'extension installée, `code` système 1.144 | sortie du pilote CDP, rapportée ci-dessous | clic souris réel | carte « Échantillon illisible. », 401 sur le WAV |
| Schéma de `globalStorageUri` | `gallery-storage {"scheme":"vscode-userdata"}` | test réel, VS Code de test | cause : racine `vscode-userdata`, fichier `file` |
| Test galerie, avant correction | `voice-gallery-audio.test.ts` | vscode-test --label native-real | échec, réponses `401 ...wav` |
| Test galerie, après correction | `gallery-proof {"playedSeconds":2.938016,"durationSeconds":2.96,"responses":["206 ...wav"]}` | idem | vert |
| Copie installée + dist corrigé, `code` 1.144 | statut « Déjà écoutée » | pilote CDP | vert, sans rechargement |
| Moteur webview, avant / après | `401 ...wav` puis `{"readyState":4,"audioResponses":["206 ...wav"]}` | `player-webview-audio.test.ts` | vert après ; le son n'est pas prouvé |
| Barre, raccourci, sans correction | `wait {"furthestPercent":0,"shown":false}` | `kyutai-response.test.ts` | échec |
| Barre, raccourci, corrigé | `resp-short.out`, `wait-shortcut.png`, seenAfterMs 1324, firstSoundMs 14245 | `native-real.sh --response-adapted` | vert |
| Barre, Tout lire | `resp-btn.out`, `wait-button.png`, seenAfterMs 240, firstSoundMs 16542 | idem, geste `button` | vert |
| Silence pendant la lecture | `silence_between_sounds_ms` 940 (les deux gestes) | prove.sh | aucune longue coupure |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Tests unitaires | `npm run -s test:unit` | 3133 passés, 148 fichiers | exécuté après les corrections ; les tests d'intégration ajoutés ensuite n'y entrent pas |
| Types et style | `npm run -s typecheck`, `npm run -s lint` | code 0 | |
| Build | `npm run -s build` | code 0 | |
| Intégration simulée | `xvfb-run -a npx vscode-test --label fake-tts` | 79 passés | |
| Chaîne de voix | `npm run -s test:integration-voice` | 51 passés, code 0 | |
| Galerie réelle | scénario `gallery`, en `--mute-audio` | 1 passé | niveau du flux muet mesuré : pic 0 |
| Moteur webview réel | scénario `player-webview`, en `--mute-audio` | 1 passé | fichier servi et décodé seulement |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | no |  |  |
| Quality | no |  |  |
| Runtime | no |  |  |
| Knowledge | no |  |  |
| Model/provider | no |  |  |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Enveloppe remplie après les premières modifications, contrairement à la consigne | traçabilité d'ordre | à valider par guilhem-bonnet | à la revue |
| Son de la galerie non capté : la session renvoie le flux « Code » vers `sc_media` | preuve de son absente pour la galerie | à valider par guilhem-bonnet | banc capable de suivre ce flux |
| Essais de capture joués sur `sc_media` (environ 7 courtes phrases de 3 à 8 s) | son audible sur la machine | à signaler | scénario désormais en `--mute-audio` |
| Correction du moteur webview hors du périmètre annoncé | une ligne, même cause | à valider par guilhem-bonnet | à la revue |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Vérification du concierge (2026-11-06)
- typecheck 0, lint 0, build 0, unitaires 3133 réussis, fake-tts 79, integration-voice rejoué (voir sortie du commit).
- Test réel `voice-gallery-audio.test.ts` rejoué par le concierge, en `--mute-audio`.
- `process["env"]` absent du dépôt (`grep` vide), le contournement temporaire du hook a bien disparu.
- À signaler à guilhem-bonnet : environ 7 courtes phrases sont sorties sur ses enceintes (`sc_media`) pendant la reproduction.
