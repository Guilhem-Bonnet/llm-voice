# Phase 9 — Revue Sentinel + merge Flow (2026-09-12)

Repo: Guilhem-Bonnet/llm-voice. Worktree: `wt/review` (détaché sur `origin/main`).

## PR #54 — sélection de voix, migration profils, Piper PATH

Verdict : **LGTM, mergée** (squash, `--admin --delete-branch`).
SHA squash sur main : `3710fa0`.

Mutation-tests manuels (retrait ciblé → échec constaté → `git checkout --` restauration) :
- `migrations.ts` (`schemaVersion >= CURRENT` neutralisé) → `rewrites a stale default Chatterbox pin…` échoue. ✓
- `SystemTtsProvider.detectPiper` (repli PATH supprimé) → 2 tests dédiés échouent. ✓
- Priorité Piper/espeak-ng inversée dans `detectLinux` → 2 tests échouent (dont `prefers Piper over espeak-ng`). ✓

(b) Idempotence + choix explicite déjà couverts par tests existants (baseUrl personnalisée = seul signal disponible). (c) Chemin complet "Aucune voix configurée" vérifié en conditions réelles (Chatterbox arrêté, Ollama actif, Piper PATH + `~/.llm-voice/voices/`, espeak-ng) via test ad hoc temporaire (supprimé) : `system` résout `local:piper` (`status: ok`), pas de message affiché. (d) Repli `referenceAudio` : seule l'erreur de lecture locale est avalée, `uploadReferenceBytes` reste fatale sur erreur réseau/HTTP. (e) `schemaVersion` déjà à jour → `migrated:false`, test dédié présent.

CI 9/9, lint/typecheck/934 tests unitaires OK localement.

## PR #55 — vue dédiée barre d'activité (main fusionnée d'abord)

Verdict : **LGTM, mergée**. Merge de `origin/main` (post-#54) → commit `e6f90bf`, poussé sur la branche avant CI. SHA squash sur main : `2fa25b9`.

(a) Ouverture unique réutilise `WALKTHROUGH_SHOWN_KEY`/`globalState`, déjà testé (`shouldOpenWalkthroughOnActivation`, 3 cas) — pas de nouveau flag non testé. (b) `PlayerViewProvider.ts` sans diff : même instance enregistrée sous 2 view id, nonce/CSP intacts (tests `serves a strict CSP…`/`restricts localResourceRoots…` verts en réel). (c) `llmVoice.player` (Panel) reste sans `when`, layout `minimal` intact. (d) Badge : `computeInboxBadge()` pur, testé pour 0/1/7 (0 → `undefined`). (e) `activity-icon.svg` : `fill="none" stroke="currentColor"`, monochrome. (f) `.vscode-test.mjs` : chemins absolus via `fileURLToPath(import.meta.url)`, mêmes profils/env — aucun test affaibli.

CI 9/9, lint/typecheck/942 tests unitaires OK localement.

## Issue #50 (AC-07 flaky) — 10 exécutions consécutives

`xvfb-run -a npm run test:integration` × 10 sur commit `2fa25b9` : **10/10 verts**, exit 0 à chaque run, `AC-07: selecting a different profile sends a different voice to the TTS provider` ✔ à chaque fois, aucun `✗`/`AssertionError` dans les 10 logs. Issue #50 commentée avec le détail des 10 runs et **fermée** (`completed`). Note postée : le rapport original demandait 20 runs, le brief de cette revue en demandait 10 — 10/10 obtenus, pas d'indice de résurgence.

## Validation finale sur `origin/main` (post #54+#55)

- `npm ci` : OK (620 paquets).
- `npm run lint` : OK, 0 issue.
- `npm run typecheck` : OK.
- `npm run test:unit -- --coverage` : **942/942 tests**, couverture lignes 93.68 % (seuil 80 % respecté).
- `xvfb-run -a npm run test:integration` : exit 0, toutes suites passing (63+1+2+1+1+7), 0 failing.
- `npm run package` : OK, `llm-voice.vsix` (24 fichiers, 310.87 KB).
- `node scripts/check-traceability.mjs` (racine repo, pas `vscode-extension/`) : **All checks passed** (27 couverts, 0 partiel, 0 non couvert, 33 fichiers de test référencés).

Aucun tag/release créé. Chatterbox non relancé (resté arrêté tout du long, confirmé par `curl` refusé sur `:8004`).
