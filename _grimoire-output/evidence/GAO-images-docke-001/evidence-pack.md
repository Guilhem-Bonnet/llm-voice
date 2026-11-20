# Evidence Pack — GAO-images-docke-001

## Livrables

- `deploy/qwen3/Dockerfile.rocm`, `Dockerfile.cuda`, `Dockerfile.models`
- `deploy/qwen3/requirements-common.txt`, `requirements-rocm.txt`, `requirements-cuda.txt`
- `deploy/qwen3/data-init.sh`, `NOTICE.models`, `prepare-models-context.sh`, `build.sh`, `publish.sh`
- `deploy/docker-compose.qwen3.yml` (service `qwen3-data` + `qwen3` profil rocm / `qwen3-cuda` profil cuda)
- `deploy/README.md` (section « Qwen3 en images », ligne du tableau des services)

## Validation

| Contrôle | Commande | Résultat |
|---|---|---|
| Construction ROCm | `deploy/qwen3/build.sh rocm` | rc=0 (`build-rocm.log`) ; `torch 2.9.1+rocm7.2.3`, hip 7.2.53211, transformers 4.57.3, `import qwen_tts` OK |
| Construction CUDA | `deploy/qwen3/build.sh cuda` | rc=0 (`build-cuda.log`) ; `torch 2.9.1+cu128`, cuda 12.8, `import qwen_tts` OK, sans GPU |
| Construction modèles | `deploy/qwen3/build.sh models` | rc=0 (`build-models.log`), contexte hors dépôt `~/.llm-voice/build/qwen3-models-0.1.0` |
| Tailles (`docker image inspect .Size`) | `image-sizes.txt` | rocm 24,7 Go ; cuda 12,3 Go ; models 16,3 Go ; (deploy-chatterbox:latest 30,7 Go). Magasin d'images containerd : le chiffre peut compter les couches compressées en plus des décompressées (8,6 Go de poids pour l'image models) — non vérifié |
| Init des volumes | `run_proof.sh` → `qwen3-data.log` | copie, empreintes SHA-256 des blobs vérifiées, catalogue, 9 voix créées ; 2e lancement : « déjà copiés » (`qwen3-data-second-run.log`) |
| Sans réseau | `container.txt` | `network_mode=none`, user 1000:1000, rootfs lecture seule, `CapDrop=[ALL]`, connexion sortante : injoignable |
| `/health` | `health-start.json`, `health-after.json` | `healthy`, 10 voix ; après la phrase : `state: ready`, `models.frozen: true` |
| `/voices` | `voices.json` | 10 voix : `fr-essais-21-22` (catalogue) + 9 `created` |
| `POST /tts` figé | `timings.json`, `figee-image-rocm.wav` | 39,2 s de requête (chargement de Base compris, premier usage) pour 6,24 s d'audio, WAV PCM 16 bits 24 kHz mono ; `compose up` 67,3 s (init des volumes compris) |
| Transcription | `transcribe_wer.py` → `wer.json` | faster-whisper small : « Le serveur tourne dans son image sans réseau et lit cette phrase avec la voix figée. » WER 0,0 |
| Tests serveur | `python3 -P deploy/qwen3/test_server.py` | 96 tests OK |
| Scripts | `shellcheck -S warning deploy/qwen3/*.sh`, `docker compose config -q` (rocm, cuda) | vert |
| Publication | `deploy/qwen3/publish.sh` (à blanc) | trois `docker push` affichés, rien poussé |

Mode jeu : `$XDG_RUNTIME_DIR/gpu-yield/active` absent avant le test (le dossier existe, vide). Aucun son joué.
`deploy-qwen3-1` et `deploy-kyutai16-1` ne tournaient pas : rien arrêté. Conteneurs de test arrêtés
(`llm-voice-qwen3-test-*`, Exited 0), volumes `llm-voice-qwen3-test_*` conservés.

## Deviations

- Trois échecs de construction corrigés : CUDA via l'index download.pytorch.org (dépendance sans roue, puis
  empreintes de typing_extensions refusées) → roues PyPI (construction cu128) ; ROCm : `sox` 1.5.0 n'existe
  qu'en source et importe numpy (pip 22) → numpy puis `--no-build-isolation` ; `libgomp1` manquant à
  l'import de torch → couche apt dédiée. Journaux `build-*-echec.log`, `build-rocm-2-sans-libgomp.log`.
- Image ROCm plus lourde qu'espéré (bibliothèques ROCm complètes pour toutes les architectures, hipblaslt
  ~1,6 Go de paquet) ; pas d'élagage par architecture pour rester portable.
- Variante CUDA NON TESTÉE sur GPU (aucune carte NVIDIA) : seule la construction et l'import sont prouvés.
- Choix rocm/cuda par profils compose (`COMPOSE_PROFILES`) et non par une seule variable : les
  périphériques diffèrent.
- Port publié 127.0.0.1 (vérifié par `docker compose config`, `QWEN3_PORT=8031`) mais non sollicité pendant
  le test : le serveur testé tournait sans réseau, requêtes par `docker exec`.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
