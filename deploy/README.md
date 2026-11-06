# Services TTS locaux — `docker-compose.tts.yml`

Quatre services indépendants (ADR-009). Aucun port publié hors `127.0.0.1`.

| Service | Profil | Rôle | Port |
|---|---|---|---|
| `chatterbox` | (défaut) | TTS principal, GPU ROCm (RDNA4/gfx1201) | 8004 |
| `ollama` | `ollama` | Narrateur, **optionnel** (déjà natif sur cette machine) | 11434 |
| `piper` | `light` | TTS niveau 1b, CPU seul, sans GPU | 5000 |
| `kyutai16` | `kyutai16` | Kyutai TTS 1.6B, voix de narration, GPU ROCm | 8020 |

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

## Kyutai narration (`kyutai16`, Kyutai TTS 1.6B)

```bash
mkdir -p "$XDG_RUNTIME_DIR/gpu-yield"   # sans gpu-yield installé : le dossier doit tout de même exister
docker compose -f deploy/docker-compose.tts.yml --profile kyutai16 up -d kyutai16
```

Nommer le service suffit à Compose pour activer son profil : la galerie affiche donc
`docker compose -f deploy/docker-compose.tts.yml up -d kyutai16`, équivalent. Un simple
`docker compose up`, sans nom de service, ne démarre jamais `kyutai16`.

Prérequis : l'image `deploy-chatterbox:latest` (construite par le service
`chatterbox`, réutilisée sans modification) et `~/.llm-voice/voices-lab/kyutai-1.6b/`
contenant `extras/` (moshi 0.2.11) et `hf/` (poids et voix en cache). Tout est monté
en lecture seule et rien n'est téléchargé à l'exécution (`HF_HUB_OFFLINE=1`).

Ce qu'il faut savoir :

- **Il partage le GPU.** Environ 4,3 Go de VRAM dès la première synthèse (mesure du
  banc, facteur temps réel 0,92 sur RDNA4), gardés jusqu'à l'arrêt du service ou au mode jeu.
  Chatterbox, Ollama et un jeu se disputent la même mémoire : arrêter ce qui ne sert pas.
- **Mode jeu.** Si `$XDG_RUNTIME_DIR/gpu-yield/active` existe, `POST /tts` répond 503,
  le modèle n'est pas chargé et s'il l'était, il est libéré. Une synthèse en cours
  s'arrête à la trame suivante. `/health` continue de répondre. Aucun contournement.
- **Le paquet moshi est hors contrat sur torch 2.9.** moshi 0.2.11 déclare
  `torch<2.8`, l'image embarque torch 2.9 ROCm : il est donc installé à côté, sans ses
  dépendances, et monté par `PYTHONPATH`. La synthèse a été mesurée sur le banc
  (`scripts/voice-lab/kyutai16.py`), mais une mise à jour de l'image ou de moshi
  n'a aucune garantie de compatibilité : refaire la preuve audio à chaque changement.
- **Local seulement.** Le port n'est publié que sur `127.0.0.1`. Dans le conteneur,
  le serveur écoute `0.0.0.0` (`KYUTAI16_HOST`), condition pour que la publication
  Docker le joigne ; lancé hors conteneur, il écoute `127.0.0.1`. Il refuse tout `Host`
  autre que cette machine et toute requête portant un `Origin`, et ne journalise
  jamais le texte, seulement sa longueur.
- **Pas de redémarrage automatique** (`restart: "no"`) : à relancer soi-même.

API, identique à Pocket TTS pour `KyutaiPocketProvider` : `GET /health`, `GET /voices`,
`POST /tts` (formulaire `text`, `voice_url` = identifiant du catalogue, 5000 caractères
au plus, voix par défaut `cml-577_394`, Camille). Une synthèse à la fois, les suivantes
attendent dans l'ordre ; se déconnecter annule. Tests, sans GPU : `python3 deploy/kyutai16/test_server.py`.

Les voix viennent de `kyutai/tts-voices` : CML-TTS (CC BY 4.0) et Estelle (CC0).
L'accent des voix CML-TTS et le consentement au clonage de leurs locuteurs ne sont pas
documentés : aucun échantillon n'est livré dans le VSIX.
