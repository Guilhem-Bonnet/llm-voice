# Profils (CdC §18-19, §47-51)

Un profil combine narration et voix : `id`, `label`, `mode` (`faithful` |
`narrated`), `language`, `tts` (`providerId`, `baseUrl`, `voice`,
`apiKeyRef`…), `narrator?`, `chunking`, `playback`. Stocké dans
`profiles.json` (`globalStorageUri`), validé par `VoiceProfileSchema` (Zod,
AC-SEC-05) à chaque lecture — un fichier invalide est signalé, jamais
silencieusement remplacé. Quatre profils par défaut (§19) : Lecture fidèle,
Professeur technique, Résumé LLM, Révision rapide.

## Commandes (§47)

`LLM Voice: Select Profile`, `Open Profiles` (ouvre `profiles.json`, schéma
JSON attaché via `contributes.jsonValidation` — `schemas/profile-collection.schema.json`,
régénéré par `npm run gen:schema`), `Duplicate/Delete/Import/Export Profile`,
`Set Default Profile`. Le badge 🔒/☁ (`isRemoteProfile`) indique si un
profil quitte la boucle locale.

## Profil par défaut selon la source (§47)

`llmVoice.profiles.bySource` associe une source (`markdown`, `text`,
`clipboard`, `claude-code`) à un identifiant de profil. Une source absente
du réglage utilise le dernier profil sélectionné, puis le profil par défaut
de la collection.

```json
{ "markdown": "faithful-local", "claude-code": "llm-summary" }
```

## Import / Export

`Export Profile` écrit un profil unique en JSON. `Import Profile` valide le
fichier contre `VoiceProfileSchema` avant toute écriture (AC-SEC-05) ; un id
en collision est désambiguïsé (`-2`, `-3`…) plutôt que d'écraser un profil
existant. Un `baseUrl` hors boucle locale déclenche l'avertissement
« ☁ Remote provider ».

## Test Voice et Provider Status (§50-51)

`LLM Voice: Test Voice` lit `llmVoice.testVoice.text` (phrase française
configurable) avec le profil courant, sans document complet. `LLM Voice:
Provider Status` sonde la santé (`● Ready/Loading/Offline/Error`) du TTS et,
si présent, du narrateur du profil courant ; un provider éteint ne fait
jamais planter l'extension.

## Éditeur de profils (S8.2, CdC §49)

`LLM Voice: Edit Profile` ouvre une webview sécurisée (nonce par rendu, CSP
stricte `default-src 'none'`/`connect-src 'none'`, `localResourceRoots`
limité à `media/profileEditor/`, même posture que le mini-player d'ADR-011).
Champs couverts : nom, langue, narrateur (aucun, Ollama, compatible OpenAI)
avec modèle et consigne de narration (`profile.style`), provider TTS et
voix (bouton « Parcourir les voix », réutilise `LLM Voice: Browse Voices`),
vitesse (`playback.rate`), réglages avancés générés depuis
`TtsProvider.getCapabilities().parameters` (ADR-005 — jamais codés en dur,
donc expressivité/poids de guidage apparaissent pour Chatterbox sans champ
dédié), politique Markdown (code, liens, images, tableaux —
`profile.markdownPolicy`, optionnel, défaut CdC §13 si absent), mode de
synchronisation éditeur (`profile.syncMode` : `highlight-scroll` par défaut,
`highlight` sans auto-scroll, `off`). Un bouton « Tester » lit la phrase de
référence avec les réglages courants sans sauvegarder. La sauvegarde est
validée par `VoiceProfileSchema` (Zod) ; toute violation s'affiche en clair
sans toucher `profiles.json`. Aucune valeur de profil n'est jamais
interpolée dans le HTML de la webview — elle voyage uniquement via
`postMessage` et est écrite avec `textContent`/`.value` côté script
(`media/profileEditor/profileEditor.js`). Actions Dupliquer et Supprimer
disponibles depuis l'éditeur.

## Navigateur de voix (S8.2, CdC §72)

`LLM Voice: Browse Voices` interroge `listVoices()` du provider TTS actif et
affiche un Quick Pick avec, pour chaque voix, un bouton d'écoute immédiate
(synthèse de la phrase de test + lecture, sans fermer la liste). La langue
déclarée par le provider est affichée quand connue ; une voix anglophone
détectée pour un profil non anglophone est signalée visiblement — voir
`docs/voices.md`. Sélectionner une voix l'applique au profil courant et la
sauvegarde. Fonctionne avec Chatterbox, Kokoro, Piper et la voix système.

## Ma voix comme référence (S8.2, CdC §55)

`LLM Voice: Use My Own Voice` détaillé dans `docs/voices.md` : consentement
explicite, fichier existant ou enregistrement guidé (commande adaptée à la
plateforme), validation (durée, mono/stéréo, niveau non silencieux),
conversion 24 kHz mono si `ffmpeg` est disponible, copie locale dans
`globalStorageUri/voices/`, application au profil courant
(`tts.referenceAudio`) et écoute immédiate. Tout reste local.

## Clés d'API (AC-17, AC-SEC-08)

`LLM Voice: Set/Clear Provider API Key` stockent la clé exclusivement dans
`SecretStorage`, sous `llmVoice.apiKey.<providerId>` — jamais dans
`globalState` ni en clair dans `profiles.json`. Un profil référence sa clé
via `tts.apiKeyRef`/`narrator.apiKeyRef` (nom de la clé, pas sa valeur).
