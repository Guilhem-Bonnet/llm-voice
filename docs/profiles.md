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

## Clés d'API (AC-17, AC-SEC-08)

`LLM Voice: Set/Clear Provider API Key` stockent la clé exclusivement dans
`SecretStorage`, sous `llmVoice.apiKey.<providerId>` — jamais dans
`globalState` ni en clair dans `profiles.json`. Un profil référence sa clé
via `tts.apiKeyRef`/`narrator.apiKeyRef` (nom de la clé, pas sa valeur).
