# Agentic Evidence Pack

## Summary

- Task id: GAO-moteur-kyuta-001
- Profile: controlled
- Outcome: Moteur Kyutai TTS 1.6B dans l'extension : serveur local sur carte AMD, voix françaises prénommées, galerie — critères : AC-001 test: npm --prefix vscode-extension run test:unit et test:integration-voice verts; AC-002 test: scripts/audio-proof/native-real.sh avec Kyutai 1.6B, WER sous 10 %; AC-003 revue: écoute par guilhem-bonnet consignée dans acceptance-record; AC-004 gate: grimoire standard gate check --strict vert
- Final state: in_progress (2026-11-06)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD 84f89bf | git rev-parse --short HEAD | référence (2026-11-06) ; HEAD d8c376a au moment des mesures, rien de cette tranche n'est commité |
| Serveur et tests | `deploy/kyutai16/server.py`, `deploy/kyutai16/test_server.py`, `deploy/kyutai16/voices.json` | backend-engineer | 36 tests verts avec un faux modèle |
| Service Docker | `deploy/docker-compose.tts.yml`, `deploy/README.md` | backend-engineer | validé par `config` et `up --dry-run`, jamais démarré |
| Extension | `vscode-extension/src/tts/kyutai16VoiceCatalog.ts`, `test/unit/tts/kyutai16.test.ts`, provider, presets, galerie | backend-engineer | sorties ci-dessous |
| VSIX | `vscode-extension/llm-voice-linux-x64.vsix` (1 940 949 octets, 2026-11-06 11:38:19) | `npm run package:linux-x64` | aucun fichier `cml-*`, `577_394`, `kyutai16/` ni `deploy/` |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Typecheck | `npm run -s typecheck` | exit 0 | |
| Lint | `npm run -s lint` | exit 0 | `--max-warnings=0` |
| Tests unitaires | `npm run -s test:unit` | exit 0 : 128 fichiers, 2657 tests verts | `grimoire standard gate run-tests` non lancé : la carte reste au concierge |
| Build | `npm run build` | exit 0 | `dist/extension.js` daté 11:35:33, build lancé à 11:35 : réellement reconstruit |
| Intégration fake-tts | `xvfb-run -a npx vscode-test --label fake-tts` | 1er passage exit 1 : 65 verts, 1 rouge. 2e et 3e passages exit 0 : 66 verts | Voir « Écarts » : sidebar, instable |
| Intégration voix | `npm run test:integration-voice` | exit 0 : 24 verts | Dont les 2 nouveaux tests Kyutai narration |
| Python, hôte | `python3 deploy/kyutai16/test_server.py` | exit 0 : 36 tests | Python 3.14, faux modèle |
| Python, image | `docker run --rm --network none --user 1000:1000 -v deploy:/repo/deploy:ro --entrypoint python deploy-chatterbox:latest /repo/deploy/kyutai16/test_server.py` | exit 0 : 36 tests, 1 ignoré (node absent de l'image) | Python 3.10.12, sans `/dev/kfd` ni `/dev/dri` |
| API moshi de l'image | import réel dans le même conteneur sans GPU | `3.10.12 2.9.1+rocm7.2.3 kyutai/tts-1.6b-en_fr` ; `on_frame` présent ; `prepare_script`, `make_condition_attributes`, `from_checkpoint_info`, `from_hf_repo` présents | Signatures seules, modèle non chargé |
| Vrai point d'entrée du serveur | `XDG_RUNTIME_DIR=<essai> HF_HOME=~/.llm-voice/voices-lab/kyutai-1.6b/hf python3 deploy/kyutai16/server.py --port 18020`, drapeau de mode jeu d'essai posé | `/health` 200 `model_loaded:false, gpu_yield:true, voices:36` ; `/voices` 36 sur 36 trouvées dans le vrai cache, Camille en tête ; `POST /tts` 503 + `Retry-After: 60` ; `voice_url=../../etc/passwd` 400 ; `Host: exemple.org` 403 ; SIGTERM exit 0 ; `SECRET` 0 fois dans le journal | Le modèle n'a jamais été chargé |
| Compose | `docker compose -f deploy/docker-compose.tts.yml config --services` | `chatterbox` seul ; avec `--profile kyutai16` : `chatterbox`, `kyutai16` | Il ne part pas par défaut |
| Compose, commande | `up --dry-run -d kyutai16`, avec et sans `--profile kyutai16` | Même résultat : `Container deploy-kyutai16-1 Creating, Created, Starting, Started`, rien sur chatterbox | `docker ps` ensuite : pas de `kyutai16`, musing_snyder et deploy-chatterbox-1 intacts |
| Compose, rendu | `config kyutai16` | `restart: 'no'`, `image: deploy-chatterbox:latest`, `pull_policy: never`, `host_ip: 127.0.0.1`, `published: "8020"`, `create_host_path: false` | |
| Packaging | `npm run package:linux-x64` | exit 0 : `Packaged: llm-voice-linux-x64.vsix (49 files, 1.85 MB)` ; `check-vsix: no test code, no sources, no maps, no secrets; every required file present.` | 20 `.ogg`, tous de Pocket ; `kyutai-1-6b` présent dans `dist/extension.js` du VSIX |

Sorties brutes de la session, hors dépôt : `/home/guilhem/.cache/cct/claude-1000/-mnt-Travail-Projets-Dev-TTS-Voice/2afc355f-1a6f-4749-8260-26c00fa0dc52/scratchpad/{typecheck,lint,unit,build,fake-tts,fake-tts-1,fake-tts-2,integration-voice,python,python-image,moshi-api,package,real-main,real-main-out}.log`.

### Non prouvé ici

Aucune charge GPU n'a été lancée, sur consigne. Restent au concierge : audio réel par ce serveur (AC-002, `scripts/audio-proof/native-real.sh`), annulation et libération de VRAM sur ROCm réel, démarrage réel du conteneur, écoute par guilhem-bonnet (AC-003), gate strict (AC-004).

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | partiel | enveloppe et ce pack | Carte non avancée, gate non lancé : au concierge |
| Quality | yes | typecheck, lint, unitaires, intégration, Python | Une instabilité fake-tts, voir ci-dessous |
| Runtime | partiel | vrai point d'entrée sans modèle, `up --dry-run` | Pas de conteneur réel, pas de synthèse réelle |
| Knowledge | yes | moshi lu dans `extras/moshi/models/tts.py`, licence du modèle lue dans le README du cache | Licences des voix : données du brief, non relues |
| Model/provider | yes | aucun service cloud, `HF_HUB_OFFLINE=1` forcé par le serveur | |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| La galerie affiche `docker compose -f deploy/docker-compose.tts.yml up -d kyutai16`, pas la commande du brief avec `--profile kyutai16` | Le test V9 (ADR-017) refuse ce mot dans ce que l'utilisateur lit. Résultat identique prouvé par `up --dry-run`. La forme du brief reste dans `deploy/README.md` et l'en-tête du compose | Non accepté à ce jour : à arbitrer par le concierge | Si la commande exacte est exigée dans la galerie |
| Dans le conteneur le serveur écoute `0.0.0.0` (`KYUTAI16_HOST`) | Nécessaire à la publication Docker ; port publié sur `127.0.0.1` seul, Host et Origin vérifiés. Hors conteneur, défaut `127.0.0.1` | Non accepté à ce jour : à arbitrer | Passage en `network_mode: host` |
| « Choisir » n'apparaît que serveur démarré ; « Écouter » reste toujours visible | Comme Chatterbox, pour ne pas fixer une voix sans serveur | Non accepté à ce jour : à arbitrer | Retour de guilhem-bonnet |
| Ajout non demandé : option dans l'éditeur (`profileEditorHtml.ts`, `profileEditor.js`) et section placée avant Pocket | Même liste de moteurs partout ; le choix de l'utilisateur est mis en avant | Non accepté à ce jour : à arbitrer | Revue |
| Test `sidebar.test.ts` « activating a different profile… » rouge 1 fois sur 3 en fake-tts (`waitFor` expiré, passage de 19 s contre 8 s, GPU et machine chargés par le banc) | Cause non diagnostiquée, code touché sans rapport apparent ; aucune preuve qu'il préexiste | Non accepté à ce jour | Si rouge à nouveau hors charge |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Preuve réelle du concierge (2026-11-06)

- Service réel `kyutai16` sur le GPU : Camille, 3 essais. Avec Chatterbox, le banc et Ollama en mémoire : deux réponses 503, `OutOfMemoryError` (VRAM 15,8 sur 17,1 Go). Après arrêt de Chatterbox : 200, 38,7 s au premier appel, puis 8,7 s et 7,9 s pour 7 à 8,5 s d'audio, avec le banc actif.
- `scripts/audio-proof/native-real.sh --kyutai16` : exit 0, WER 0,0, silence de pause 2460 ms, capture sur sink nul, sortie par défaut inchangée (`native-real-camille.log`).
- Reste : silence maximal de 21,9 s dans la capture, à relier au temps d'attente du premier son ; écoute de guilhem-bonnet.
