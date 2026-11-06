# Agentic Evidence Pack

## Summary

- Task id: GAO-r-ponses-1-l-001
- Profile: controlled
- Outcome: Réponses 1 · Liste Réponses, dernière réponse, raccourci, durées — critères : AC-001 test: npm --prefix vscode-extension run test:unit vert; AC-002 gate: grimoire standard gate check --strict vert; AC-003 revue: accord de guilhem-bonnet consigné
- Final state: in_progress (2026-11-06) ; rien n'est commité ; gate et accord de guilhem-bonnet restent à obtenir par le concierge

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD a851b70 | git rev-parse --short HEAD | référence (2026-11-06) |
| Rouge avant le code | 6 fichiers de test, 3 suites sans module, 15 tests en échec, 54 passants | `npx vitest run` sur `responseRow`, `ResponsesFeed`, `responses.behavior`, `responses-wording`, `command-ids`, `inboxFormat` | constaté avant toute écriture de `src/` |
| Rendu statique 260, 320, 500 px | `rendu/{panel,liste,menu,vide,plus}-w{260,320,500}.png` | Firefox 159 sans écran, sur le vrai `player.js`, `responses.js`, CSS et HTML | regardé ; chaque page porte sa mesure en vert |
| Rendu réel dans VS Code | `rendu/vscode-reel.png` | `Page.captureScreenshot` sur la fenêtre de `native-real.sh --response` | bloc du panneau, vue Réponses, badge 1 visibles ; regardé |
| Preuve audio réelle | sortie ci-dessous | `LLM_VOICE_NATIVE_REAL_SHOT=… bash scripts/audio-proof/native-real.sh --response` | exit 0 |

Mesure affichée par les pages : à 260, 320 et 500 px, aucun bouton hors cadre, aucun bouton sans `nowrap`, boutons icône de 28 px. Hauteurs : 25 (`Choisir une voix`, existant), 26, 28.

Preuve réelle (voix Camille, Kyutai 1.6B sur le port 8020, Core réel, GPU libre, `gpu-yield/active` absent, service `gpu_yield:false`) :

```json
{"wer": 0.0, "transcription": "Les deux pannes sont corrigées, la lecture part maintenant du raccourci, rien ne se lit tout seul.", "duration_s": 37.888, "rms": 0.02774, "silent": false, "wer_ok": true, "pass": true}
```

`response-proof {"firstSoundMs":10943,"totalMs":17556}`, 1 test passant, `test vscode-test exit=0 ; banc prove.sh exit=0`.

Le test : réponse de test dans un `mktemp -d` (`LLM_VOICE_INBOX`), l'inbox de l'utilisateur n'est jamais lue. Rien ne part avant le geste. Focus dans un terminal intégré. Témoin : `Ctrl+Alt+V C`, qui porte `!terminalFocus`, ne démarre rien alors que le presse-papiers a du texte. Puis vraies frappes `Ctrl+Alt+V`, `R` par le protocole de débogage du navigateur (`Input.dispatchKeyEvent`). Lecture jusqu'à `completed`, réponse marquée lue.

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Types | `npm run -s typecheck` | exit 0 | |
| Lint | `npm run -s lint` | exit 0 | |
| Tests | `npm run -s test:unit` | exit 0 : 143 fichiers, 2904 tests | |
| Build | `npm run -s build` | exit 0 | code de sortie relevé par `echo $?` |
| Intégration | `xvfb-run -a npx vscode-test --label fake-tts` | exit 0 : 77 passants | dont AC-15, dernière réponse tous outils, ancien id, `ctrl+alt+v r` lu dans les raccourcis par défaut de VS Code, arrivée sans lecture, badge |
| Sécurité | `xvfb-run -a npx vscode-test --label integration-security` | exit 0 : 8 passants | |
| Chaîne de voix | `npm run -s test:integration-voice` | 1er passage : 34 passants, 1 échec ; 2 passages suivants : exit 0, 35 passants | échec dans `cast-voices.test.ts`, voir écarts |
| Preuve réelle | `native-real.sh --response` | exit 0, WER 0,0 | |
| CC | `bash _grimoire/kit/framework/cc-verify.sh --changed-only` | « Aucun stack détecté » | ne vérifie rien ici ; les commandes ci-dessus font foi |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | yes | enveloppe respectée ; écarts listés ci-dessous | accord de guilhem-bonnet à consigner |
| Quality | yes | tests écrits d'abord, suites ci-dessus | clics réels dans VS Code non joués |
| Runtime | yes | preuve audio réelle, photo de la fenêtre | |
| Knowledge | yes | CHANGELOG, README | `docs/user-guide.md` hors périmètre, à reprendre |
| Model/provider | no | sans objet | |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Défaut `modes.bySource.claude-code` passé de `llm-summary` à `faithful-local` | « Tout lire » ne passait pas le texte par l'IA locale ; conforme à decisions-log 2026-11-06, contraire à CdC §47. Réglage explicite respecté | à confirmer par guilhem-bonnet | retour utilisateur |
| `Ctrl+Alt+V R` sans `!terminalFocus` | Sinon le `r` s'écrit dans l'invite de l'outil. Contredit `docs/user-guide.md` (« Aucun raccourci capturé dans le terminal ») et `Ctrl+Alt+V` n'atteint plus le shell | à confirmer par guilhem-bonnet | retour utilisateur |
| Vue `llmVoice.inboxView` passée de Tree View à webview | Seule façon d'avoir deux lignes et un bouton toujours visible. `InboxTreeProvider.ts` supprimé, entrée `viewsWelcome` retirée | à confirmer | |
| Badge de l'icône absent tant que la vue n'a pas été ouverte dans la fenêtre | Perte par rapport au Tree View | à confirmer | |
| `src/ui/StatusBar.ts` laisse « Ouvrir l'inbox » | Barre d'état exclue par l'enveloppe (Réponses 4) | | Réponses 4 |
| `media/walkthrough/connect-claude.svg`, `docs/user-guide.md` disent encore « inbox » | Hors périmètre | | carte de documentation |
| Commandes « Install/Uninstall Claude Hook » gardent leur nom | La capture relève de Réponses 3 | | Réponses 3 |
| `.vscode-test.mjs`, `scripts/audio-proof/native-real.sh`, `test/integration-native-real/` modifiés | Exigés par la preuve réelle | | |
| Durée calculée sur `normalize()` | L'adaptation à l'oral (code ignoré) est Réponses 2 : la durée d'une réponse avec code suit ce qui est lu aujourd'hui | | Réponses 2 |
| Échec unique de `cast-voices.test.ts` | Test du jeu d'acteurs, sans lien visible avec cette carte ; deux passages suivants verts ; cause non cherchée | | se reproduit |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.
