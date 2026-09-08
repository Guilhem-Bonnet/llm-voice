# Services TTS locaux — `docker-compose.tts.yml`

Trois services indépendants (ADR-009). Aucun port publié hors `127.0.0.1`.

| Service | Profil | Rôle | Port |
|---|---|---|---|
| `chatterbox` | (défaut) | TTS principal, GPU ROCm (RDNA4/gfx1201) | 8004 |
| `ollama` | `ollama` | Narrateur, **optionnel** (déjà natif sur cette machine) | 11434 |
| `piper` | `light` | TTS niveau 1b, CPU seul, sans GPU | 5000 |

## Prérequis

- Docker 24+ / Compose v2, noyau avec pilote `amdgpu` chargé.
- `/dev/kfd` et `/dev/dri` présents ; utilisateur avec accès (le conteneur
  tourne en root, donc surtout : GID `video`/`render` corrects dans
  `group_add`, cf. `.env.example`).
- ROCm ≥ 7.2 dans l'image (construite depuis `Dockerfile.rdna4`) — **pas**
  besoin de ROCm côté hôte, seulement le pilote noyau.
- **Ne pas** positionner `HSA_OVERRIDE_GFX_VERSION` : gfx1201 est natif sur
  ROCm 7.2+, le forcer peut provoquer des plantages (linux-first-v1.md §2).

## Premier lancement

```bash
cp deploy/.env.example deploy/.env   # ajuster les GID (getent group video render)
mkdir -p ~/.llm-voice/models/chatterbox
cp deploy/tts/config.yaml ~/.llm-voice/models/chatterbox/config.yaml
docker compose -f deploy/docker-compose.tts.yml --env-file deploy/.env up chatterbox
```

Le premier démarrage télécharge Chatterbox Multilingual V3 (plusieurs Go)
depuis Hugging Face — normal, une seule fois, coupé par
`HF_HUB_DISABLE_TELEMETRY=1`/`DO_NOT_TRACK=1` (jamais de télémétrie). Attendre
le healthcheck (`docker compose ps`, colonne `STATUS`).

## Mode hors-ligne

Après le premier téléchargement réussi, passer `HF_HUB_OFFLINE=1` dans
`deploy/.env` puis relancer : plus aucun appel réseau vers Hugging Face, y
compris le HEAD de vérification de version (local-guarantee-v1.md §1 pt 12).

## Repli CPU (pas de GPU/ROCm exploitable)

```bash
CHATTERBOX_DEVICE=cpu docker compose -f deploy/docker-compose.tts.yml up chatterbox
```

Prouve la chaîne bout en bout (contrat HTTP, WAV valide) sans exploiter le
GPU — latence nettement plus élevée, attendu.

## Ollama conteneurisé (optionnel)

Seulement si l'Ollama natif (`:11434`) n'est pas préféré :

```bash
docker compose -f deploy/docker-compose.tts.yml --profile ollama up -d ollama
```

## Piper (niveau 1b, CPU)

```bash
docker compose -f deploy/docker-compose.tts.yml --profile light up piper
```

Télécharge `fr_FR-siwis-medium` (~60 Mo) dans `~/.llm-voice/models/piper/` au
premier lancement, puis fonctionne hors-ligne.

## Vérification

```bash
curl -s http://127.0.0.1:8004/api/ui/initial-data | head -c 200   # Chatterbox
curl -s http://127.0.0.1:11434/api/version                          # Ollama
curl -s http://127.0.0.1:5000/health                                 # Piper
curl -s -X POST http://127.0.0.1:8004/v1/audio/speech \
  -H 'content-type: application/json' \
  -d '{"input":"Bonjour.","response_format":"wav"}' -o /tmp/test.wav
```
