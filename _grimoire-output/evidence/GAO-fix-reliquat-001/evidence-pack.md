# Agentic Evidence Pack

## Summary

- Task id: GAO-fix-reliquat-001
- Profile: controlled
- Outcome: Fix · Reliquats voix : port par défaut de Kokoro, bouton sans effet en préparation, avertissement de fenêtre périmée non testé — critères : AC-001 test: warnIfInstallIsNewer couvert; AC-002 test: action visible et efficace en preparing et buffering; AC-003 test: npm --prefix vscode-extension run test:unit vert; AC-004 gate: grimoire standard gate check --strict vert
- Final state: in_progress (2026-11-06)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD de4d8b5 | git rev-parse --short HEAD | référence (2026-11-06) |
| Socle avant modification | sortie de `npm --prefix vscode-extension run test:unit` | exécution réelle | 111 fichiers, 1910 tests verts |
| Phase rouge | vitest sur `installFreshness`, `resolveProviderConfig`, `player.behavior`, `playback-controller` | exécution réelle | 22 tests en échec, plus 1 suite impossible à charger (`Cannot find module installFreshness.js`) ; 69 tests verts |
| Comportement observé avant correctif, reliquat 2 | `player.behavior.test.ts`, code réel de `media/player/player.js` | exécution réelle | en `preparing` et `buffering`, le clic envoie `{type:"userAction",action:"play"}` (`expected { action: 'play' } to deeply equal { action: 'stop' }`), le bouton reste sur `▶`, aucun message d'état |
| Pourquoi le clic restait sans effet | `src/extension.ts` → `pipeline.play()` → `decidePlay` | lecture du code, et `playDecision.test.ts` qui fige `noop` pour ces deux états | `noop` silencieux côté hôte |
| Reliquat 3 confirmé avant correctif | `resolveProviderConfig.test.ts` | exécution réelle | `{providerId:"kokoro"}` et `llmVoice.tts.provider: "kokoro"` donnent tous deux le port du réglage (8004, Chatterbox), ou une URL vide si le réglage est vide |
| Annulation côté contrôleur | 2 tests ajoutés à `playback-controller.test.ts` | exécution réelle | verts dès la phase rouge : `stop()` empêchait déjà toute lecture tardive, seul le bouton ne le déclenchait pas |
| Mutations de `installFreshness.ts` | 5 mutations appliquées puis annulées, `diff` final identique | exécution réelle | chacune fait échouer de 1 à 2 tests : `<=`→`<` 2, sans garde `warned` 2, sans capture du `stat` 2, garde consommée à vide 1, condition de rechargement inversée 2 |
| `piper-local` (hors périmètre, non corrigé) | `node` sur `out/src/pipeline/resolveProviderConfig.js` | exécution réelle | `{providerId:"piper-local"}` et `llmVoice.tts.provider: "piper-local"` donnent `http://127.0.0.1:8004`, alors que `package.json` annonce le port 5000 |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Tests | `npm --prefix vscode-extension run test:unit` | exit 0 : 112 fichiers, 1949 tests verts | commande directe ; `grimoire standard gate run-tests` non lancé par cet agent, donc pas de `test-run.json` |
| Compilation | `npm --prefix vscode-extension run compile` | exit 0 | un premier passage échouait sur TS6133 (`fsp` devenu inutilisé dans `Pipeline.ts`), corrigé |
| Types | `npm --prefix vscode-extension run typecheck` | exit 0 | |
| Lint | `npm --prefix vscode-extension run lint` | exit 0 | même erreur `fsp` au premier passage, corrigée |
| Completion Contract | `bash _grimoire/kit/framework/cc-verify.sh` | CC PASS `[docker]` | ne contrôle que la pile Docker, il ne prouve rien sur le TypeScript |
| Vrai VS Code | aucun | non exécuté | rendu du webview, clic réel et notification restent à prouver ; banc audio et GPU exclus par le brief |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | no |  |  |
| Quality | yes | tests rouges puis verts, mutations, compile, typecheck, lint | Aucun test du câblage dans `Pipeline.ts`, qui importe `vscode` |
| Runtime | no |  |  |
| Knowledge | no |  |  |
| Model/provider | no |  |  |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Le bouton d'annulation utilise le glyphe texte U+2715 et non un codicon | Le webview ne charge aucune police codicon ; les autres boutons sont déjà des glyphes texte | À décider par le demandeur | Passage du lecteur aux codicons |
| Kokoro respecte une URL personnalisée de `llmVoice.tts.baseUrl`, alors que Kyutai ignore ce réglage | Évite une régression pour qui a choisi Kokoro par ce réglage ; un serveur Kokoro réellement sur 8004 doit fixer `tts.baseUrl` dans son profil | À décider par le demandeur | Revue de `resolveTtsConfig` |
| `piper-local` garde le même défaut de port | Une lecture Piper choisie explicitement vise Chatterbox | À décider par le demandeur | Carte de suivi |
| Le raccourci `Ctrl+Alt+V Space` reste sans effet en `preparing`/`buffering` | `decidePlayPause` renvoie toujours `noop`, figé par `playDecision.test.ts` | À décider par le demandeur | Carte de suivi |
| `Pipeline.stop()` n'annule pas `captureAbort` | Avant `controller.start`, un arrêt ne stoppe pas une lecture en cours de démarrage (lecture du code, non exécuté) | À décider par le demandeur | Carte de suivi |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Compléments du concierge (2026-11-05)

- Défaut confirmé : `Pipeline.stop()` n'annulait pas une lecture en préparation ; le contrôleur reste `idle` pendant la capture et le narrateur, donc la lecture démarrait après l'arrêt.
- Test : `test/integration/pipeline.test.ts` « a stop while the reading is still being prepared cancels it ». Sans `pendingStart.abort()` : 64 passing, 1 failing. Avec : 65 passing (`xvfb-run -a npx vscode-test --label fake-tts`).
- `piper-local` : même correction de port que Kokoro, 2 tests rouges puis verts dans `resolveProviderConfig.test.ts`.
- `npm --prefix vscode-extension run test:unit` : 112 fichiers, 1952 tests verts. Lint et typecheck sans erreur.
- Non prouvé sur vrai VS Code : voir la liste du rapport, dont le rendu du lecteur à 260, 320 et 500 px et l'avertissement de rechargement lors d'une montée de version.
