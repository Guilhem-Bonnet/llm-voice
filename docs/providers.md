# Providers TTS

Voir ADR-005 (contrats) et ADR-009 (offre à trois niveaux). Un seul contrat
`TtsProvider` ; `providerId` sélectionne l'implémentation, jamais une classe
codée en dur dans un profil.

## Presets (`src/tts/presets.ts`)

| Preset             | Classe                        | Port par défaut | Niveau ADR-009 | Distant |
| ------------------ | ------------------------------ | ---------------- | -------------- | ------- |
| `chatterbox-local`  | `ChatterboxProvider`           | `8004`            | 1              | non     |
| `kokoro-local`      | `KokoroProvider`                | `8880`            | 1              | non     |
| `piper-local`       | `OpenAICompatibleTtsProvider`   | `5000`            | 1b             | non     |
| `openai-compatible` | `OpenAICompatibleTtsProvider`   | (aucun défaut)    | 2 / 3          | oui     |

`llmVoice.tts.provider` (défaut `chatterbox`) et `llmVoice.tts.baseUrl`
(défaut `http://127.0.0.1:8004`) sont le repli quand un profil ne fixe pas
`tts.providerId`/`tts.baseUrl` (`resolveTtsConfig`). Le niveau 2/3 (clé d'API)
lit la clé via `context.secrets` (`profile.tts.apiKeyRef`), jamais en clair
dans `profiles.json` ni les logs (D10).

## Chatterbox (CdC §24-25, §28, §55)

`ChatterboxProvider extends OpenAICompatibleTtsProvider` pour la plomberie
HTTP partagée (`health()`, `headers()`, `egress`, repli de liste de voix),
mais **`synthesize()` parle le endpoint natif `POST /tts`, pas
`/v1/audio/speech`** — noms de champs vérifiés contre le schéma OpenAPI réel
du serveur (`GET /openapi.json` sur `localhost:8004`, 2026-09-08), pas
devinés. `/v1/audio/speech` (`OpenAISpeechRequest`) exige `model` + `voice`
et n'a **aucun** champ `exaggeration`/`cfg_weight`/`temperature`/`language`/
mode clone — des clés JSON en trop y sont silencieusement ignorées, et
`docs/e2e/report-2026-09-08.md` ("Accent français") a tracé l'accent anglais
sur la synthèse FR observé lors du run E2E réel S4.3 jusqu'à exactement ce
problème : `language` est honoré par `/tts` mais ignoré par
`/v1/audio/speech` sur ce serveur. `POST /tts` (`CustomTTSRequest`) est le
endpoint qui expose vraiment `voice_mode`, `predefined_voice_id`,
`reference_audio_filename`, `exaggeration`, `cfg_weight`, `temperature` et
`language`. `OpenAICompatibleTtsProvider.synthesize()` (`/v1/audio/speech`,
inchangé) reste le chemin de code pour tout *autre* moteur compatible OpenAI
sans alternative native (Piper via wrapper, niveaux 2/3 entreprise/cloud,
ADR-009) — il exige `model` + `voice` et ne transmet pas `language` au
moteur ; un profil qui le vise doit choisir une voix dont la langue
correspond déjà.

`listVoices()` tente `GET /v1/audio/voices` puis, sur 404, le repli
communautaire `GET /get_predefined_voices`. `health()` lit `GET /health` ;
un corps `{"status": "loading"}` remonte `degraded` (modèle en warm-up),
sinon repli sur `/v1/audio/voices` comme la classe de base.

### Voice cloning (CdC §55)

`profile.tts.referenceAudio` (chemin fichier local, rétro-compatible —
absent = comportement inchangé, `voice_mode: "predefined"` avec
`request.voice` comme `predefined_voice_id`) est téléversé une seule fois,
paresseusement, au premier `synthesize()`, via `POST /upload_reference`
(`multipart/form-data`, champ `files`, vérifié dans `/openapi.json`) ; le
serveur communautaire conserve le fichier sous son nom de base d'origine,
renvoyé ensuite comme `reference_audio_filename` sur chaque appel `/tts`
pour le reste de la vie de cette instance de provider (une instance par
triplet `providerId`/`baseUrl`/`referenceAudio` résolu — `Pipeline.ttsFor`,
clé de registre étendue en conséquence). Les appels concurrents au premier
`synthesize()` partagent un seul upload en vol (`uploadPromise` mémoïsé). Un
échec d'upload (fichier introuvable, réseau) fait échouer `synthesize()`
comme tout autre échec de synthèse — pas de repli silencieux vers une autre
voix, ce qui surprendrait l'utilisateur sans avertissement.

Le preset `chatterbox-local` (`presets.ts`) référence par défaut la voix
validée lors du run E2E réel S4.3 (5 candidats écoutés, retenue par
l'utilisateur) : clonage contre `fr-female-siwis.wav` (*The SIWIS French
Speech Synthesis Database*, CC BY 4.0, détail dans `docs/voices.md` et
`deploy/tts/reference-audio/ATTRIBUTION.md`), `exaggeration: 0.4`,
`cfg_weight: 0.5`, `temperature: 0.6`, `language: "fr"`.

**Comment l'extension localise cette référence** (`Pipeline.ttsFor` →
`resolveReferenceAudioPath`) : un chemin absolu est utilisé tel quel (voix
enregistrée par l'utilisateur, `docs/voices.md`) ; un chemin relatif — celui
du preset, `../deploy/tts/reference-audio/fr-female-siwis.wav` — est résolu
contre `context.extensionUri`. Cette forme relative ne se résout que dans un
**checkout du dépôt** : `context.extensionUri` y vaut le dossier
`vscode-extension/`, donc `../deploy/...` atteint bien
`deploy/tts/reference-audio/` juste à côté (lancement dev `F5`,
`vscode-test`, scripts E2E réels — tous fonctionnent ainsi). **Limite
connue** : un `.vsix` empaqueté n'embarque pas `deploy/` (outillage ops, pas
contenu d'extension — la liste de fichiers de `vsce package` se limite à
`vscode-extension/`), donc le clonage par défaut n'a alors aucun fichier de
référence à lire et `synthesize()` échoue proprement (upload → erreur
fichier introuvable → "TTS unavailable"/Retry, pas de repli silencieux).
Embarquer la référence *dans* le paquet d'extension est un travail futur,
hors périmètre S4.2.

