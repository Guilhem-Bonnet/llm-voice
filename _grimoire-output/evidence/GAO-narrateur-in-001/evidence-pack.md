# Agentic Evidence Pack

## Summary

- Task id: GAO-narrateur-in-001
- Profile: controlled
- Outcome: Installation de `qwen2.5:7b` (modèle Ollama par défaut du narrateur) sur la machine dev, absent au 2026-09-27, et preuve de santé de la chaîne narrateur — critères : `ollama list` contient `qwen2.5:7b`, `POST /api/chat` (format JSON Schema `narration-segments`) renvoie un JSON valide, gate `--strict` vert.
- Final state: implementation + validation complete (2026-09-27)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Espace disque disponible avant pull | `df -h ~` | ops-engineer | `/dev/nvme0n1p3 1,9T 713G 1,2T 39% /home` — 1,2 To libres, largement suffisant pour ~4,7 Go |
| État initial du registre local | `ollama list` (avant pull) | ops-engineer | absence confirmée de `qwen2.5:7b` (présents : `qwen2.5:3b`, `qwen2.5:1.5b`, `gpt-oss:20b`, `nomic-embed-text`, `grimoire-coder`, `qwen3-coder:30b`, `qwen3-coder-next`) |
| Pull du modèle | `ollama pull qwen2.5:7b` (arrière-plan) | ops-engineer | `success`, manifest écrit, exit code 0 |
| État final du registre local | `ollama list` (après pull) | ops-engineer | `qwen2.5:7b 845dbda0ea48 4.7 GB` présent, `4 seconds ago` |
| Requête structurée `POST /api/chat` | `curl` vers `http://127.0.0.1:11434/api/chat`, payload = `payload.json` (même schéma et system prompt que `OllamaNarrator.transform`) | ops-engineer | `response.json` : HTTP 200, `message.content` = JSON valide et conforme au schéma `narration-segments` |
| Validation du parsing | script Python (`json.loads` sur `message.content` + assertions de forme : `sourceIds` non vide, `spokenText` non vide, couverture des deux blocs) | ops-engineer | `VALID: segments= 1 covered= ['BLOCK_001', 'BLOCK_002']` |

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Commandes exécutées et sorties brutes

### 1. Espace disque

```
$ df -h ~
Sys. de fichiers Taille Utilisé Dispo Uti% Monté sur
/dev/nvme0n1p3     1,9T    713G  1,2T  39% /home
```

### 2. `ollama list` avant pull

```
NAME                       ID              SIZE      MODIFIED
gpt-oss:20b                17052f91a42e    13 GB     3 months ago
nomic-embed-text:latest    0a109f422b47    274 MB    3 months ago
qwen2.5:3b                 357c53fb659c    1.9 GB    3 months ago
qwen2.5:1.5b               65ec06548149    986 MB    3 months ago
grimoire-coder:latest      66fa777dc537    18 GB     5 months ago
qwen3-coder:30b            06c1097efce0    18 GB     5 months ago
qwen3-coder-next:latest    ca06e9e4087c    51 GB     5 months ago
```

### 3. `ollama pull qwen2.5:7b`

Exécuté en arrière-plan (téléchargement ~4,7 Go). Fin de sortie (tronquée, barre de progression retirée) :

```
pulling manifest
pulling 2bada8a74506: 100% ▕████████████████▏ 4.7 GB
writing manifest
success
[exited with code 0]
```

### 4. `ollama list` après pull

```
NAME                       ID              SIZE      MODIFIED
qwen2.5:7b                 845dbda0ea48    4.7 GB    4 seconds ago
gpt-oss:20b                17052f91a42e    13 GB     3 months ago
nomic-embed-text:latest    0a109f422b47    274 MB    3 months ago
qwen2.5:3b                 357c53fb659c    1.9 GB    3 months ago
qwen2.5:1.5b               65ec06548149    986 MB    3 months ago
grimoire-coder:latest      66fa777dc537    18 GB     5 months ago
qwen3-coder:30b            06c1097efce0    18 GB     5 months ago
qwen3-coder-next:latest    ca06e9e4087c    51 GB     5 months ago
```

### 5. Requête `POST /api/chat` — forme identique à `OllamaNarrator.transform`

