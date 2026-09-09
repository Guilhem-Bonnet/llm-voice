# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce
fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et
ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/) à
partir de la version `0.1.0`.

## [Unreleased]

### Added

- Fiabilité (phase 5, S5.3) : `Logger` (`src/infrastructure/logger.ts`,
  Output Channel « LLM Voice », niveaux `error`/`warn`/`info`/`debug`,
  réglage `llmVoice.log.level`) avec redaction pure (`redact()`) qui tronque
  tout champ texte long et supprime les champs sensibles (`apiKey`,
  `authorization`, `text`, `spokenText`, `message`, `prompt`, corps HTTP,
  CdC §81, AC-SEC-07) ; branché sur `EgressGuard`, `Pipeline` et
  l'activation/désactivation de l'extension. Un test statique interdit tout
  `console.*` ailleurs dans `src/`.
- Erreurs UX (CdC §52, `src/ui/notifications.ts`, `NotificationGate`
  anti-spam une notification par session par type) : « Chatterbox is
  unavailable » (Retry/Open provider settings, Retry ne relance que le
  chunk en échec sans recréer la session — `AudioQueue.retry`,
  `PlaybackController.retryCurrentChunk`) ; narrateur indisponible
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