## Kokoro (CdC §27) / Piper (ADR-009 niveau 1b)

Kokoro (82 M paramètres) : un seul knob réel, `speed` ; voix française par
défaut `ff_siwis` (seul voicepack FR documenté). Piper n'a pas de classe
dédiée : un wrapper HTTP compatible OpenAI (`piper-tts-http-server` ou
équivalent) suffit, d'où `OpenAICompatibleTtsProvider` nu sur le port `5000`.

## Santé et statut (CdC §51)

`ProviderHealth.status` reste le type fermé d'ADR-005
(`ok | degraded | unreachable | unauthorized | unverified`) ; l'UI
(`LLM Voice: Provider Status`, badge status bar) l'affiche en
`● Ready / ● Loading / ● Offline / ● Error`. `TtsProviderRegistry.healthAll()`
sonde tous les providers enregistrés en parallèle et ne laisse jamais un
provider hors ligne faire planter l'extension.

## Ajouter un provider

1. `extends OpenAICompatibleTtsProvider` — si le serveur expose
   `POST /v1/audio/speech`, surcharger `buildSpeechRequestBody()` /
   `parseVoicesResponse()` / `getCapabilities()` pour les réglages propres au
   moteur ; s'il a un endpoint natif différent (voir `ChatterboxProvider` et
   `POST /tts` ci-dessus), surcharger `synthesize()` lui-même plutôt que de
   forcer des champs propriétaires dans le corps OpenAI-compatible.
2. Ajouter un `TtsProviderPreset` dans `presets.ts` (`kind`, `baseUrl`,
   `model`/`voice` par défaut, `remote`).
3. Enregistrer la classe dans `createTtsProvider()` (`presets.ts`) et, si
   nécessaire, dans `presetKindForProviderId()`.
4. Écrire les tests contre `MockTtsServer` (`test/fakes/mockTtsServer.ts`) :
   paramètres envoyés, repli de voix, statuts de santé, capacités.
