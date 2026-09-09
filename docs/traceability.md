# Traceability Matrix — LLM Voice MVP 0.1.0

> Matrices de traçabilité des Critères d'Acceptation (AC-01..17) et des Critères de Sécurité (AC-SEC-01..10) vers les fichiers de test.
> Date : 2026-09-09

---

## AC-01 à AC-17 (CdC §82)

| AC   | Critère | Fichiers de test | Cas de test | Statut |
|------|---------|------------------|------------|--------|
| AC-01 | Sur un fichier Markdown, `LLM Voice: Speak Document` commence une lecture. | `vscode-extension/test/integration/pipeline.test.ts` | `"AC-01: Speak Document starts a session observable as 'playing'"` | Couvert |
| AC-02 | La portion actuellement prononcée est visuellement identifiable. | `vscode-extension/test/integration/pipeline.test.ts` | `"AC-02/AC-03: decoration is posed on the first segment, then moves on 'ended'"` | Couvert |
| AC-03 | Le highlight se déplace lorsque le segment change. | `vscode-extension/test/integration/pipeline.test.ts` | `"AC-02/AC-03: decoration is posed on the first segment, then moves on 'ended'"` | Couvert |
| AC-04 | Pause suspend l'audio sans perdre la position. | `vscode-extension/test/integration/pipeline.test.ts` | `"AC-04: pause keeps the chunk index and the decoration"` | Couvert |
| AC-05 | Stop arrête immédiatement la lecture et retire le highlight. | `vscode-extension/test/integration/pipeline.test.ts` | `"AC-05: stop clears the decoration"` | Couvert |
| AC-06 | Une sélection peut être lue indépendamment du reste du fichier. | `vscode-extension/test/integration/pipeline.test.ts` | `"AC-06: Speak Selection only reads the selected text"` | Couvert |
| AC-07 | Le profil peut sélectionner une voix différente. | `vscode-extension/test/integration/profiles.test.ts` | `"AC-07: selecting a different profile sends a different voice to the TTS provider"` | Couvert |
| AC-08 | Le profil peut contenir un prompt de narration personnalisé. | `vscode-extension/test/unit/profiles/defaults.test.ts`, `vscode-extension/test/unit/core/profile.schema.test.ts` | Validation de schema profile (prompt inclus) | Couvert |
| AC-09 | Un profil sans narration lit le contenu sans appel LLM. | `vscode-extension/test/unit/narrator/NoNarrator.test.ts` | `"maps segments 1:1 without issuing any request"` | Couvert |
| AC-10 | Un profil avec narration passe par le Narrator configuré. | `vscode-extension/test/unit/narrator/OllamaNarrator.test.ts` | `"transform() maps BLOCK_xxx segments returned by the model (AC-10: real request...)"` | Couvert |
| AC-11 | Configuration complète (VS Code + Ollama + Chatterbox local) fonctionne sans service cloud. | Pas de test explicite : c'est une exigence d'intégration manuelle | N/A | Non couvert |
| AC-12 | Un hook Claude Code peut ajouter une réponse à l'Inbox. | `vscode-extension/test/integration/inbox.test.ts` | `"AC-12: depositing a file makes it appear in a fresh inbox scan"` | Couvert |
| AC-13 | Ajouter une réponse Claude à l'Inbox ne produit **aucun son**. | `vscode-extension/test/integration/inbox.test.ts` | `"AC-13: 4 concurrent deposits -> 4 entries, 0 additional TTS calls"` | Couvert |
| AC-14 | Quatre Claude Code terminant simultanément créent quatre entrées sans déclencher de lecture. | `vscode-extension/test/integration/inbox.test.ts` | `"AC-14: 10 concurrent deposits -> 10 entries, 0 additional TTS calls"` | Couvert |
| AC-15 | Une réponse de l'Inbox peut être lue avec n'importe quel profil. | `vscode-extension/test/integration/inbox.test.ts` | `"AC-15: speakLatestClaudeResponse starts the pipeline with the source's default profile"` | Couvert |
| AC-16 | L'indisponibilité d'Ollama ou Chatterbox est signalée proprement sans crash VS Code. | `vscode-extension/test/integration-chunk-invalid/chunk-invalid.test.ts`, `vscode-extension/test/integration-real/tts-unavailable.test.ts` | `"Chunk TTS invalide (S5.3, AC-16, CdC §52)"`, `"Speak Document surfaces a clean error"` | Couvert |
| AC-17 | Les clés éventuelles de providers distants sont stockées dans `SecretStorage`. | `vscode-extension/test/integration/profiles.test.ts` | `"AC-17/AC-SEC-08: a provider API key is stored in SecretStorage, never in globalState"` | Couvert |

---

## AC-SEC-01 à AC-SEC-10 (Revue sécurité §3)

