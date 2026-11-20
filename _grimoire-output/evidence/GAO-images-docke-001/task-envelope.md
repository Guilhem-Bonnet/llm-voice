# Agentic Task Envelope

## Task

- Task id: GAO-images-docke-001
- Request: Images Docker Qwen3 : serveur ROCm et CUDA, modèles et voix en image séparée
- Owner agent: guilhem-bonnet (exécution : ops-engineer / Forge, skills infra-pipeline-cicd, infra-security-hardening)
- Profile: controlled
- Current state: `executing`
- Risk level: `medium`

## Ambiguïtés résolues

| Question posée | Résolution | Source (contexte vérifié / question ciblée / hypothèse) |
|---|---|---|
| Où vit `voices.json` dans l'image ? | `server.py` le lit à côté de lui (`HERE / "voices.json"`) : `/srv/qwen3/voices.json` est un lien vers `/lab/refs/voices.json`, fourni par l'image de données ; code inchangé | Contexte vérifié : `server.py` ligne 277 |
| Quelles bibliothèques ROCm ? | Roues torch « lw » d'AMD : elles lient `/opt/rocm-7.2.3/lib` ; paquets apt d'exécution seulement, pas `rocm-dev` | Contexte vérifié : `ldd libtorch_hip.so` dans `deploy-chatterbox:latest` |
| Choix rocm / cuda | Profils compose `rocm` / `cuda` (`COMPOSE_PROFILES`), services `qwen3` / `qwen3-cuda` | Hypothèse d'implémentation : les périphériques diffèrent, une variable seule ne suffit pas |
| Licence des poids | Fiche des modèles : `license: apache-2.0` ; texte Apache-2.0 repris de `qwen_tts` (dist-info) | Contexte vérifié : README des snapshots |
| `publish.sh` | À blanc par défaut, `--push` pour pousser ; jamais exécuté avec `--push` ici | Brief : ne rien publier |

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Context bundle | _grimoire-output/context/GAO-images-docke-001/context-bundle.yaml | généré par le kit | 2026-11-20 | n/a |
| Service actuel | `deploy/docker-compose.tts.yml` profil `qwen3`, `deploy/qwen3/server.py` | contrat à préserver | 2026-11-20 | n/a |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| `_grimoire/_memory/shared-context.md` | read | état du projet | lu le 2026-11-20 |
| Mémoire « mode jeu gpu-yield » | read | jamais de charge GPU pendant un jeu | drapeau vérifié avant le test GPU |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| `docker build` | execute | trois images locales | téléchargement des images de base et paquets pip/apt publics seulement |
| `docker compose -p llm-voice-qwen3-test` | execute | test ROCm | projet, volumes et conteneurs distincts ; `network_mode: none` |
| `~/.llm-voice/tools/audio-proof-venv/bin/python -I` | execute | faster-whisper, WER | CPU, hors ligne |
| Interdits du brief | none | publication, `git push`, Hugging Face, son joué, `vscode-extension/`, arrêt de Kyutai | aucune exception |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation | Anthropic | sous-agent ops-engineer | aucun | fichiers locaux |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | Brief du 2026-11-20 ; hypothèses ci-dessus | done |
| Implementation complete | `deploy/qwen3/Dockerfile.*`, scripts, `deploy/docker-compose.qwen3.yml`, README | done |
| Validation complete | evidence-pack « Validation » | done |
| Deviations documented | evidence-pack « Deviations » | done |
