# Pack de preuve — GAO-conversion-d-001

## Tests (lus)
- `python3 -P deploy/vc/test_server.py` → `Ran 29 tests … OK` (`test-vc.txt`).
- `python3 -P deploy/qwen3/test_server.py` → `Ran 113 tests … OK` (`test-qwen3.txt`; 96 avant, +17 : conversion, repli, résolution bornée, catalogue, compose).
- `docker compose -f deploy/docker-compose.tts.yml --profile qwen3 config --quiet` → OK.

## Poids
- `bash deploy/vc/prepare-weights.sh` → 2490 tenseurs, `~/.llm-voice/models/chatterbox-vc/{s3gen.safetensors,conds.pt,ve.pt}` ; sha256 de `s3gen.safetensors` identique à celui de l'essai écouté (`fce6ae1147836ca28ad3…`). Conteneur `--network none`, non-root.

## Réel (compose, RX 9070 16 Go, Kyutai arrêté, drapeau gpu-yield absent à chaque étape)
Requête : `POST /tts` joué, texte « Tu m'as menti depuis le début ! … », direction « Furious, shouting with anger, voice trembling with rage. » (`real_tts.py`, `tts-*.jsonl`).

| Fichier | En-tête | Mur (s) | Audio (s) | Conversion (journal) |
|---|---|---|---|---|
| kyu-yael-frozen.wav (figée) | absent | 37,76 (chargement Base) | 4,56 | — |
| kyu-yael joué 1 (écrasé par le 3) | yes | 46,87 (chargement VoiceDesign + VC) | 5,04 | 32,35 s (dont chargement 9,7 s) |
| kyu-loan-joue-converti.wav | yes | 12,25 | 4,96 | 2,45 s |
| kyu-yael-joue-converti.wav | yes | 12,31 | 5,04 | 1,83 s |
| `vc` arrêté, code initial : kyu-yael-joue-repli.wav | no | 18,76 | 5,04 | skipped `unreachable` en 7,84 s |
| idem kyu-loan-joue-repli.wav | no | 17,75 | 4,96 | skipped `unreachable` en 7,34 s |
| après correctif (résolution bornée) : kyu-yael-joue-repli-borne.wav | no | 17,47 | 5,04 | skipped `unreachable` en 1,0 s |
| kyu-loan-joue-repli-borne.wav | no | 10,20 | 4,96 | skipped `unreachable_recently` en 0,0 s |
| `vc` redémarré (+31 s) : kyu-yael-joue-converti-apres-redemarrage.wav | yes | 44,29 | 5,04 | 34,42 s (démarrage à froid) |

Aucune erreur côté client en repli (200 + `no`). Journaux : `service-log-qwen3*.jsonl`, `service-log-vc.jsonl` (durées et tailles seulement).

## Langue et transcription (faster-whisper large-v3, CPU int8, détection libre — `langue-transcription.json`)
- kyu-yael converti : fr 0,998 ; kyu-loan converti : fr 0,997 ; replis : fr 0,994 / 0,996 ; transcriptions exactes au texte près (ponctuation).
- Essoufflé `fr-essais-21-22` : avant fr 1,000 / en 0,000 ; après fr 1,000 / en 0,000. **La détection de langue ne distingue pas l'accent** : cette mesure ne prouve ni la présence ni l'absence d'accent anglais. Conversion 2,63 s (aller-retour `docker exec`). Page : `~/Téléchargements/essouffle-converti.html` (1 avant, 2 après).

## VRAM (`vram.txt`, sysfs, carte 16 304 Mio)
- Avant chargement : 1 638 Mio ; figé seul : 7 668 ; figé + joué + VC chargés : 13 630 Mio ; `vc` arrêté : 11 351 ; état final (joué + VC) : 8 809.

## Isolement (`final-state.txt`)
- `deploy-vc-1` : réseau `deploy_tts-internal` seul, aucun port publié, uid 1000, `CapEff 0`, résolution de `example.com` impossible depuis le conteneur. `deploy-qwen3-1` : `127.0.0.1:8021`, réseaux default + tts-internal. Les deux `healthy` à la fin.

## Non prouvé
- Que la conversion retire l'accent anglais de l'essoufflé : écoute requise.
- Annulation réelle côté GPU d'une conversion quand le client part (prouvée avec le faux moteur seulement ; les points d'arrêt réels sont des hooks sur tokenizer/flow/estimator/mel2wav, vérifiés par un faux chatterbox).
- Mode jeu réel sur `vc` (503 + libération) : prouvé avec le faux moteur seulement, pas avec le drapeau réel.