| AC-SEC | Critère | Fichiers de test | Cas de test | Statut |
|--------|---------|------------------|------------|--------|
| AC-SEC-01 | Quand `localOnly=true`, toute tentative HTTP vers un host non-loopback est bloquée avant émission, y compris après redirection. | `vscode-extension/test/unit/net/EgressGuard.test.ts` | `"allows loopback destinations in local mode"`, `"refuses a plain remote host in local mode"`, `"refuses a hostname that looks local but resolves off loopback (DNS rebinding)"`, `"never trusts a hostname merely containing 'localhost'"`, `"refuses a 302 redirect that changes host"` | Couvert |
| AC-SEC-02 | Le contenu inséré dans la Webview (spokenText, résumés) est rendu sans exécution possible de script (CSP + nonce, pas de `innerHTML`). | Pas de test explicite trouvé | N/A | Non couvert |
| AC-SEC-03 | Un `sessionId`/nom de fichier Inbox contenant traversée de chemin (`../`, chemins absolus, contrôle) est rejeté ou neutralisé. | `vscode-extension/test/unit/claude-code-capture.test.ts`, `vscode-extension/test/unit/claude/llm-voice-inbox-cli.test.ts` | Commentaires : `"AC-SEC-03: session_id comes straight from the hook payload (untrusted)"` | Partiel |
| AC-SEC-04 | 10 écritures Inbox concurrentes produisent 10 fichiers JSON valides et distincts. | `vscode-extension/test/integration/inbox.test.ts` | `"AC-14: 10 concurrent deposits -> 10 entries, 0 additional TTS calls"` | Couvert |
| AC-SEC-05 | L'import d'un profil est validé contre schéma JSON strict ; profil avec `baseUrl` hors allowlist déclenche "☁ Remote provider". | `vscode-extension/test/integration/profiles.test.ts`, `vscode-extension/test/unit/profiles/defaults.test.ts`, `vscode-extension/test/unit/profiles/profileQuickPick.test.ts` | `"importProfileFromJson rejects a profile that fails VoiceProfileSchema (AC-SEC-05)"`, `"validates as a whole ProfileCollection (AC-SEC-05)"`, `"badges a remote profile with $(cloud) (AC-SEC-05)"` | Couvert |
| AC-SEC-06 | Installation du hook Claude Code ne modifie que l'entrée LLM Voice, préserve hooks tiers, désinstallation restaure l'état. | `vscode-extension/test/unit/claude/hookInstallerIO.test.ts` | Logique d'installation/désinstallation | Partiel |
| AC-SEC-07 | Aucune clé API, contenu intégral de document, réponse Claude intégrale ou audio n'apparaît dans l'Output Channel. | `vscode-extension/test/unit/infrastructure/logger.test.ts`, `vscode-extension/test/unit/core/redact.test.ts` | `"redact (CdC §81, AC-SEC-07)"`, `"redactSecrets (AC-SEC-07/08)"` | Couvert |
| AC-SEC-08 | Les clés de providers distants ne sont accessibles qu'via `SecretStorage` ; jamais depuis `globalState`/fichiers en clair. | `vscode-extension/test/integration/profiles.test.ts`, `vscode-extension/test/unit/profiles/remoteProviders.test.ts` | `"AC-17/AC-SEC-08: a provider API key is stored in SecretStorage"`, `"places the SecretStorage key under llmVoice.apiKey.* (AC-17, AC-SEC-08)"` | Couvert |
| AC-SEC-09 | Fichiers/dossiers Inbox et cache créés avec permissions restreintes au compte utilisateur (0600/0700 POSIX, ACL Windows). | Pas de test explicite trouvé | N/A | Non couvert |
| AC-SEC-10 | Le build CI échoue si `npm audit` détecte une vulnérabilité "high" ou supérieure. | `.github/workflows/ci.yml` (job `lint` ou `audit`) | CI gate sur `npm audit` | Non couvert (CI config) |

---

## Résumé

- **AC entièrement couverts** : AC-01 à AC-10, AC-12 à AC-17 (15/17)
- **AC partiellement couverts** : AC-SEC-03, AC-SEC-06 (2)
- **AC non couverts** : AC-11, AC-SEC-02, AC-SEC-09, AC-SEC-10 (4)

## Notes

1. **AC-11** (local setup) : Test d'intégration manuelle requise (pas d'automatisation CI/CD simple).
2. **AC-SEC-02** (Webview XSS) : Demande un test E2E avec injection de payloads ; intégration Playwright/vscode-extension-tester à prévoir.
3. **AC-SEC-03** (path traversal) : Couverture partiellement déclarative dans les commentaires de test ; tests unitaires pour validation stricte du `sessionId` requis.
4. **AC-SEC-06** (hook installer) : Logique préservée ; test d'intégration full (install/uninstall, diff JSON) manquant.
5. **AC-SEC-09** (permissions POSIX/Windows) : Pas de test trouvé ; à implémenter avec `fs.stat` (POSIX) et `icacls` (Windows).
6. **AC-SEC-10** (npm audit CI) : À ajouter au job `lint` ou nouveau job `security` en `.github/workflows/ci.yml`.

Voir `scripts/check-traceability.mjs` pour vérification automatisée.
