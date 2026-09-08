# Phase 2 — Revue Sentinel + merge Flow — 2026-09-08

Repo : `Guilhem-Bonnet/llm-voice`. Ordre traité : #18 → #16 → #17, séquentiel,
chacune rebasée/mergée sur `main` après fusion de la précédente.

## PR #18 — ADR-001..005 + `src/core/*` + `profile.schema` + zod

**Verdict : GO, mergé.** SHA squash `2c1f19e0063da272cd340a24bbc1436f29e2d9a8`.

- (1) Couverture CdC/D2/D4 : `src/core/tts.ts` porte `synthesizeStream?`
  (optionnel, D2) et `AudioFrame` complet (chunkId/sequence/format/sampleRate/
  channels/data/isFinal). `src/core/playback.ts` porte les unions
  `ExtensionToWebviewMessage`/`WebviewToExtensionMessage` complètes
  (load/play/pause/stop/seek/setRate/setVolume/state et
  ready/timeupdate/ended/error/userAction), conformes à D4. OK.
- (2) `grep` négatif sur `vscode` dans `src/core/` — confirmé, seule mention
  est un commentaire de documentation dans `index.ts`.
- (3) `isRemoteProfile()` : JSDoc renforcé (commit de revue) pour préciser
  explicitement que c'est un test lexical sans DNS réservé au badge 🔒/☁, et
  que `EgressGuard` (ADR-005, D10, phase 3) est la garde réseau réelle.
  `isLoopbackUrl` portait déjà cette précision ; ajoutée aussi sur
  `isRemoteProfile` directement.
- (4) `zod` en dépendance de production (AC-SEC-05) : accepté, mais **finding
  substantiel documenté dans ADR-005** : `npm run package`
  (`vsce package --no-dependencies`) produit un VSIX de **9.81 Ko sans zod du
  tout** — `--no-dependencies` + `.vscodeignore` (`node_modules/**`)
  l'excluent tous deux. Ça ne casse rien aujourd'hui car aucun point
  d'activation n'importe encore `profile.schema.ts`, mais l'extension
  plantera à l'activation (`Cannot find module 'zod'`) dès qu'une PR câblera
  le chargement de `profiles.json`. À corriger avant cette PR-là (bundler
  esbuild, déjà en devDependency mais non câblé, ou retirer
  `--no-dependencies`).
- (5) ADR-004 : phrase ajoutée — ni `inbox/` ni `inbox/archive/` n'ont de
  borne de rétention/taille en 0.1, renvoi à ADR-007 si le volume le
  justifie.

**Corrections appliquées** (commit `docs(adr): review fixes`) : ADR-004,
ADR-005, JSDoc `isRemoteProfile`.

