# Services TTS locaux — `docker-compose.tts.yml`

Cinq services indépendants (ADR-009). Aucun port publié hors `127.0.0.1`.

| Service | Profil | Rôle | Port |
|---|---|---|---|
| `chatterbox` | (défaut) | TTS principal, GPU ROCm (RDNA4/gfx1201) | 8004 |
| `ollama` | `ollama` | Narrateur, **optionnel** (déjà natif sur cette machine) | 11434 |
| `piper` | `light` | TTS niveau 1b, CPU seul, sans GPU | 5000 |
| `kyutai16` | `kyutai16` | Kyutai TTS 1.6B, voix de narration, GPU ROCm | 8020 |
| `qwen3` | `qwen3` | Qwen3-TTS 1.7B, voix figée et voix jouée, GPU ROCm | 8021 |

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

## Qwen3-TTS, voix figée et voix jouée (`qwen3`)

```bash
mkdir -p "$XDG_RUNTIME_DIR/gpu-yield"   # comme pour kyutai16
docker compose -f deploy/docker-compose.tts.yml up -d qwen3
```

Prérequis : l'image `deploy-chatterbox:latest` et `~/.llm-voice/voices-lab/qwen3/` contenant
`extras/` (`qwen_tts` 0.1.1 et ses dépendances), `hf/` (Qwen3-TTS 12Hz 1.7B Base et VoiceDesign,
Apache-2.0) et les extraits de référence. Tout est monté en lecture seule, rien n'est téléchargé.

Deux façons de dire un texte, sur le même `POST /tts` :

- **voix figée**, sans champ `direction` : modèle Base, clonage depuis les extraits de la voix.
  Stable d'une phrase à l'autre, mais aucune consigne de jeu. Elle prononcerait `[Cough]`,
  `[Sigh]` ou `[Laughter]` comme des mots : le serveur les retire avant de lui donner le texte ;
- **voix jouée**, avec `direction` (consigne libre en anglais, 500 caractères au plus) : modèle
  VoiceDesign. La consigne se place entre la description et l'accent de la voix du catalogue :
  `Young adult woman, medium pitch, clear diction. <direction> Native French speaker with a standard metropolitan France accent.`

Les deux tirent la graine de la voix (11) : même texte, même consigne, même son, octet pour octet.

**Changer la voix figée** se fait dans `deploy/qwen3/voices.json`, sans toucher au code :
`frozen_refs` liste les extraits, chemins relatifs à `~/.llm-voice/voices-lab/qwen3/`
(monté en `/lab/refs`). La transcription vient du champ `text`, ou sinon du `.json` posé à côté du
`.wav`. Relancer le service ensuite. L'entrée actuelle, `fr-essais-21-22`, est la voix choisie à l'écoute le 2026-11-07 :
`out-gao/rire-en-s11.wav` et `chuchote-en-s11.wav` (extraits 21 et 22 des essais). Aucun extrait
n'entre dans le dépôt. Un extrait absent rend la voix figée indisponible (503), pas le service.

**Créer une voix** (voix des personnages) : `POST /voices/create`, formulaire `name` (1 à 40
caractères), `description` (anglais, ASCII seulement, 1 à 300 caractères, par exemple
`Older man, deep low voice, slow and grave.`) et `sample_text` optionnel (français). Le serveur génère un
extrait avec VoiceDesign, tire une graine qu'il garde, et répond 201 `{id, name, description, seed,
sample_seconds}` en 13 à 33 s ; 400 si invalide, 409 si le nom existe déjà (casse et espaces ignorés), 503
en mode jeu. L'identifiant (`v-` + 10 caractères) vient toujours du serveur. La voix est encodée pour le
modèle Base à sa première lecture figée (environ 28 s cette fois-là). `GET /voices` donne `origin`
(`catalogue` ou `created`) et `description` ; `GET /voices/<id>/sample` rend l'extrait d'écoute.

Les voix créées vivent dans `~/.llm-voice/voices-lab/qwen3/created/<id>/` (`sample.wav`, `voice.json`),
seul dossier monté en écriture (`/lab/refs/created`) ; elles survivent au redémarrage. Jeu de départ, à
lancer une fois, service démarré : `python3 -P deploy/qwen3/create_starter_voices.py` (8 voix : jeune
femme claire, femme mûre posée, femme âgée chaleureuse, jeune homme vif, homme mûr grave, homme âgé
rauque, voix d'enfant, voix androgyne douce). Pas de suppression depuis le service.

Ce qu'il faut savoir :

- **Chargement.** Chaque modèle se charge à son premier usage, ou d'avance par `POST /load`
  (voix figée) et `POST /load?mode=played`. Mesuré : 14 à 19 s pour Base avec l'encodage des
  extraits, 3 à 6 s pour VoiceDesign quand les fichiers sont déjà en cache disque.
  `/health` répond pendant ce temps (`state: loading`) et dit quels modèles sont prêts (`models`).
- **Vitesse.** Environ 2 s de calcul par seconde d'audio : le client doit préparer la phrase
  suivante pendant que la précédente se lit.
- **Mémoire du GPU.** Mesuré par processus sur RX 9070 (16 Gio), Kyutai chargé à côté (4,9 Gio) :
  Base seul 4,5 Gio, 5,5 Gio une fois une phrase dite ; les deux modèles 8,7 Gio chargés, 9,7 Gio
  au plus fort. Ils tiennent ensemble, mais avec Kyutai et le bureau la carte monte à 99 %
  (16 132 Mio sur 16 304) : aucun manque de mémoire mesuré, sans marge pour un autre programme. Avant de charger le second modèle, le serveur lit la
  mémoire libre de la carte : sous 3000 Mio (`QWEN3_MIN_FREE_VRAM_MB`), ou si elle est illisible,
  il décharge le premier. Un manque de mémoire au chargement ou pendant une synthèse fait de même,
  puis réessaie une fois. Passer d'un modèle à l'autre coûte alors un rechargement.
  Ollama et un jeu se disputent la même mémoire.
- **Mode jeu**, **local seulement**, **pas de redémarrage automatique** : comme `kyutai16`,
  y compris l'annulation quand le client part (vérifiée à chaque trame) et la libération
  des deux modèles. Il reste environ 0,85 Gio au processus en mode jeu (contexte du runtime GPU,
  mesuré) : seul l'arrêt du service rend tout. Ni le texte ni la consigne ne sont jamais journalisés, seulement leur longueur.

Tests, sans GPU : `python3 -P deploy/qwen3/test_server.py`. Preuve réelle sur le GPU, hors ligne :
`_grimoire-output/evidence/GAO-moteur-qwen3-001/proof_real.py`.
