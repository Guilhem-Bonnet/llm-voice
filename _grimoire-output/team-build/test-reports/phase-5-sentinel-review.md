# Phase 5 — Revue Sentinel + Merge Flow — Rapport détaillé

Worktree : `/tmp/claude-1000/-mnt-Travail-Projets-Dev-TTS-Voice/389c7bfc-f6bb-4fe0-8f7c-a67d861aaed1/scratchpad/wt/review`
Repo : `Guilhem-Bonnet/llm-voice`

## PR #33 — inbox Claude Code (feat/s5-1-claude-inbox)

**Verdict : Approve avec correctif de sécurité poussé.** SHA merge : `60b31b6`.

- (a) Invariant P0 `test/unit/invariants/no-autoplay.test.ts` couvre `src/claude/**`. Mutation-testé en direct : import réel de `PlaybackController` ajouté dans `src/claude/__mutation_test.ts` → échec confirmé (`expected [] received [1 file]`) → fichier retiré, suite repassée verte. Preuve réelle, pas supposition.
- (b) AC-12..15 présents et verts dans `test/integration/inbox.test.ts` (xvfb).
- (c) AC-SEC-04 (10 concurrents) : `test/unit/claude-capture.concurrency.test.ts` + AC-14 intégration, verts.
  AC-SEC-06 (`addHookEntry`/`removeHookEntry`) : idempotent, préserve les hooks tiers et les autres clés (`hookEntry.ts`), `.bak` écrit avant réécriture (`hookInstallerIO.ts`, `writeAtomicWithBackup`). Conforme.
  **AC-SEC-03 (path traversal) — FAIL confirmé par PoC réel, corrigé.** `sessionId` (issu de `--session-id` CLI dans `integrations/cli/llm-voice-inbox.js`, ou du payload de hook `session_id` non fiable dans `integrations/claude-code/plugin/scripts/llm-voice-capture.js`) était injecté tel quel dans `<capturedAt>-<sessionId>-<rand>.json`. PoC : `--session-id "/../../pwned_marker"` a fait écrire un fichier hors du répertoire inbox cible (`path.join` traverse via les segments `..`). Corrigé par allowlist `/^[A-Za-z0-9_-]{1,128}$/` avec repli sur un UUID aléatoire dans les deux scripts, + test de non-régression dans chacun (`llm-voice-inbox-cli.test.ts`, `claude-code-capture.test.ts`). Commit du correctif : `083f652`.
- (d) Grep exhaustif : `installClaudeHook`/`uninstallClaudeHook` (qui écrivent dans `~/.claude/settings.json` via `os.homedir()`) ne sont jamais exécutées via `executeCommand` dans la suite de tests — seule leur *registration* est vérifiée (`extension.test.ts`). `hookInstallerIO.test.ts` n'utilise que des `mkdtemp`.
- (e) `resolveInboxPath.ts` : réglage `llmVoice.claude.inboxPath` > `LLM_VOICE_INBOX` > `~/.llm-voice/inbox/`, conforme à ADR-004. Accepté.

Après correctif : lint ✅ typecheck ✅ 423/423 unit ✅ 18/18 integration (xvfb) ✅. CI GitHub 9/9 verte avant merge (`--admin --squash --delete-branch`).

## PR #32 — profils/status/secrets (feat/s5-2-profiles-status, merge de main)

**Verdict : Approve, merge de main effectué et poussé.** Commit de fusion : `96e0735`. SHA merge PR : `72abd16`.

