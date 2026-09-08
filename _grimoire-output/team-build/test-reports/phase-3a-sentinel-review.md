# Revues Sentinel phase 3a (PR #20-#23) — extraites des commentaires GitHub le 2026-09-08

## PR #20 — feat(net): EgressGuard and verifyLocalMode (ADR-010)
## Revue Sentinel — PR #20 EgressGuard

**Verdict : approuvé, corrections appliquées en fixup (16e3c4c).**

- (a) Test ajouté : mode `open` autorise un hôte remote non listé (`assertAllowed` résout sans lever), mais `strictLocal` refuse toujours ce même hôte (`reason: "strict-local-mode"`), quel que soit `mode`.
- (b) Doublon de type résolu : `src/core/health.ts` contenait un contrat `EgressGuard`/`EgressDecision` issu du sketch ADR-005 (retour discriminé `check()` → `EgressDecision`), incompatible avec le contrat réellement implémenté dans `src/net/EgressGuard.ts` (`assertAllowed` qui lève `EgressDeniedError`, `fetch(input, init)`, `classify`). Aucun consommateur n'utilisait le contrat `core` (vérifié par grep sur `src/` et `test/`) : je l'ai retiré plutôt que d'aliaser deux formes non réconciliables, et laissé un pointeur de doc vers le contrat réel.
- (c) AC-SEC-01 vérifié dans le code et les tests existants :
  - Redirection cross-host refusée même entre deux hôtes loopback (`guardedFetch`, test « refuses a 302 redirect that changes host »).
  - DNS résolu avant toute connexion pour tout hôte lexicalement loopback, avec vérification anti DNS-rebinding sur chaque IP résolue (`assertAllowed`, test « DNS rebinding »).
  - Le logger ne reçoit jamais body/headers/query string (`EgressLogEvent` ne porte que `host/path/method/decision/reason`, test « never logs the request body or headers » vérifie l'absence de `authorization` et du secret dans le payload sérialisé).

Après fix : lint 0 erreur, typecheck clean, `test:unit` 64/64 (dont les 13 tests EgressGuard). CI GitHub tous verts (unit, integration ubuntu/macos/windows, lint, audit, codeql, package).

## PR #23 — feat(parser): markdown parser, sentence splitter, segmenter, normalizer (ADR-006)
## Revue Sentinel — PR #23 parser

**Verdict : approuvé, correction appliquée en fixup (ed00fef).**

- (a) Exécution réelle post-compile vérifiée :
  `npm run compile` puis
  `node -e "require('./out/src/parser/index.js').parseMarkdown('# a\n\nb.').then(r=>console.log(r.length))"`
  → `2` blocks retournés, aucune erreur. `tsc` préserve bien le `import()` dynamique dans `out/src/parser/MarkdownParser.js` (pas de transformation en `require()` cassant l'ESM) : le couple `module`/`moduleResolution` actuel fonctionne, aucune correction nécessaire.
- (b) Les ranges (`text.slice(startOffset, endOffset) === rawSource`) étaient déjà vérifiées sur `short.md` et `kubernetes-course.md` via `expectOffsetsMatchSource`, mais pas sur `pathological.md` (abréviations en milieu de phrase, code inline, URL nue). Test ajouté qui recoupe les deux fixtures.
- (c) Noté : le bundling esbuild des dépendances de prod (`unified`/`remark-*`/`mdast-util-to-string`) dans le VSIX est fait en S3.5, pas dans cette PR.

Après fix : lint 0 erreur, typecheck clean, `test:unit --coverage` 113/113 (dont les 19 tests MarkdownParser), couverture `src/parser` 93.39% stmts/lines. CI GitHub tous verts (unit, integration ubuntu/macos/windows, lint, audit, codeql, package).

## PR #22 — feat(playback): controller state machine, audio queue, cache, session factory (ADR-001/004/005)
## Revue Sentinel — PR #22 playback

**Verdict : approuvé, correction appliquée en fixup (0b3e88b).**

- (a) `AudioCacheStore.put` : déjà documenté idempotent en JSDoc (« calling it with a key that is already stored refreshes the entry's access time and returns the existing URI without rewriting the payload ») et déjà testé (`InMemoryAudioCache › "is idempotent: a second put keeps the original payload and URI"`). Aucun changement nécessaire.
- (b) Backoff des retries et état `buffering` : non modifiés, comme demandé. Deux lignes « Reporté phase 4 » ajoutées à `docs/adr/ADR-005-provider-contracts.md` §Conséquences.
- (c) Invariants CdC vérifiés, tests présents :
  - Jamais deux `synthesize` en vol : `AudioQueue › "never runs two syntheses at once (maxConcurrentTtsJobs = 1, CdC §65)"` et `PlaybackController › "never issues two concurrent syntheses (CdC §65)"`.
  - `stop` annule et vide la synthèse en cours (assertion sur `AbortSignal.aborted`) : `"stop rewinds, aborts the pending synthesis and keeps the cache (CdC §36)"`, `"aborts in-flight and pending jobs on cancelAll (CdC §62)"`.
  - `pause` conserve la position : `"pause keeps the index, the position and the prefetched chunks (CdC §35)"`.

Après fix : lint 0 erreur, typecheck clean, `test:unit --coverage` 129/129, couverture `src/playback` 97.73% stmts / 93.91% branches / 98.76% funcs. CI GitHub tous verts (unit, integration ubuntu/macos/windows, lint, audit, codeql, package).

## PR #21 — feat(ui): panel mini-player webview, highlight, status bar, CodeLens, commands (ADR-001/002/011)
## Revue Sentinel — PR #21 surface VS Code

**Verdict : approuvé, corrections appliquées en fixups (388a032, 8ce939e, 50f8197, c9168a3, 80540d4).**

- (a) ADR-011 : `StatusBar` déplacée de `Left/100` vers `Right/1` (aligné à droite, priorité basse). Ajout de « $(inbox) Ouvrir l'inbox » au Quick Pick du clic, câblé sur `pipeline.openInbox()` (déjà implémenté côté `PipelineFacade`, juste pas atteignable depuis la status bar).
- (b) CSP vérifiée dans `PlayerViewProvider.renderHtml` : `default-src 'none'`, `connect-src 'none'`, nonce sur `script-src`/`style-src`, pas d'`innerHTML` sur texte non fiable (`player.js` n'utilise que `textContent`). Conforme AC-SEC-02.
  - CodeQL Advanced Security a néanmoins signalé `audio.src = message.src` (`js/xss`, `js/client-side-unvalidated-url-redirection`) : la donnée arrive via `postMessage`, traitée comme externe par l'analyse statique quel que soit le modèle de menace réel. Trois formes de garde par préfixe/allowlist n'ont pas été reconnues comme sanitizer par les requêtes par défaut. Fix retenu : validation structurelle (`new URL()`, protocole `https:` sur hôte `*.vscode-cdn.net`/`vscode-webview` ou `blob:`, assignation de `url.href` uniquement) — les 4 alertes sont passées à `fixed` sur GitHub Code Scanning, aucun dismiss nécessaire.
- (c) Vérifié : `extensionKind: ["ui"]`, `privacy.localOnly` défaut `true`, `telemetryEnabled` défaut `false`, aucune dépendance `@vscode/extension-telemetry`.
- (d) Merge de `main` effectué (fusion propre, aucun conflit) : `xvfb-run -a npm run test:integration` passe 8/8 après merge (l'ancien `test/unit/segmenter.test.ts` supprimé par #23 ne bloque rien, `#21` ne le référence pas).

Après fix final : lint 0 erreur, typecheck clean, `test:unit` 241/241, intégration 8/8. CI GitHub 9/9 verts (unit, integration ubuntu/macos/windows, lint, audit, codeql, package, CodeQL Advanced Security).
