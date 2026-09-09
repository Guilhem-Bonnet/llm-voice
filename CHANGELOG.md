# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce
fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et
ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/) à
partir de la version `0.1.0`.

## [0.1.0] - 2026-09-09

**Extension VS Code pour narration vocale locale de documents Markdown et réponses d'agents LLM via TTS local (Chatterbox, Kokoro) et narrateur optionnel (Ollama, llama.cpp).**

Phase 5 complète (S5.1-5.3) : slice vertical câblé, providers TTS réels, narrateur réel, intégration Claude Code, gestion d'erreurs UX, fiabilité et sécurité.

### Added

- **Slice vertical complet** (S3.5) : source → parsing → segmentation → narration (optionnelle) → TTS → lecteur → surlignage synchronisé.
- **Sources** : `MarkdownDocumentSource` (document, curseur, sélection, section), `TextSelectionSource` (tout langage), `ClipboardSource`, `ClaudeCodeSource` (Inbox Claude Code).
- **Parsing Markdown** : unified + remark-parse, MDAST avec positions source, support 15 types de blocs (heading, paragraph, code, list, blockquote, table, image, link, etc.).
- **Segmentation & normalisation** : `SourceSegment`, découpage par phrase ou bloc, normalisation texte parlé.
- **Profils de narration** (CdC §19) : 4 profils par défaut (Lecture fidèle, Professeur technique, Résumé LLM, Révision rapide), stockage `profiles.json`, import/export, par défaut par source.
- **Narration (phase 4)** : `OllamaNarrator` (Ollama `http://localhost:11434`, structured output JSON), `OpenAICompatibleNarrator`, `NoNarrator` (lecture fidèle sans LLM), mode dégradé obligatoire (transform ne jette jamais, fallback lecture fidèle).
- **TTS local (phase 4)** : `ChatterboxProvider` (Chatterbox Multilingual V3, clonage vocal via voice_mode), `KokoroProvider` (léger, 82M params), `OpenAICompatibleTtsProvider` (API générique `/v1/audio/speech`), health check, backoff exponentiel.
- **Playback** : `PlaybackController`, state machine (idle/preparing/playing/paused/stopped/completed/error), play/pause/resume/stop/next/previous, retry avec backoff.
- **Highlight & surlignage** : `HighlightController`, décoration VS Code dynamique au segment courant, auto-scroll sur changement segment.
- **Cache audio** (ADR-004) : `DiskAudioCache`, eviction LRU, clé SHA256 (provider+model+voice+params+text), pinning fenêtre préchargement, purge manuelle.
- **Providers distants** : `EgressGuard` (`local`/`trusted`/`open` mode), blocage HTTP stricte loopback (127.0.0.1, ::1), résistance DNS rebinding, redirection bloquée hors allowlist.
- **Intégration Claude Code** : hook `Stop` → Inbox (`~/.llm-voice/inbox/`), 10 réponses concurrentes → 10 fichiers sans collision, aucun autoplay, `speakLatestClaudeResponse` manuel.
- **Gestion d'erreurs UX** (CdC §52) : TTS indisponible (Retry/Open settings), Narrator indisponible (Retry/No narration/Cancel), chunk invalide (Skip/Stop), timeout configurable.
- **Résilience & timeouts** : `llmVoice.tts.timeoutMs`, `llmVoice.narrator.timeoutMs` (défaut 60s), `llmVoice.tts.readyTimeoutMs` (défaut 30s), attente statut "Loading".
- **Logger & telemetry** (CdC §81, AC-SEC-07) : Output Channel "LLM Voice", niveaux error/warn/info/debug, redaction pure (supprime apiKey, authorization, text, prompt, corps HTTP), test statique interdisant console.* ailleurs dans src/.
- **Profils : stockage sécurisé** : `ProfileRepository`, JSON Schema validation (Zod), `contributes.jsonValidation` pour VS Code intellisense.
- **SecretStorage** (AC-17, AC-SEC-08) : clés API cloud (OpenAI, etc.) chiffrées, jamais en clair dans globalState.
- **Commandes** : `Speak Document`, `Speak Selection`, `Speak From Cursor`, `Speak Clipboard`, `Play`, `Pause`, `Stop`, `Next`, `Previous`, `Select Profile`, `Open Profiles`, `Open Inbox`, `Speak Latest Claude Response`, `Clear Audio Cache`, `Verify Local Mode`, `Test Voice`, `Provider Status`.
- **Settings VS Code** : `llmVoice.defaultProfile`, `llmVoice.tts.baseUrl`, `llmVoice.tts.provider`, `llmVoice.narrator.provider`, `llmVoice.narrator.baseUrl`, `llmVoice.narrator.model`, `llmVoice.audio.prefetchChunks`, `llmVoice.audio.maxRetries`, `llmVoice.highlight.enabled`, `llmVoice.cache.enabled`, `llmVoice.cache.maxSizeMb`, `llmVoice.log.level`, `llmVoice.tts.readyTimeoutMs`, `llmVoice.tts.timeoutMs`, `llmVoice.narrator.timeoutMs`, `llmVoice.privacy.localOnly`, `llmVoice.claude.inboxPath`, `llmVoice.claude.captureEnabled`.
- **Documentation** : `docs/user-guide.md`, `docs/install-linux.md`, `docs/providers.md`, `docs/adr/` (11 ADRs), `README.md` refondu, `docs/privacy.md`, `docs/traceability.md`.
- **Tests** : suite complète (unit, intégration, E2E), FakeTtsProvider & FakeAudioSink, fixtures Markdown, tous les ACs testés (AC-01..17, AC-SEC-01..10).
- **CI/CD** : `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, packaging VSIX (`vsce package`), CodeQL, Dependabot.
- **Invariants** : zéro autoplay, local-first par défaut, mode local vérifiable (`Verify Local Mode`), provider agnostic.

### Fixed

- VSIX bundling : `esbuild` inline dépendances production (zod, unified, remark-*) dans `dist/extension.js` pour éviter erreurs "module not found" à l'activation.
- EgressGuard : blocage HTTP strict, résistance DNS rebinding, redirection maîtrisée.
- Inbox : concurrence sûre (temp + rename atomique), pas de collision nom (timestamp haute résolution + UUID).
- Logger redaction : aucune clé API, contenu intégral, prompt ou audio dans les logs quelque soit le niveau.

### Security

- **AC-SEC-01** : Blocage HTTP stricte quand `localOnly=true`, pas de sortie hors `127.0.0.0/8`, `::1`, même après redirection (EgressGuard).
- **AC-SEC-03** : Rejet `sessionId` non conforme path traversal, vérification `fs.realpath` sur Inbox/cache.
- **AC-SEC-04** : Écritures Inbox concurrentes sûres (10+ simultanées → 10+ fichiers valides).
- **AC-SEC-05** : Validation JSON Schema strict profils, détection `baseUrl` distante, badge `☁ Remote provider`.
- **AC-SEC-07/08** : Logger redaction, SecretStorage exclusif pour clés API.
- **AC-SEC-09** : Permissions 0600/0700 Inbox/cache (POSIX).
- **AC-SEC-02** : CSP stricte + nonce imprévisible par rendu de la webview ; contenu externe (réponses Inbox, résumés) toujours inséré en `textContent`, jamais interprété comme markup.
- Pas de secrets dans les logs, CSP Webview, aucune télémétrie par défaut.
- **Audit de sécurité 0.1** (S6.1, `docs/security/audit-0.1.md`) : 14 constats identifiés et corrigés avant gel de la release, chacun verrouillé par un test d'attaque dédié — durcissement de la résolution des clés API d'un profil importé (une clé n'est plus utilisable que par le provider auquel elle appartient), fermeture d'une fenêtre de re-résolution DNS entre la vérification d'une adresse locale et la requête réelle, restriction des schémas réseau autorisés, imprévisibilité du nonce de la webview, robustesse du hook Claude Code face à une configuration tierce malformée, et vérification automatisée du contenu exact du paquet publié (aucun test, source ou secret) et des licences des dépendances de production. Détail complet dans le rapport d'audit, sans reproduction d'exploit.

### Performance

- **Latence de lecture** (S6.2, CdC §63, `docs/performance.md`) : le premier segment lu est raccourci (`llmVoice.audio.firstChunkSentences`, défaut 1 phrase) pour réduire le temps avant le premier son sans changer la taille des segments suivants — mesuré à ~4-5 s sur le matériel de référence (GPU local déjà chaud) contre ~30 s pour un paragraphe entier de même contenu. Préchauffage du moteur TTS en tâche de fond (`llmVoice.tts.warmup`, désactivable, jamais de lecture audible ni de requête si le mode local refuse l'hôte). Réutilisation des connexions HTTP (keep-alive) vérifiée sans dépendance ajoutée. Un second passage sur un document déjà lu ne réémet aucune requête TTS (cache disque, restauration correcte de la durée/format sur un succès de cache). Reproductible avec `node scripts/bench-tts.mjs` contre un serveur Chatterbox réel.

---

**Status** : MVP 0.1.0 complet, Linux validé en développement, Windows/macOS non validés manuellement (CI Dependabot en place).

## [Unreleased]

Voir l'historique complet des phases 0-4 plus bas.

  (Retry/Read without narration/Cancel) ; chunk audio invalide après
  `llmVoice.audio.maxRetries` (défaut 2) → Skip/Stop.
- Résilience : timeouts combinés par requête (`llmVoice.tts.timeoutMs`,
  `llmVoice.narrator.timeoutMs`, défaut 60000, `AudioQueue`) ; attente d'un
  provider TTS en statut « Loading » (CdC §51) jusqu'à
  `llmVoice.tts.readyTimeoutMs` (défaut 30000) avant la première synthèse.
- `docs/user-guide.md` : guide utilisateur français (installation, premier
  « Speak Document », profils, erreurs courantes et leurs boutons, mode
  local, raccourcis).
- Providers TTS réels (phase 4) : `ChatterboxProvider` (`POST /tts` natif,
  clonage vocal via `voice_mode: "clone"`, ADR-005/CdC §55), `KokoroProvider`,
  presets (`src/tts/presets.ts`), `ProviderRegistry`, health check avec
  détection du statut « Loading », backoff exponentiel des retries
  (`AudioQueue`, `computeBackoffDelay`), pinning du cache pendant la
  fenêtre de préchargement (ADR-004).
- Narrateur réel (phase 4) : `OllamaNarrator` et `OpenAICompatibleNarrator`
  (sortie structurée JSON, revalidée côté extension, ADR-005), mode dégradé
  obligatoire (`transform()` ne jette jamais, bascule en lecture fidèle avec
  `degradedReason`).
- Documentation d'installation Linux (`docs/install-linux.md` : VS Code
  RPM/Flatpak/Snap, Ollama natif, Chatterbox ROCm) et `docs/providers.md`
  (contrats TTS/narrateur, presets, choix d'un provider).
- Slice vertical câblé (S3.5) : `Pipeline` remplace `NotWiredPipeline` et
  câble source → `parseMarkdown`/`segment` (ou phrases brutes pour le
  non-Markdown) → `buildSession` → `PlaybackController` avec
  `WebviewAudioSink` → surlignage → status bar → mini-player.
- Sources (`src/sources/`) : `MarkdownDocumentSource` (document, curseur,
  sélection, section), `TextSelectionSource` (tout langage), `ClipboardSource`.
- Les quatre profils par défaut du CdC §19 (`src/profiles/defaults.ts`),
  `ProfileRepository` (`profiles.json` sous `globalStorageUri`, JSON Schema
  généré depuis Zod et enregistré via `contributes.jsonValidation`).
- `OpenAICompatibleTtsProvider` (`POST /v1/audio/speech`, `EgressGuard`,
  `AbortSignal`) et `DiskAudioCache` (cache audio sur disque, éviction LRU,
  `Clear Audio Cache` câblée, ADR-004).
- `Verify Local Mode` câblée sur les réglages réels, Quick Pick + badge
  `$(lock)` dans la status bar.
- Bundling `esbuild` (`dist/extension.js`) : les dépendances de production
  (zod, unified, remark-*) sont désormais dans le VSIX packagé.
- Squelette du dépôt : gouvernance, CI (lint/unit/integration/package),
  CodeQL, Dependabot.
- Squelette de l'extension VS Code `llm-voice` (commande `llmVoice.hello`,
  segmenteur minimal).
- Squelette d'intégration Claude Code (plugin + collector Node).

### Fixed

- `vsce package --no-dependencies` produisait un VSIX qui plantait à
  l'activation dès qu'un point d'entrée chargeait `zod`
  (`src/core/profile.schema.ts`, ADR-005) : le bundling esbuild inline
  désormais les dépendances de production dans `dist/extension.js`.