- (a) `llmVoice.profiles.bySource` en double confirmé (introduit indépendamment par #33 et #32 dans `package.json`, plus une résolution ad-hoc dupliquée `profileIdForSource`/`vscode.workspace.getConfiguration` direct côté #33 dans `Pipeline.ts`). Fusion en une seule définition JSON (schéma typé de #32 : `markdown/text/clipboard/claude-code`, `additionalProperties:false` + défaut `{"claude-code":"llm-summary"}` de #33, conforme CdC §47). Côté résolution : `profileIdForSource` supprimée, `speakLatestClaudeResponse` passe par la même résolution générique que tous les entry points (`startInternal` → `profiles.getSelected(doc.sourceType, bySourceSettings())`). Dead code supprimé au passage : mécanisme `profileOverrideId` (plus aucun appelant) et helper `notWired` (remplacé par les vraies implémentations de #33).
- (b) AC-07 (2 profils → 2 voix distinctes vers `FakeTts`) et AC-17 (clé dans `SecretStorage`, absente de `globalState`) verts en intégration. Redaction via `src/core/redact.ts` câblée dans `Pipeline.log()` (pré-#34).
- (c) `schemas/profile-collection.schema.json` committé (retiré du `.gitignore`, fusionné avec la nouvelle ligne `resources/claude-code/` de #33) + test anti-drift (`z.toJSONSchema` régénéré en mémoire vs fichier committé), présent et vert.
- (d) `providerStatus` sans crash serveur éteint : test dédié « probes providers without crashing even when nothing listens » vert.

Après fusion : lint ✅ typecheck ✅ 450/450 unit ✅ 25/25 integration (xvfb, incluant AC-01..06/AC-07/AC-12..15/AC-17/providerStatus) ✅. CI GitHub 9/9 verte (integration windows-latest, qui échouait avant la fusion, repasse verte). Merge `--admin --squash --delete-branch`.

## PR #34 — erreurs/logger/docs (feat/s5-3-errors-logging-docs, merge de main)

**Verdict : Approve, merge de main effectué et poussé.** Commit de fusion : `c915bdb`. SHA merge PR : `80d020d`.

- (a) Redaction unifiée : `src/core/redact.ts` (#32, substitution de valeurs connues) devient la seule implémentation « valeur littérale ». `Logger` (#34, redaction par nom de champ + troncature) gagne `trackSecret(value)` et applique `redactSecrets` sur chaque ligne assemblée (`Logger.write()`) — couche complémentaire, pas un remplacement. Doublon réel supprimé dans `Pipeline.ts` : `private log()` + import direct de `redactSecrets` + champ `knownSecrets` (de #32) éliminés, remplacés par `this.output.<level>()` partout et `this.output.trackSecret(value)` aux deux points de découverte de clé API. Deux `this.output.appendLine(...)` orphelins (méthode absente du nouveau `Logger`, auraient cassé le typecheck) trouvés et corrigés pendant la fusion. Tests ajoutés (`logger.test.ts`, 3 nouveaux cas pour `trackSecret`).
  Nettoyage induit : `notWired()` (mort, doublon avec #33) et `narratorWarningShown` (superseded par `NotificationGate`) retirés.
- (b) `test/unit/invariants/no-console.test.ts` présent, mutation-testé en direct (ajout réel de `console.log` hors `logger.ts` → échec confirmé → retiré).
- (c) AC-16 vert sur les 4 profils `.vscode-test.mjs` (500 en boucle → 2 retries → Skip, un seul dialogue anti-spam ; Stop sans exception ; serveur éteint → « TTS unavailable » sans crash).
- (d) Gap confirmé : `llmVoice.audio.prefetchChunks` (CdC §32/§48, déclaré depuis #32) n'était câblé nulle part — `PlaybackController` ne recevait que `maxRetries`/`timeoutMs`. Ajout de `Pipeline.audioPrefetchChunks()` passé à la construction de `PlaybackController`. Test dédié créé : nouveau profil `.vscode-test.mjs` `prefetch-chunks-fake-tts` avec `--user-data-dir` pré-semé (`User/settings.json` : `{"llmVoice.audio.prefetchChunks": 0}`, lu une seule fois à l'activation — un `config.update()` en cours de test serait trop tard) + `test/integration-prefetch/prefetch-chunks.test.ts` prouvant qu'un document long (kubernetes-course.md) ne synthétise plus qu'un seul chunk en avance (vs 3 par défaut).
- (e) Mapping « 1er chunk en échec = TTS indisponible » et `readyTimeoutMs` 30s (`DEFAULT_READY_TIMEOUT_MS = 30_000`) : acceptés tels quels, confirmés en intégration (profil `real-provider-unavailable`).

Après fusion : lint ✅ typecheck ✅ 484/484 unit ✅ (couverture 91.67 %, seuil 80 %) 28/28 integration (xvfb, 4 profils) ✅ `npm run package` ✅ (VSIX contient `llm-voice-capture.js`). CI GitHub 9/9 verte. Merge `--admin --squash --delete-branch`.

## Validation finale sur origin/main

Checkout `origin/main` (HEAD = `80d020d`), `npm ci` :

| Étape | Résultat |
|---|---|
| `npm run lint` | ✅ 0 erreur |
| `npm run typecheck` | ✅ 0 erreur |
| `npm run test:unit -- --coverage` | ✅ 484/484 tests, 55/55 fichiers, couverture globale 91.67 % lignes (seuil 80 %) |
| `xvfb-run -a npm run test:integration` | ✅ 28/28 (4 profils : fake-tts 24, real-provider-unavailable 1, chunk-invalid-fake-tts 2, prefetch-chunks-fake-tts 1) |
| `npm run package` | ✅ VSIX généré, 254.45 KB, 16 fichiers |
| `unzip -l llm-voice.vsix \| grep capture` | ✅ `extension/resources/claude-code/plugin/scripts/llm-voice-capture.js` présent |
| `LLM_VOICE_E2E=1 LLM_VOICE_E2E_OLLAMA=1 npm run test:integration-real` | ✅ 5/5 tests, 2/2 fichiers (Chatterbox :8004 réel : synthèse WAV + clone-mode ; Ollama :11434 réel : narrator) |

## AC-12..17 → couverture tests (résumé)

| AC | Test | Statut |
|---|---|---|
| AC-12..15 | `test/integration/inbox.test.ts` | ✅ |
| AC-16 | 4 profils `.vscode-test.mjs` (chunk-invalid + real-provider) | ✅ |
| AC-17 | `test/integration/profiles.test.ts` | ✅ |
| AC-SEC-03 | `llm-voice-inbox-cli.test.ts` + `claude-code-capture.test.ts` (ajoutés) | ✅ (après correctif) |
| AC-SEC-04 | `claude-capture.concurrency.test.ts` + AC-14 | ✅ |
| AC-SEC-05 | `profiles.test.ts` (`importProfileFromJson rejects...`) | ✅ |
| AC-SEC-06 | `hookEntry.test.ts`, `hookInstallerIO.test.ts` | ✅ |
| AC-SEC-07/08 | `redact.test.ts`, `logger.test.ts`, AC-17 intégration | ✅ |

## Corrections apportées (au-delà d'une simple résolution de conflit)

1. **Sécurité (PR #33)** : path traversal AC-SEC-03 dans `llm-voice-capture.js`/`llm-voice-inbox.js` — vulnérabilité confirmée par PoC réel (écriture de fichier hors répertoire inbox), corrigée par allowlist stricte sur `sessionId`.
2. **Déduplication (PR #32×#33)** : setting + résolution `llmVoice.profiles.bySource` fusionnés en une seule définition/implémentation ; dead code (`profileOverrideId`, `notWired` ×2, `narratorWarningShown`) supprimé.
3. **Unification redaction (PR #32×#34)** : `core/redact.ts` (valeurs) + `infrastructure/logger.ts` (champs) combinés dans `Logger.trackSecret()` ; ancien `Pipeline.log()`/`redactSecrets` dupliqué supprimé ; 2 appels `appendLine` orphelins (auraient cassé le build) corrigés.
4. **Gap fonctionnel (PR #34)** : `llmVoice.audio.prefetchChunks` câblé dans `PlaybackController`, avec test d'intégration dédié (nouveau profil `.vscode-test.mjs`).

Aucune alerte CI/CodeQL bloquante rencontrée nécessitant plus d'une tentative — tous les correctifs ci-dessus sont issus de la revue Sentinel elle-même, pas de retries sur échec CI.
