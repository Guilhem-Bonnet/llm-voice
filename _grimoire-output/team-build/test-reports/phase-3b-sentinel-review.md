# Phase 3b — Sentinel review + Flow merge — PR #24 (S3.5)

## Verdict
Approuvé, merge squash réussi. SHA de merge : `829fc1b1d7ae423858c6fb08df455bbcd4a406ff`.

## Arbitrages appliqués (3 commits `fix(review)` sur feat/s3-5-integration)

1. `4ecb509` — **Réglage orphelin `llmVoice.tts.baseUrl`/`tts.provider`** :
   `TtsBinding`/`NarratorBinding` (`src/core/profile.ts`) : `providerId`/`baseUrl`
   (et `model` pour narrator) deviennent optionnels. Nouveau module pur
   `src/pipeline/resolveProviderConfig.ts` : `resolveTtsConfig(tts, settings)`
   et `resolveNarratorConfig(narrator, settings)` implémentent
   `profile.tts.baseUrl ?? settings.tts.baseUrl` (le setting est le défaut, le
   profil surcharge). `Pipeline.ttsFor()` et `Pipeline.verifyLocalMode()`
   utilisent désormais les valeurs résolues. `bindingFrom` (PlaybackController)
   et `isRemoteProfile` (profile.schema.ts) adaptés pour les champs optionnels.
   Test unitaire dédié : `test/unit/pipeline/resolveProviderConfig.test.ts`
   (7 cas : fallback complet, override partiel providerId seul, baseUrl seul,
   les deux, narrator undefined, narrator partiel).
   Les 4 profils par défaut (`src/profiles/defaults.ts`) restent inchangés :
   ils déclarent toujours tout explicitement, donc aucun changement de
   comportement observable pour l'utilisateur par défaut.

2. `2fff96f` — **Couverture 80 % scope pur** : `coverage.include` couvrait
   `src/**/*.ts` en entier (y compris `extension.ts`, `commands/`, `ui/`,
   `views/`, `sources/`, `ProfileRepository.ts`, `WebviewAudioSink.ts`,
   `Pipeline.ts`), pour une couverture globale réelle de 59,75 % et aucun
   `thresholds` configuré — rien ne pouvait faire échouer CI sous un seuil.
   `vitest.config.ts` : `coverage.include` recentré sur `src/core`,
   `src/parser`, `src/playback`, `src/net`, `src/pipeline` (avec `exclude`
   explicite de `Pipeline.ts`), `src/profiles/defaults*.ts` ; `exclude`
   commenté pour `WebviewAudioSink.ts`, `Pipeline.ts`, `ProfileRepository.ts`
   (renvoi vers `test/integration/**`/`test/integration-real/**`).
   `coverage.thresholds.lines = 80` ajouté.
   Vérifié localement : 93,52 % → exit 0 ; test de contrôle avec seuil
   temporaire à 99 % → `vitest run` sort en erreur (exit 1,
   "ERROR: Coverage for lines (93.51%) does not meet global threshold (99%)"),
   confirmant que le job CI `unit` échouera bien sous le seuil réel.

