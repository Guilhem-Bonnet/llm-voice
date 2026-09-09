# Traceability Matrix — LLM Voice MVP 0.1.0

> Matrices de traçabilité des Critères d'Acceptation (AC-01..17) et des Critères de Sécurité (AC-SEC-01..10) vers les fichiers de test.
> Date : 2026-09-09 — mise à jour Sentinel (revue #36) après merge #37 (audit sécurité 0.1) et #38 (latence).

---

## AC-01 à AC-17 (CdC §82)

| AC   | Critère | Fichiers de test | Cas de test | Statut |
|------|---------|------------------|------------|--------|
| AC-01 | Sur un fichier Markdown, `LLM Voice: Speak Document` commence une lecture. | `vscode-extension/test/integration/pipeline.test.ts` | `"AC-01: Speak Document starts a session observable as 'playing'"` | Couvert |
| AC-02 | La portion actuellement prononcée est visuellement identifiable. | `vscode-extension/test/integration/pipeline.test.ts` | `"AC-02/AC-03: decoration is posed on the first segment, then moves on 'ended'"` | Couvert |
| AC-03 | Le highlight se déplace lorsque le segment change. | `vscode-extension/test/integration/pipeline.test.ts`, `vscode-extension/test/integration/latency.test.ts` | `"AC-02/AC-03: decoration is posed on the first segment, then moves on 'ended'"`, `"the first chunk of a document is shorter than the one that follows it"` (highlight suit le premier chunk raccourci, S6.2) | Couvert |
| AC-04 | Pause suspend l'audio sans perdre la position. | `vscode-extension/test/integration/pipeline.test.ts` | `"AC-04: pause keeps the chunk index and the decoration"` | Couvert |
| AC-05 | Stop arrête immédiatement la lecture et retire le highlight. | `vscode-extension/test/integration/pipeline.test.ts` | `"AC-05: stop clears the decoration"` | Couvert |
| AC-06 | Une sélection peut être lue indépendamment du reste du fichier. | `vscode-extension/test/integration/pipeline.test.ts` | `"AC-06: Speak Selection only reads the selected text"` | Couvert |
| AC-07 | Le profil peut sélectionner une voix différente. | `vscode-extension/test/integration/profiles.test.ts` | `"AC-07: selecting a different profile sends a different voice to the TTS provider"` | Couvert |
| AC-08 | Le profil peut contenir un prompt de narration personnalisé. | `vscode-extension/test/unit/profiles/defaults.test.ts`, `vscode-extension/test/unit/core/profile.schema.test.ts` | Validation de schema profile (prompt inclus) | Couvert |
| AC-09 | Un profil sans narration lit le contenu sans appel LLM. | `vscode-extension/test/unit/narrator/NoNarrator.test.ts` | `"maps segments 1:1 without issuing any request"` | Couvert |
| AC-10 | Un profil avec narration passe par le Narrator configuré. | `vscode-extension/test/unit/narrator/OllamaNarrator.test.ts` | `"transform() maps BLOCK_xxx segments returned by the model (AC-10: real request...)"` | Couvert |
| AC-11 | Configuration complète (VS Code + Ollama + Chatterbox local) fonctionne sans service cloud. | `vscode-extension/test/integration-real/chatterbox-tts.test.ts`, `vscode-extension/test/integration-real/ollama-narrator.test.ts`, `vscode-extension/test/integration-real/latency.test.ts`, `vscode-extension/test/integration-real/tts-unavailable.test.ts` | E2E réel contre Chatterbox (`:8004`) et Ollama (`:11434`), `npm run test:integration-real` avec `LLM_VOICE_E2E=1 LLM_VOICE_E2E_OLLAMA=1` — gated (self-skip sans les variables d'env), mais automatisé, pas manuel | Couvert |
| AC-12 | Un hook Claude Code peut ajouter une réponse à l'Inbox. | `vscode-extension/test/integration/inbox.test.ts` | `"AC-12: depositing a file makes it appear in a fresh inbox scan"` | Couvert |
| AC-13 | Ajouter une réponse Claude à l'Inbox ne produit **aucun son**. | `vscode-extension/test/integration/inbox.test.ts` | `"AC-13: 4 concurrent deposits -> 4 entries, 0 additional TTS calls"` | Couvert |
| AC-14 | Quatre Claude Code terminant simultanément créent quatre entrées sans déclencher de lecture. | `vscode-extension/test/integration/inbox.test.ts` | `"AC-14: 10 concurrent deposits -> 10 entries, 0 additional TTS calls"` | Couvert |
| AC-15 | Une réponse de l'Inbox peut être lue avec n'importe quel profil. | `vscode-extension/test/integration/inbox.test.ts` | `"AC-15: speakLatestClaudeResponse starts the pipeline with the source's default profile"` | Couvert |
| AC-16 | L'indisponibilité d'Ollama ou Chatterbox est signalée proprement sans crash VS Code. | `vscode-extension/test/integration-chunk-invalid/chunk-invalid.test.ts`, `vscode-extension/test/integration-real/tts-unavailable.test.ts` | `"Chunk TTS invalide (S5.3, AC-16, CdC §52)"`, `"Speak Document surfaces a clean error"` | Couvert |
| AC-17 | Les clés éventuelles de providers distants sont stockées dans `SecretStorage`. | `vscode-extension/test/integration/profiles.test.ts`, `vscode-extension/test/integration-security/webview-csp.test.ts` | `"AC-17/AC-SEC-08: a provider API key is stored in SecretStorage, never in globalState"`, `"a foreign apiKeyRef is ignored, not resolved"` | Couvert |

---

## AC-SEC-01 à AC-SEC-10 (Revue sécurité §3, audit 0.1 — `docs/security/audit-0.1.md`)

| AC-SEC | Critère | Fichiers de test | Cas de test | Statut |
|--------|---------|------------------|------------|--------|
| AC-SEC-01 | Quand `localOnly=true`, toute tentative HTTP vers un host non-loopback est bloquée avant émission, y compris après redirection et rebinding DNS. | `vscode-extension/test/unit/net/EgressGuard.test.ts`, `vscode-extension/test/unit/security/egress-bypass.test.ts` | `"refuses a hostname that looks local but resolves off loopback (DNS rebinding)"`, `"connects to the validated address, never to the name a second time"` (F-02, TOCTOU), `"denies them in open mode too"` (F-04, schémas non-HTTP), userinfo/IPv4 décimale-octale-hexa, `::ffff:`, `0.0.0.0`, redirections croisées | Couvert |
| AC-SEC-02 | Le contenu inséré dans la Webview (spokenText, résumés) est rendu sans exécution possible de script (CSP + nonce, pas de `innerHTML`). | `vscode-extension/test/unit/security/webview-injection.test.ts`, `vscode-extension/test/integration-security/webview-csp.test.ts` | `player.js` réel exécuté contre un DOM minimal avec 10 charges hostiles (script, `onerror`, `javascript:`, RLO…) — tout finit en `textContent` ; `"serves a strict CSP with a per-render nonce"` (webview réelle, nonce non prévisible, F-10) ; `"a hostile inbox message never reaches the document"` | Couvert |
| AC-SEC-03 | Un `sessionId`/nom de fichier Inbox contenant traversée de chemin (`../`, chemins absolus, contrôle) est rejeté ou neutralisé. | `vscode-extension/test/unit/security/path-traversal.test.ts`, `vscode-extension/test/unit/claude-code-capture.test.ts`, `vscode-extension/test/unit/claude/llm-voice-inbox-cli.test.ts` | 16 formes hostiles (`..`, absolu POSIX/Windows, UNC, `%2f`, NUL, RLO, zero-width, solidus pleine largeur, 4096 caractères) contre `sessionId` (collecteur **et** CLI), ids d'inbox, `remove()`/`archive()` ; symlink réel hors de l'inbox (F-09) | Couvert |
| AC-SEC-04 | 10 écritures Inbox concurrentes produisent 10 fichiers JSON valides et distincts. | `vscode-extension/test/integration/inbox.test.ts` | `"AC-14: 10 concurrent deposits -> 10 entries, 0 additional TTS calls"` | Couvert |
| AC-SEC-05 | L'import d'un profil est validé contre schéma JSON strict ; profil avec `baseUrl` hors allowlist déclenche "☁ Remote provider" ; un profil importé ne peut ni exfiltrer une clé d'un autre provider (F-01) ni faire lire un fichier non-audio comme référence vocale (F-03). | `vscode-extension/test/integration/profiles.test.ts`, `vscode-extension/test/unit/profiles/defaults.test.ts`, `vscode-extension/test/unit/profiles/profileQuickPick.test.ts`, `vscode-extension/test/unit/security/path-traversal.test.ts`, `vscode-extension/test/integration-security/webview-csp.test.ts` | `"importProfileFromJson rejects a profile that fails VoiceProfileSchema (AC-SEC-05)"`, `"a foreign apiKeyRef is ignored, not resolved"` (F-01, vérifie `Pipeline.resolveApiKey` directement, pas seulement `SecretStorage`), `"a profile pointing referenceAudio at a non-audio file is rejected at import"` (F-03) | Couvert |
| AC-SEC-06 | Installation du hook Claude Code ne modifie que l'entrée LLM Voice, préserve hooks tiers, désinstallation restaure l'état, et résiste à un `settings.json` malformé. | `vscode-extension/test/unit/claude/hookInstallerIO.test.ts`, `vscode-extension/test/unit/security/hook-robustness.test.ts` | Install/uninstall (diff JSON), modes `0600` ; 10 `settings.json` malformés × 3 opérations (F-05/F-06), collecteur avec charge 50 Mo, binaire, surrogate isolé, BOM, JSON invalide, inbox non créable, échec d'écriture (F-13), toujours `exit 0` | Couvert |
| AC-SEC-07 | Aucune clé API, contenu intégral de document, réponse Claude intégrale ou audio n'apparaît dans l'Output Channel. | `vscode-extension/test/unit/infrastructure/logger.test.ts`, `vscode-extension/test/unit/core/redact.test.ts`, `vscode-extension/test/unit/security/secret-redaction.test.ts` | `"redact (CdC §81, AC-SEC-07)"`, `"redactSecrets (AC-SEC-07/08)"`, clé dans URL/en-tête/message d'erreur provider/exception non gérée (F-07/F-08), niveau `debug`, absence de clé dans `globalState`/cache disque/sidecars | Couvert |
| AC-SEC-08 | Les clés de providers distants ne sont accessibles qu'via `SecretStorage` ; jamais depuis `globalState`/fichiers en clair ; un profil importé ne peut résoudre que la clé de son propre provider. | `vscode-extension/test/integration/profiles.test.ts`, `vscode-extension/test/unit/profiles/remoteProviders.test.ts`, `vscode-extension/test/integration-security/webview-csp.test.ts` | `"AC-17/AC-SEC-08: a provider API key is stored in SecretStorage"`, `"places the SecretStorage key under llmVoice.apiKey.* (AC-17, AC-SEC-08)"`, `"a foreign apiKeyRef is ignored, not resolved"` (F-01) | Couvert |
| AC-SEC-09 | Fichiers/dossiers Inbox et cache créés avec permissions restreintes au compte utilisateur (0600/0700 POSIX ; Windows hors garantie, cf. Notes). | `vscode-extension/test/unit/security/supply-chain-and-permissions.test.ts` | Inbox `0700` / fichiers `0600` après écriture réelle, resserrement d'un dossier laissé en `0755`, `archive/` en `0700` | Couvert |
| AC-SEC-10 | Le build CI échoue si `npm audit` détecte une vulnérabilité "high" ou supérieure sur les dépendances de production ; le contenu du VSIX et les licences de production sont vérifiés. | `.github/workflows/ci.yml` (job `audit`, ligne ~35 ; job `package`, `check:vsix`/`check:licenses`), `vscode-extension/test/unit/security/supply-chain-and-permissions.test.ts` | Job `audit` : `npm audit --omit=dev --audit-level=high` ; job `package` : `npm run check:vsix` (aucun test/source/map/secret dans le VSIX) et `npm run check:licenses` (74 dépendances de prod, toutes permissives) — les deux gates ajoutés à la CI en revue de #37 | Couvert |

---

## Tests de performance (S6.2, `docs/performance.md`)

| Sujet | Fichiers de test | Cas de test |
|---|---|---|
| Premier chunk raccourci (`llmVoice.audio.firstChunkSentences`) | `vscode-extension/test/unit/parser/Segmenter.test.ts`, `vscode-extension/test/integration/latency.test.ts`, `vscode-extension/test/integration-real/latency.test.ts` | 6 cas `firstChunkSentences` (borne au premier groupe, no-op inter-blocs, no-op en mode `block`), `"the first chunk of a document is shorter than the one that follows it"` |
| `warmup` (`llmVoice.tts.warmup`) | `vscode-extension/test/unit/tts/warmup.test.ts` | `health()` puis synthèse courte, ne lève jamais, silencieux/désactivable |
| Cache disque — restauration `durationMs`/`format` sur cache hit | `vscode-extension/test/unit/playback/disk-audio-cache.test.ts`, `vscode-extension/test/unit/playback/audio-queue.test.ts` | `getMeta`, merge de métadonnées sur re-pin |
| Compteurs de session (`LLM Voice: Show Performance Report`) | `vscode-extension/test/unit/playback/performance-stats.test.ts` | TTFA, RTF, cache hit/miss |
| Benchmark contre serveur réel | `scripts/bench-tts.mjs` (hors suite automatisée, `npm run` manuel documenté) | TTFA/RTF par taille de chunk, rejoué en revue #38 contre Chatterbox `:8004` — même ordre de grandeur que `docs/performance.md` |

---

## Résumé

- **AC entièrement couverts** : AC-01 à AC-17 (17/17)
- **AC-SEC entièrement couverts** : AC-SEC-01 à AC-SEC-10 (10/10)
- **AC partiellement couverts** : aucun
- **AC non couverts** : aucun

## Notes

1. **AC-11** : e2e réel gated par variables d'environnement (`LLM_VOICE_E2E`, `LLM_VOICE_E2E_OLLAMA`), non exécuté en CI (pas de GPU/Ollama sur les runners) mais automatisé et rejoué en revue avant chaque release — pas un test manuel.
2. **AC-SEC-09** : Windows n'a pas d'ACL posée sur l'inbox (seule l'ACL du profil utilisateur protège) — documenté dans `SECURITY.md`, suivi pour 0.2.
3. **AC-SEC-10** : `check:vsix`/`check:licenses` existaient depuis #37 mais n'étaient pas invoqués en CI ; câblés dans le job `package` en revue de #37 (commit `e1da1af`).
4. Tous les correctifs de l'audit sécurité 0.1 (F-01 à F-14, `docs/security/audit-0.1.md`) sont verrouillés par au moins un test d'attaque qui échoue si le correctif est retiré ; F-01, F-02 et F-04 ont été mutation-testés en revue de #37 (retrait du correctif → test rouge, restauration → vert).

Voir `scripts/check-traceability.mjs` pour vérification automatisée (référencé par `npm run check:traceability`, job `lint` de la CI).