**Incident de process** : conflit de rebase sur
`vscode-extension/package.json`/`package-lock.json` (doublon
`@vitest/coverage-v8` + `esbuild` 0.24.0 vs 0.28.2 de `main` après le merge
Dependabot #14). Résolu en gardant `esbuild ^0.28.2` + `npm install`. Le
`git push --force-with-lease` a été **refusé par le hook de sécurité Grimoire
du poste** (règle interne « destructive mutation requiert le profil de risque
strict », projet en profil `light`) — aucun moyen non-interactif de
l'autoriser. Rejoué proprement : reset non destructif vers le commit
pré-rebase, puis **`git merge origin/main`** (non destructif, historique
préservé) au lieu du rebase, conflit résolu de façon identique, push normal
(fast-forward, sans force). Mêmes fichiers finaux, même contenu, historique
non réécrit. Ce contournement (merge au lieu de rebase forcé) a été répété
identiquement sur #16 et #17.

**Comptes** : lint 0 issue · typecheck OK · test:unit 15/15.
**CI** : 9/9 checks verts.

## PR #16 — ADR-006..011 + `docs/adr/README.md`

**Verdict : GO, mergé.** SHA squash `2f0cf3b6e6015cec2e1a72d848ca6032b9d0ac25`.

- `docs/adr/README.md` réécrit : les 11 ADR listés avec titres H1 exacts et
  noms de fichiers corrects (les liens ADR-002/004/005 pointaient vers des
  noms erronés d'une version antérieure, ex. `ADR-002-synchronization.md` au
  lieu de `ADR-002-synchronization-highlight.md`) ; suppression de la mention
  « en cours » désormais fausse.
- Contrôle rapide ADR-006..011 vs `decisions-cadrage-v1.md` (D1-D12) : chaque
  ADR cite correctement sa/ses décision(s) source (D8 pour 007/008, D9/D11
  pour 009, D10 pour 010, D12 pour 011 ; D6 référencé en interne par 006).
  **Aucune contradiction relevée.**
- Rebase : même conflit trivial de doublon `@vitest/coverage-v8` que #18,
  résolu identiquement, rejoué en merge (même blocage du hook force-push).

**Comptes** : n/a (PR docs-only, pas de code source touché).
**CI** : 9/9 checks verts.

## PR #17 — fakes/fixtures/mocks (36 tests d'origine)

**Verdict : GO, mergé.** SHA squash `de77bb03e777b34e39a6c5ba4619dbc6f2b057e5`.

- `test/fakes/contracts.ts` supprimé, remplacé par des imports directs depuis
  `src/core` (désormais sur `main`). Adaptations aux noms réels : `Voice.label`
  (pas `.name`), `AudioResult` ({format, data: Uint8Array, durationMs,
  sampleRate, channels} au lieu d'une `data:` URI), `AudioFrame`
  (chunkId/sequence/format/sampleRate/channels), `TtsCapabilities`
  (voices/parameters/formats/languages requis), `ProviderHealth`
  ({providerId, status, checkedAt}), `NarrationRequest.segments`
  (`SourceSegment[]`, `rawText`/`spokenText?`), `NarratorProvider.transform()`
  qui résout un `NarrationResult` et jamais un tableau brut.
- **Bug de contrat corrigé** dans `FakeNarratorProvider` : la version
  d'origine levait une `SyntaxError` pour `invalidJsonOnce` et rejetait en
  `AbortError` sur annulation. Le contrat réel (JSDoc `NarratorProvider
  .transform` + ADR-005 : « transform renvoie `degraded: true` ... pour JSON
  invalide ... annulation ») exige de toujours **résoudre**, jamais rejeter.
  Corrigé (fallback fidèle dégradé, `degradedReason: "invalid-structured-
  output"`/`"cancelled"`) ; tests mis à jour, +1 cas (abandon pendant la
  latence).
  Ajouté `test/fakes/async-utils.ts` (delay/throwIfAborted, hors `src/core`
  car pas des contrats de domaine).
- `claude-capture.concurrency.test.ts` : vérifié — spawn réel de
  `integrations/claude-code/plugin/scripts/llm-voice-capture.js` (10 appels
  concurrents), contrôle 0600 sur chaque fichier inbox et absence de `.tmp`.
  Test vert.

**Comptes** : lint 0 issue · typecheck OK · test:unit **45/45** (9 fichiers).
**CI** : 9/9 checks verts.

## État final

- `main` : dernier push CI vert (CI + CodeQL, run `34262924118`/`34262923919`,
  déclenchés par le merge de #17).
- `git log --oneline origin/main -6` :
  ```
  de77bb0 test: fake providers, WAV generator, Claude fixtures, mock HTTP servers (#17)
  2f0cf3b docs(adr): ADR-006..011 from validated decisions (#16)
  2c1f19e docs(adr): ADR-001..005 and core type contracts (#18)
  f1ca06e chore(deps): Bump esbuild (#14)
  fb921fe docs(grimoire): phase 1 evidence pack and decision log (#15)
  17fbf8e fix(ci): update @vscode/test-electron and @vscode/test-cli (#13)
  ```
- Total tests unitaires sur `main` : **45** (9 fichiers de test).

## Point de vigilance reporté (non bloquant, documenté dans ADR-005)

Packaging VSIX : `zod` (dépendance de production) est actuellement absent du
paquet (`--no-dependencies` + `.vscodeignore`) ; latent jusqu'à ce qu'une
future PR câble `profile.schema.ts` dans `extension.ts`. À corriger avant
cette PR-là (bundling esbuild ou retrait de `--no-dependencies`).