3. `b161526` — **Pinning anti-éviction + métadonnées sidecar (ADR-004)** :
   aucun changement de code (le gap est déjà documenté dans les commentaires
   de `DiskAudioCache.ts`, section "Known gap vs. the full ADR-004 sidecar
   shape"). Entrée « Reporté phase 4 » ajoutée à la section Conséquences
   d'`docs/adr/ADR-004-storage-inbox-cache.md`.

4. `ce66c43` — **Correction complémentaire hors périmètre initial** :
   `integration (macos-latest)` échouait déjà sur le commit d'origine de la PR
   (`1af959a`, avant toute correction de cette revue) — le chemin de checkout
   macOS GH Actions (`/Users/runner/work/llm-voice/llm-voice/vscode-extension/...`)
   combiné à `--user-data-dir=.vscode-test/user-data-real-provider` dépassait
   la limite de 103 caractères du `sockaddr_un` (`Error: listen EINVAL`),
   bloquant le job `package` (qui dépend de `[unit, integration, audit]`).
   Répertoires raccourcis (`user-data-fake-tts` → `fake-tts`,
   `user-data-real-provider` → `real-provider`) dans `.vscode-test.mjs`.
   Nécessaire pour atteindre 9/9 checks verts — sans quoi le merge n'aurait
   jamais été possible en l'état.

## Vérifications point par point (arbitrage 4 de la consigne)

| Point | Preuve | Résultat |
|---|---|---|
| AC-01..06 | `test/integration/pipeline.test.ts`, 5 tests, exécutés via `xvfb-run -a npm run test:integration` (profil `fake-tts`) | **PASS** |
| `tts-unavailable` : pas de crash, message avec Retry | `test/integration-real/tts-unavailable.test.ts` : `assert.doesNotReject`, état final `error`, `statusBar.text` matche `$(error)`. Le bouton "Retry" est prouvé par lecture de code (`Pipeline.handleChunkError` → `showErrorMessage(ERROR_TTS_UNAVAILABLE, "Retry", "Open provider settings")`), non asserté par l'UI headless (VS Code ne permet pas d'intercepter les boutons de `showErrorMessage` en test d'intégration standard) | **PASS** (avec réserve documentée) |
| `test/unit/invariants/no-autoplay.test.ts` échouerait sur import interdit | Essai réel effectué : création temporaire de `src/claude/AutoPlayer.ts` importateur de `PlaybackController` + appel `.start(`, exécution de `npx vitest run test/unit/invariants/no-autoplay.test.ts` → 2/2 tests échouent (`existsSync` = true, `offenders` contient le fichier). Fichier temporaire retiré (`rm` + `rmdir`), test repasse au vert (`git status --short` propre après). | **PASS** |
| EgressGuard réellement utilisé par `OpenAICompatibleTtsProvider`, pas de `fetch` nu hors `src/net` | `grep -rn "fetch(" src \| grep -v src/net` → seuls 4 hits, tous dans `src/tts/OpenAICompatibleTtsProvider.ts` via `this.egress.fetch(...)` | **PASS** |
| `LLM_VOICE_TEST_FAKE_TTS` inopérant en `ExtensionMode.Production` | `extension.ts` : garde `context.extensionMode !== vscode.ExtensionMode.Production && process.env.LLM_VOICE_TEST_FAKE_TTS === "1"` | **PASS** |
| `dist/extension.js` sans chemin absolu ni secret | `grep -c "/home/" dist/extension.js` = 0 (build local post-fix et post-merge) ; recherche de motifs `sk-`/`ghp_`/`AKIA` = 0 | **PASS** |
| `.vscodeignore` exclut `node_modules`, tests, fixtures, `out/` | Contenu vérifié : `.vscode-test/**`, `test/**`, `out/**`, `src/**`, `node_modules/**`, `coverage/**`, etc. — `test/**` couvre fixtures | **PASS** |
| CSP du player inchangée | `PlayerViewProvider.ts` : `default-src 'none'; media-src …; script-src 'nonce-…'; style-src …; font-src …; img-src …; connect-src 'none'` — conforme à ADR-001 | **PASS** |
| `audio.src` validé par `new URL()` (motif CodeQL `js/xss`) | `media/player/player.js` : `url = new URL(message.src); … audio.src = url.href;` — motif de validation structurelle déjà présent | **PASS**, aucune alerte CodeQL ouverte post-merge (`gh api .../code-scanning/alerts` vide) |

## CI PR #24 (après les 4 commits `fix(review)`)

9/9 checks verts : `audit`, `codeql`/`CodeQL`, `lint`, `unit`, `integration (ubuntu-latest)`, `integration (windows-latest)`, `integration (macos-latest)`, `package`.

## Validation locale sur `origin/main` post-merge (829fc1b)

- `npm ci` — OK (640 paquets ; 10 vulnérabilités npm audit préexistantes, non liées à cette PR, job `audit` CI dédié passe avec `--omit=dev --audit-level=high`)
- `npm run lint` — clean (`eslint . --max-warnings=0`)
- `npm run typecheck` — clean (`tsc -p ./ --noEmit`)
- `npm run test:unit -- --coverage` — **281/281 tests**, couverture **93,52 %** lignes sur le périmètre scope (seuil 80 % respecté, exit 0)
- `xvfb-run -a npm run test:integration` — **14/14** (13 profil `fake-tts` + 1 profil `real-provider-unavailable`)
- `npm run package` — VSIX **222,21 KB, 12 fichiers**, `dist/extension.js` sans chemin absolu

## Commentaires postés sur la PR
- Revue complète (arbitrages 1-3 + vérifications point par point)
- Note complémentaire sur la correction macOS CI (arbitrage 4, hors périmètre initial mais bloquant)
