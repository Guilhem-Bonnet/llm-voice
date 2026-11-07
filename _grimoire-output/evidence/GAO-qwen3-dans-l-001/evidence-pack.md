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
