# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce
fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et
ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/) à
partir de la version `0.1.0`.

Ce fichier est la seule source de vérité (voir `CONTRIBUTING.md`) ; le
`CHANGELOG.md` à la racine du dépôt en est une copie générée par
`npm run sync:changelog`, à ne jamais éditer directement.

## [Unreleased]

**S8.2 — le parcours de découverte de voix devient autonome : plus besoin d'un agent pour choisir la bonne voix (CdC §72, version 0.2).**

### Added

- **`LLM Voice: Browse Voices`** (CdC §72) : Quick Pick listant les voix du provider actif (`listVoices()`), bouton d'écoute immédiate par voix (synthèse + lecture sans quitter la liste), langue affichée quand connue, avertissement visible sur une voix anglophone détectée pour un profil non anglophone (`isEnglishVoice`) — le piège documenté dans `docs/voices.md` (cinq itérations d'écoute avant S4.3). Sélectionner une voix l'applique et la sauvegarde sur le profil courant. Fonctionne avec Chatterbox, Kokoro, Piper et la voix système.
- **`LLM Voice: Use My Own Voice`** (CdC §55) : assistant en trois étapes — consentement explicite, choix d'un fichier existant ou enregistrement (commande adaptée à la plateforme : `pw-record`/`arecord` sous Linux, `ffmpeg -f avfoundation` sous macOS, `ffmpeg -f dshow` sous Windows, copiée dans le presse-papiers, surveillance de l'apparition du fichier), validation par lecture d'en-tête WAV (durée, mono/stéréo, niveau non silencieux), conversion 24 kHz mono via `ffmpeg` si disponible, copie dans `globalStorageUri/voices/`. Rien ne quitte la machine. Test immédiat de la voix clonée.
- **`LLM Voice: Edit Profile`** (CdC §49) : webview sécurisée (nonce, CSP stricte, `localResourceRoots` minimal, aucune donnée de profil interpolée dans le HTML) pour éditer nom, langue, narrateur (modèle, prompt), provider TTS et voix (bouton « Parcourir les voix »), vitesse, réglages avancés du provider générés depuis `getCapabilities()` (ADR-005 — jamais codés en dur), politique Markdown, mode de synchronisation éditeur. Bouton « Tester » sans sauvegarder. Sauvegarde validée par `VoiceProfileSchema` (Zod) avec messages d'erreur en clair. Actions Dupliquer et Supprimer.
- **`VoiceProfile.markdown`/`synchronization.mode`** (optionnels, rétrocompatibles) : un profil peut désormais porter sa propre politique Markdown (§13) et son comportement de surlignage éditeur (`"highlight-scroll"` par défaut, `"highlight"` sans auto-scroll, `"off"`) — noms alignés sur l'exemple du cahier des charges §18.

### Fixed

- **`OpenAICompatibleTtsProvider.listVoices()`** ne comprenait pas la forme réelle de `/v1/audio/voices` du serveur communautaire Chatterbox-TTS-Server (`{"voices": ["Abigail.wav", ...]}`, de simples noms de fichiers) : chaque voix ressortait avec `id`/`label` à `undefined`, rendant le navigateur de voix inutilisable en pratique. Vérifié en direct contre `localhost:8004`.

### Changed

- **Renommage `VoiceProfile.markdownPolicy` → `markdown`, `syncMode` → `synchronization.mode`** : la première implémentation de l'éditeur de profils avait inventé ces deux noms ; le cahier des charges §18 nomme ces blocs `markdown` et `synchronization.mode` verbatim, et le schéma suit maintenant cet exemple à la lettre. Un `profiles.json` écrit avant ce renommage continue de charger sans intervention : `VoiceProfileSchema` migre les anciens noms vers les nouveaux au chargement (`profile.schema.ts`, testé par `test/unit/profiles/profileForm.test.ts` et `test/integration/syncModeAndMarkdownPolicy.test.ts`).

## [0.1.1] - 2026-09-09

**Corrige le problème remonté sur la 0.1.0 : un utilisateur non technique installe le VSIX et entend du son immédiatement, sans configurer ni installer quoi que ce soit.**

### Added

- **Voix système sans installation** (S7.1, ADR-009 niveau 1b) : `SystemTtsProvider` synthétise via un binaire déjà présent sur la machine (espeak-ng, `say` sur macOS, SAPI via PowerShell sur Windows) — aucun serveur, aucune configuration. Devient le profil par défaut au premier lancement (« Voix système (aucune installation) »).
- **Installation guidée de Piper** (S7.1) : commande `LLM Voice: Install Local Voice (Piper)`, téléchargement du binaire et de la voix `fr_FR-siwis-medium` vérifié par SHA-256, consentement explicite avant tout octet réseau, hôtes limités à GitHub Releases/Hugging Face, refusé sous `LLM_VOICE_STRICT_LOCAL=1`.
- **Sélection automatique du provider TTS** (`llmVoice.tts.provider: "auto"`, nouveau défaut) : Chatterbox si disponible, sinon Piper local, sinon la voix système — un choix explicite (profil ou setting) n'est jamais recouvert.
- **Parcours de découverte** (S7.2) : « Démarrer avec LLM Voice » s'ouvre automatiquement une seule fois à la première activation, jamais ensuite ; document Markdown d'exemple embarqué pour l'essayer sans fichier personnel.
- **`LLM Voice: Setup Voice`** : choix honnête entre trois niveaux de qualité (voix système / Piper local / Chatterbox), plus jamais bloqué sur « Chatterbox n'est pas installé ».
- **README de l'extension**, vues d'accueil (`viewsWelcome`) pour le lecteur et l'inbox vides, bouton haut-parleur dans la barre de titre de l'éditeur (Markdown uniquement).
- **`Ctrl+Alt+V Espace`** (`llmVoice.playPause`) : vraie bascule Play/Pause, distincte de `llmVoice.play`.
- **Contexte `llmVoice.state`** : les commandes sans effet dans l'état courant (Pause/Stop/segment suivant-précédent) sont grisées dans la palette.

### Fixed

- **Play sans session active** démarre désormais la lecture du document (ou de la sélection) au lieu de ne rien faire silencieusement.
- **Commandes muettes** : les 30 commandes de la palette produisent toujours un effet visible ou un message explicite, jamais un clic sans effet observable.
- **Message d'erreur sans issue** : « Chatterbox is unavailable » remplacé par un message actionnable proposant de choisir une voix (assistant de configuration) ou de consulter les réglages, plus jamais un cul-de-sac.
- **README/CHANGELOG/LICENSE absents du VSIX** : le paquet publié embarque désormais la documentation utilisateur et les media du parcours de découverte.

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