Payload (`payload.json`, reconstruit à l'identique de `OllamaNarrator.ts` + `narrationContract.ts` + `parseNarration.buildBlockPrompt`) :
- `model: "qwen2.5:7b"`, `stream: false`
- message système = `narrationSystemPrompt()` sans style (juste la consigne de mapping BLOCK_xxx → JSON)
- message utilisateur = `buildBlockPrompt` sur deux segments français courts : `BLOCK_001` « Le chat dort sur le canapé. » et `BLOCK_002` « Il fait beau aujourd'hui. »
- `format` = `NARRATION_JSON_SCHEMA` exact (`{segments:[{sourceIds:[string,...],spokenText:string}]}`)
- `options: {}`

Commande et mesure de latence :

```
$ curl -sS -w '\n__TIME_TOTAL__=%{time_total}\n' -X POST http://127.0.0.1:11434/api/chat \
    -H 'content-type: application/json' -d @payload.json -o response.json -D headers.txt

HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Date: Sun, 27 Sep 2026 22:30:30 GMT

__TIME_TOTAL__=11.469223
```

Réponse brute (`response.json`) :

```json
{"model":"qwen2.5:7b","created_at":"2026-09-27T22:30:30.19827674Z","message":{"role":"assistant","content":"{\"segments\":[{\"sourceIds\":[\"BLOCK_001\",\"BLOCK_002\"],\"spokenText\":\"Le chat dort sur le canapé. Il fait beau aujourd'hui.\"}]}"},"done":true,"done_reason":"stop","total_duration":11468913132,"load_duration":4961231139,"prompt_eval_count":173,"prompt_eval_duration":1745984928,"eval_count":39,"eval_duration":3746801355}
```

Latence totale mesurée : **11,47 s** (dont `load_duration` ≈ 4,96 s de chargement du modèle en mémoire — première requête après le pull, cold start ; `eval_duration` ≈ 3,75 s de génération).

### 6. Validation du contenu structuré

```
$ python3 -c "..." (json.loads sur message.content + assertions de forme)
VALID: segments= 1 covered= ['BLOCK_001', 'BLOCK_002']
```

`message.content` est un JSON valide, conforme au schéma `narration-segments` : un segment avec `sourceIds: ["BLOCK_001", "BLOCK_002"]` (regroupement autorisé par la consigne du system prompt) et `spokenText` non vide couvrant les deux blocs source.

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| AC1a — modèle présent | `ollama list` | vert | `qwen2.5:7b 845dbda0ea48 4.7 GB` |
| AC1b — `POST /api/chat` JSON valide | `curl` + `json.loads` + assertions de schéma | vert | segments non vides, `sourceIds`/`spokenText` conformes, couverture des deux blocs |
| AC2 — gate check --strict | `grimoire standard gate check --task-id GAO-narrateur-in-001 --strict` | à exécuter par l'orchestrateur après ce pack | voir section suivante |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | yes | task-envelope.md, carte de ledger `GAO-narrateur-in-001` | — |
| Quality | yes | validation JSON par script, latence mesurée | — |
| Runtime | yes | requête réelle contre Ollama natif `127.0.0.1:11434` v0.21.0, pas de simulation | — |
| Knowledge | yes | forme de requête relue directement dans `OllamaNarrator.ts`/`narrationContract.ts`/`parseNarration.ts` (lecture seule, aucune modification) | — |
| Model/provider | yes | modèle par défaut du réglage `llmVoice.narrator.model` installé et testé localement | — |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Hook post-write a suggéré d'ajouter une preuve à `_grimoire-output/evidence/GAO-diagnostic-s-001/evidence-pack.md` | non appliqué — la consigne de dispatch interdit explicitement de toucher un autre dossier de preuve | ops-engineer (choix documenté ici) | si l'orchestrateur souhaite cette entrée croisée, à faire depuis la tâche `GAO-diagnostic-s-001` elle-même |
| Latence mesurée (11,47 s) inclut un cold start (`load_duration` ≈ 4,96 s) | latence en usage réel narrateur probablement plus faible une fois le modèle chargé en mémoire (résident Ollama) | non mesuré ici — hors périmètre de cette tâche | mesurer une deuxième requête à froid si le narrateur en production montre une latence perçue excessive |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification. Fermeture de la carte (`task close`, `task move`) laissée à l'orchestrateur, conformément au périmètre de dispatch.
