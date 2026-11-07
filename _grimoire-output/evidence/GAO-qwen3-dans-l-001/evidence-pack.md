# Evidence Pack — GAO-qwen3-dans-l-001 (étape 1 sur 2)

## Incrément 1 : fournisseur Qwen3, choix automatique, repli (2026-11-07)

### Ce qui change

| Fichier | Changement |
|---|---|
| `vscode-extension/src/tts/qwen3VoiceCatalog.ts` (nouveau) | voix `fr-essais-21-22`, libellé « Voix des essais 21 et 22 » (nom du serveur) |
| `vscode-extension/src/tts/presets.ts` | genre `qwen3`, `QWEN3_LOCAL_PRESET` (port 8021) ; `createTtsProvider` = `KyutaiPocketProvider` avec `loadsOnDemand`, `readsDirection`, `wholeReadingFirst` |
| `vscode-extension/src/tts/KyutaiPocketProvider.ts` | option `readsDirection` (champ `direction` envoyé si non blanc) ; `/health` avec `gpu_yield: true` ou `state: "yielded"` → `degraded` / `gpu-yield` |
| `vscode-extension/src/core/tts.ts` | `TtsRequest.direction?` (pour l'étape 2, rien ne le remplit encore) ; `TtsCapabilities.wholeReadingFirst?` |
| `vscode-extension/src/pipeline/resolveProviderConfig.ts` | `isHealthyEnough` refuse `gpu-yield` ; port propre de `qwen3` ; `chooseQwen3OrFallback`, `qwen3FallbackMessage` (fonctions pures) |
| `vscode-extension/src/pipeline/Pipeline.ts` | choix automatique : Qwen3 → Kyutai 1.6B → Chatterbox → Piper local → système ; `withQwen3Fallback` pour une lecture demandée à Qwen3 |
| `vscode-extension/src/extension.ts`, `.vscode-test.mjs` | `LLM_VOICE_TEST_AUTO_QWEN3_BASE_URL` / `_KYUTAI16_BASE_URL` (hors production) ; toute suite pointe ces sondes sur des ports fermés 47616/47617 par défaut |

### Comportement de repli (décrit, testé en unitaire)

- Voix choisie explicitement (ex. Camille dans `global-voice.json`) : jamais réécrite. Aucune migration.
- Voix « automatique » : Qwen3 si `/health` répond sans `gpu_yield`, sinon Kyutai 1.6B, sinon l'ordre existant, sinon voix système. Silencieux, comme avant.
- Lecture demandée à Qwen3 (choisie) : mode jeu (drapeau local ou `gpu_yield` du serveur) → voix système ; Qwen3 injoignable → Camille (Kyutai) si Kyutai répond, sinon voix système. Avertissement une fois par cause et par session VS Code. Rien n'est écrit.

### Commandes exécutées (dans `vscode-extension/`)

| Commande | Résultat lu |
|---|---|
| `npm run -s typecheck` | code 0, aucune sortie |
| `npm run -s lint` | code 0, aucune sortie |
| `npm run -s test:unit` | 149 fichiers, 3149 tests, 0 échec (dont 16 nouveaux dans `test/unit/tts/qwen3.test.ts`) |
| `npm run -s build` | code 0 |
| `xvfb-run -a npx vscode-test --label fake-tts` | 1re fois : 78 passing, 1 failing (« AC-07: selecting a different profile sends a different voice », `voice-a` au lieu de `voice-b`) ; relancé 2 fois : 79 passing, 0 failing. Instable, sans lien établi avec ce changement (suite FAKE_TTS, ne passe pas par le choix automatique) |
| `xvfb-run -a npx vscode-test --label integration-security` | 8 passing |
| `npm run -s test:integration-voice` | 51 passing (2 min) |

Un premier passage de `test:unit` a échoué sur le cliquet V9 (mot interdit dans un message : l'option `--profile` de compose) ; message corrigé, la commande nomme le service seul (`docker compose ... up -d --dry-run qwen3` vérifié : active le service).

### Service Qwen3 via compose

- `docker compose -f deploy/docker-compose.tts.yml --profile qwen3 up -d qwen3` : conteneur `deploy-qwen3-1` démarré, `/health` = `unloaded`.
- `POST /load` : prêt en 28 s (`model_loaded`, `duration_s: 27.5` dans le journal). Premier chargement via compose réussi.
- Une synthèse curl : 6,8 s d'audio en 18,4 s (≈ 2,7 s de calcul par seconde, première requête après chargement).
- `gpu-yield/active` absent avant chaque charge GPU.

Commit de l'incrément 1 : `969ee43` (fichiers de la carte seulement ; hook pre-commit passé).

## Incrément 2 : lecture préparée en entier

- `src/playback/waitEstimate.ts` : étape `whole-reading` (« Préparation de toute la lecture… »), `WaitTracker.setPassages(ready, total)` : barre = passages prêts / total, texte « n passages prêts sur N », jamais 100 avant le son.
- `src/playback/PlaybackController.ts` : `timeoutMs` par session.
- `src/pipeline/Pipeline.ts` : moteur `wholeReadingFirst` + lecture fidèle à une voix + plus d'un passage → `startAhead = N-1`, fenêtre = N, délai par requête ≥ 180 s ; le compteur suit `onChunkTiming`.
- Lu : `typecheck` 0, `lint` 0, `test:unit` 150 fichiers / 3151 tests verts (dont `test/unit/playback/wholeReadingWait.test.ts`), `build` 0.
- Suites d'intégration lues : `fake-tts` 79 passing, `integration-security` 8 passing, `test:integration-voice` 51 passing (2 min), build 0.

Commit de l'incrément 2 : `df52198`.

## Incrément 3 : la voix Qwen3 dans la galerie

- `galleryModel.ts` : moteur et section `qwen3`, entrée `qwen3:fr-essais-21-22` « Voix des essais 21 et 22 » placée avant Kyutai narration, commande `docker compose -f deploy/docker-compose.tts.yml up -d qwen3`, carte « Prête / Non prête », choix écrit `{providerId: "qwen3", baseUrl: 8021, voice}`.
- `VoiceGalleryController.ts` : sonde de santé et note de la section ; `voiceGalleryHtml.ts` + `media/voiceGallery/voiceGallery.js` : section « Voix Qwen3 · voix par défaut », état du serveur, commande, Copier, Vérifier.
- Aucun code n'écrit `global-voice.json` en dehors du clic « Choisir » existant.
- Lu : typecheck 0, lint 0, test:unit 150 fichiers / 3154 tests (compteurs de la galerie passés à 60 voix, 3 tests galerie dans `qwen3.test.ts`), build 0, fake-tts 79 passing, integration-security 8 passing, test:integration-voice 51 passing.

Commit de l'incrément 3 : `f272faa`.

## Incrément 4 : preuve réelle `native-real.sh --qwen3` et `--qwen3-stop`

### Outillage
- `scripts/audio-proof/native-real.sh` : `--qwen3` (texte `vscode-extension/test/fixtures-native-real/qwen3-long.md`, 1 610 caractères, `wc -m`) et `--qwen3-stop`. Mode jeu vérifié, service 8021 vérifié, cache du VS Code de test déplacé par `mv` (jamais effacé), journal du serveur relevé. Verdict : `silence_between_sounds_ms < 1200` (le silence de préparation avant le premier son est exclu de cette mesure, il est dans `silence_max_ms`) ; pour `--qwen3-stop`, capture silencieuse exigée.
- Pour Qwen3, le sink par défaut de la machine n'est plus basculé (le flux Firefox de l'utilisateur n'est pas déplacé) : VS Code est lancé avec `--mute-audio` (`.vscode-test.mjs`), le Core vise le sink nul (`PIPEWIRE_PROPS target.object`, `node.dont-move`).
- `vscode-extension/test/integration-native-real/qwen3-long.test.ts` : lecture complète (état final `completed`, jamais `buffering` après le premier son) ; Stop pendant `preparing`.
- Garde pendant chaque preuve (script du dossier temporaire, `pactl -f json`) : tout flux `llm-voice` doit être sur le sink nul `llmvoice_test`, sinon `pkill -x llm-voice-core`. Résultat : `proof-qwen3-long-sinkguard.jsonl` (flux 214002 sur le sink 212434 = sink nul, `ok: true`) et `proof-qwen3-stop-sinkguard.jsonl` (aucun flux ouvert).

### Premier essai interrompu par moi (pas une preuve)
Une première garde, mal écrite (awk), n'a pas lu le numéro du sink et a tué le Core ; `pkill -f` a aussi tué le shell de la garde. La préparation n'était pas finie : aucun son n'avait encore été joué. Run arrêté (kill des processus vscode-test), résultat écarté.

### Preuve `--qwen3` (texte long), lue
| Mesure | Valeur | Source |
|---|---|---|
| Premier son (depuis `start`) | 202,3 s | `qwen3-proof.firstSoundMs` |
| Durée totale de la commande | 298,2 s | `qwen3-proof.totalMs` |
| États de la machine | `playing` → `completed` | `qwen3-proof.states` |
| Plus long silence entre deux sons | 800 ms | `silence_between_sounds_ms` |
| Silence avant le premier son (préparation) | 210,3 s | `silence_max_ms` (capture démarrée avant VS Code) |
| WER (faster-whisper) | 0,0493 | `proof-qwen3-long.json` |
| Requêtes au serveur | 9, toutes 200, séquentielles, 5 à 33 s chacune | journal `deploy-qwen3-1` |
| Verdict | test exit 0, prove.sh exit 0 | `proof-qwen3-long.log` |

Écarts de transcription : « se dressent », « collimasson », « contine », « ils les voient », « champ grave » pour « chant grave ». Ce sont des erreurs du transcripteur ou de la voix : l'écoute de guilhem-bonnet tranchera.

### Preuve `--qwen3-stop`, lue
- Stop pressé après 20 s de préparation : état `stopped`, aucun `playing`, capture silencieuse (`silent: true`, rms 0).
- Serveur : 3 requêtes, la troisième s'arrête en 499 (client parti) à 18:07:24Z, l'heure du Stop ; aucune requête ensuite.
- test exit 0, verdict 0.

### Tests après l'incrément 4, lus
typecheck 0, lint 0, test:unit 150 fichiers / 3154 tests, build 0, fake-tts 79 passing, integration-security 8 passing, test:integration-voice 51 passing.

Service Qwen3 laissé démarré (`deploy-qwen3-1`, voix figée chargée), comme convenu avec le coordinateur. `deploy-kyutai16-1` jamais touché.
