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

## Chatterbox (CdC §24-25, §28)

`ChatterboxProvider extends OpenAICompatibleTtsProvider` et ajoute au corps
`POST /v1/audio/speech` : `language_id` (depuis `profile.language`),
`exaggeration`, `cfg_weight`, `temperature` (depuis `profile.tts.parameters`).
`listVoices()` tente `GET /v1/audio/voices` puis, sur 404, le repli
communautaire `GET /get_predefined_voices`. `health()` lit `GET /health` ;
un corps `{"status": "loading"}` remonte `degraded` (modèle en warm-up),
sinon repli sur `/v1/audio/voices` comme la classe de base.

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

1. `extends OpenAICompatibleTtsProvider` si le serveur expose déjà
   `POST /v1/audio/speech` — surcharger `buildSpeechRequestBody()` /
   `parseVoicesResponse()` / `getCapabilities()` pour les réglages propres au
   moteur.
2. Ajouter un `TtsProviderPreset` dans `presets.ts` (`kind`, `baseUrl`,
   `model`/`voice` par défaut, `remote`).
3. Enregistrer la classe dans `createTtsProvider()` (`presets.ts`) et, si
   nécessaire, dans `presetKindForProviderId()`.
4. Écrire les tests contre `MockTtsServer` (`test/fakes/mockTtsServer.ts`) :
   paramètres envoyés, repli de voix, statuts de santé, capacités.
