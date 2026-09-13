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

`llmVoice.tts.provider` (défaut **`auto`**, S7.1/S8.3 — jamais `chatterbox`)
et `llmVoice.tts.baseUrl` sont le repli quand un profil ne fixe pas
`tts.providerId`/`tts.baseUrl` (`resolveTtsConfig`). Le niveau 2/3 (clé d'API)
lit la clé via `context.secrets` (`profile.tts.apiKeyRef`), jamais en clair
dans `profiles.json` ni les logs (D10).

**`"auto"` (`Pipeline.autoSelectTts`, ADR-009 amendé S8.3) : Chatterbox →
Piper local (serveur, rarement présent) → `SystemTtsProvider`** — Chatterbox
n'est essayé (et préféré) que si son `health()` répond déjà (le service
Docker tourne) ; sinon la résolution retombe sur `SystemTtsProvider`
(ci-dessous), qui n'a jamais besoin d'un serveur. Concrètement, sur une
machine fraîchement installée (aucun Docker, aucun serveur lancé), `"auto"`
résout systématiquement vers `SystemTtsProvider` — jamais vers Chatterbox par
défaut.

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

**Bug fix (voice-selection-not-applied / boucle infinie, 2026-09-12,
`_grimoire/_memory/shared-context.md`) — ce preset ne référence plus de
clonage par défaut.** Avant ce correctif, `chatterbox-local` (`presets.ts`)
référençait par défaut la voix validée lors du run E2E réel S4.3 (5
candidats écoutés, retenue par l'utilisateur) : clonage contre
`fr-female-siwis.wav` (*The SIWIS French Speech Synthesis Database*, CC BY
4.0, détail dans `docs/voices.md` et
`deploy/tts/reference-audio/ATTRIBUTION.md`), via un chemin **relatif**
(`../deploy/tts/reference-audio/fr-female-siwis.wav`) résolu contre
`context.extensionUri` (`Pipeline.ttsFor` → `resolveReferenceAudioPath`).
Cette forme ne se résout que dans un **checkout du dépôt** — un `.vsix`
empaqueté n'embarque pas `deploy/` (outillage ops, pas contenu d'extension) —
donc tout profil par défaut installé depuis un VSIX réel pointait vers un
fichier inexistant. `ChatterboxProvider` dégradait déjà proprement ce cas
(repli vers `voice_mode: "predefined"`, defect 3 de ce même correctif), mais
rien ne fournissait alors de `predefined_voice_id` : le serveur Chatterbox
communautaire rejette une requête `predefined` sans voix (`HTTP 400`) — la
cause racine du « LLM Voice : aucune voix configurée » vécu en boucle par un
utilisateur réel sur la 0.2.0.

**Tranche retenue** : ne plus livrer de référence de clonage par défaut
(`CHATTERBOX_LOCAL_PRESET.referenceAudio` est maintenant `undefined`)
plutôt que d'embarquer l'échantillon dans le paquet. Le clonage de voix
reste entièrement supporté — `tts.referenceAudio` explicite via l'éditeur de
profil ou `Use My Own Voice` (S8.2) — ce n'est simplement plus le défaut
imposé à l'installation. En complément, `Pipeline.withDefaultVoice` résout
désormais systématiquement une voix concrète depuis `listVoices()` (première
voix dont la langue correspond au profil, sinon la première) quand
`tts.voice` n'est pas défini, avant tout appel `synthesize()` — un profil
sans voix explicite n'atteint donc plus jamais un provider en mode
« predefined » sans `voice`, qu'il ait ou non de `referenceAudio` configuré.

## Kokoro (CdC §27) / Piper (ADR-009 niveau 1b)

Kokoro (82 M paramètres) : un seul knob réel, `speed` ; voix française par
défaut `ff_siwis` (seul voicepack FR documenté) — **cette classe parle à un
serveur Kokoro local** (`localhost:8880`, à démarrer soi-même), ce n'est pas
la même chose que le paquet npm `kokoro-js` (évalué et rejeté pour S8.3, voir
plus bas). Le preset `piper-local` (`OpenAICompatibleTtsProvider` nu sur le
port `5000`) suppose un wrapper HTTP compatible OpenAI devant Piper
(`piper-tts-http-server` ou équivalent) — personne ne le démarre par défaut ;
en pratique c'est **`SystemTtsProvider`** (ci-dessous) qui fournit Piper sans
aucun serveur.

### `SystemTtsProvider` — la voix locale par défaut, sans Docker (S7.1/S8.3)

`SystemTtsProvider` (`src/tts/SystemTtsProvider.ts`) synthétise en invoquant
directement un binaire local — jamais de serveur, jamais de `fetch`. Ordre de
détection Linux : Piper (si installé via `PiperSetup`) → `espeak-ng`. macOS :
`say`. Windows : SAPI via PowerShell.

`PiperSetup`/`installPiperVoice` (`src/tts/PiperSetup.ts`) télécharge le
binaire `rhasspy/piper` réel (GitHub Releases) et la voix française
`fr_FR-siwis-medium` (Hugging Face, ~60 Mo au total), vérifiés SHA-256
(`AssetDownloader`), et les installe sous `globalStorageUri/piper/`.

**S8.3 : ce téléchargement n'est plus une étape optionnelle à trouver.** Au
premier `Speak` sans aucun moteur système (`health().status === "unreachable"`,
`AutoVoiceInstall.ts`), `Pipeline.ensureVoiceReady` propose une seule action
("Installer la voix française") avec la taille réelle affichée ; accepter
télécharge, vérifie et enchaîne automatiquement sur la lecture demandée —
refuser ou échouer (hors ligne) retombe honnêtement sur la voix système sans
jamais mentionner Chatterbox.

## Santé et statut (CdC §51)

`ProviderHealth.status` reste le type fermé d'ADR-005
(`ok | degraded | unreachable | unauthorized | unverified`) ; l'UI
(`LLM Voice: Provider Status`, badge status bar) l'affiche en
`● Ready / ● Loading / ● Offline / ● Error`. `TtsProviderRegistry.healthAll()`
sonde tous les providers enregistrés en parallèle et ne laisse jamais un
provider hors ligne faire planter l'extension.

## Alternative évaluée et rejetée (S8.3) : `kokoro-js` in-process

Avant de retenir Piper comme moteur autonome par défaut, `kokoro-js`
(Kokoro-82M via transformers.js/onnxruntime, Apache-2.0) a été installé et
testé réellement (2026-09-11) : `npm i kokoro-js` réussit sans compilation
native, mais `node_modules` pèse **737 Mo** (`onnxruntime-node` 536 Mo à lui
seul) et tire `sharp` (traitement d'image, inutile ici) avec **3
vulnérabilités "high" sans correctif** (`npm audit`, CVE libvips/libheif). Le
modèle par défaut documenté par le paquet
(`onnx-community/Kokoro-82M-v1.0-ONNX`) **ne propose aucune voix française** :
demander `voice: "ff_siwis"` (le fichier d'embedding existe pourtant dans le
paquet npm) échoue avec `Voice "ff_siwis" not found` — seules 28 voix
anglaises (`en-us`/`en-gb`) sont exposées par cette conversion ONNX. Rejeté :
ni le poids, ni la sécurité, ni surtout le support français ne sont au
rendez-vous aujourd'hui. Piper (`SystemTtsProvider`, ci-dessus) reste le
moteur autonome par défaut.

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
