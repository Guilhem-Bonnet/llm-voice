# Agentic Evidence Pack

## Summary

- Task id: phase-5
- Profile: starter
- Outcome: Inbox Claude Code (dépôt, watcher, Quick Pick, TreeView en mode full, installeur de hook avec consentement, plugin, CLI d'inbox ouvert), gestion des profils (par source, import/export, Test Voice, Provider Status, clés en SecretStorage), gestion d'erreurs CdC §52, journal avec redaction, timeouts, guide utilisateur. AC-12..17 verts ; l'ensemble AC-01..17 est désormais couvert.
- Final state: done

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| PR #33 inbox Claude | merge `60b31b6` | backend-engineer (Sonnet) | GO après correction d'une **traversée de chemin réelle** (PoC confirmé par Sentinel, allowlist sessionId + tests, AC-SEC-03) |
| PR #32 profils/status/secrets | merge `72abd16` | backend-engineer (Sonnet) | GO ; `profiles.bySource` dédupliqué |
| PR #34 erreurs/logger/docs | merge `80d020d` | reliability-engineer (Sonnet) | GO ; redaction unifiée ; 2 appels orphelins corrigés ; `prefetchChunks` câblé |
| Revue | `_grimoire-output/team-build/test-reports/phase-5-sentinel-review.md` | Sentinel (Sonnet) | mutation-tests sur no-autoplay et no-console |

## Validation

| Check | Command or method | Result |
|---|---|---|
| Unit | `npm run test:unit -- --coverage` | 484/484, 91,7 % lignes sur modules purs |
| Intégration xvfb | `npm run test:integration` | 28/28 |
| E2E réel | `LLM_VOICE_E2E=1 LLM_VOICE_E2E_OLLAMA=1 npm run test:integration-real` | 5/5 |
| VSIX | `npm run package` ; contient `llm-voice-capture.js` | OK |
| AC-12..15 | `test/integration/inbox.test.ts` | verts, 0 appel TTS sur 10 dépôts |
| AC-16 | `test/integration-chunk-invalid/` | vert |
| AC-17 | tests secrets : clé absente de `globalState` et des logs | vert |
| Gate | `grimoire standard gate check --task-id phase-5 --strict` | voir sortie |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Traversée de chemin livrée par l'auteur, attrapée par la revue | aucun (corrigée avant merge) | — | audit sécurité Opus en phase 6 sur tout `src/claude` et `src/net` |
| Mapping « premier chunk en échec = TTS indisponible » | UX | concierge | E2E manuel phase 6 |
| `readyTimeoutMs` 30 s par défaut | — | concierge | — |
| Installeur de hook jamais exécuté sur le vrai `~/.claude/settings.json` par les agents | à tester manuellement par l'utilisateur | concierge | phase 6 |

## Completion statement

Phase 5 complète ; AC-01..17 couverts ; écarts documentés.
