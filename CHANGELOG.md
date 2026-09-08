# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce
fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et
ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/) à
partir de la version `0.1.0`.

## [Unreleased]

### Added

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
