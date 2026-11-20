# Agentic Evidence Pack

## Summary

- Task id: GAO-moteur-qwen3-001
- Profile: controlled
- Outcome: Moteur Qwen3 : serveur local hors ligne, voix figée et voix jouée — critères : AC-001 test: serveur Qwen3 local répond avec --network none et gpu-yield respecté, preuve réelle en audio; AC-002 gate: grimoire standard gate check --strict vert
- Final state: in_progress (2026-11-07)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD 27470e4 | git rev-parse --short HEAD | référence (2026-11-07) |
| Serveur, catalogue, tests | `deploy/qwen3/server.py`, `deploy/qwen3/voices.json`, `deploy/qwen3/test_server.py` | backend-engineer | 80 tests verts (hôte 3.14 et image 3.10) |
| Service compose | `deploy/docker-compose.tts.yml` (`qwen3`, profil `qwen3`, 127.0.0.1:8021) | backend-engineer | démarré par `compose run --service-ports`, `/health` seul |
| Preuve réelle GPU | `proof_real.py` → `proof-real.json`, `phase{A,B,C}-container.log`, 9 WAV (ignorés par git) | backend-engineer | toutes les étapes vertes, voir ci-dessous |
| Premier passage | `proof-run1-compteur-global.json` | backend-engineer | écarté pour la VRAM : Ollama allait et venait, compteur global seul |
| Transcription | `transcribe_wer.py` → `wer.json` | faster-whisper small, CPU, hors ligne | WER 0 ou 0,125 |

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Tests, hôte | `python3 -P deploy/qwen3/test_server.py` | exit 0 : 80 tests, 32 s | Python 3.14, faux moteur |
| Tests, image | `docker run --rm --network none --user 1000:1000 -v deploy:/repo/deploy:ro --entrypoint python deploy-chatterbox:latest /repo/deploy/qwen3/test_server.py` | exit 0 : 80 tests, 1 ignoré (node absent) | Python 3.10 |
| Mutations | 21 mutants du serveur (contrôle de jeu retiré, texte journalisé, Origin ignoré, bascule supprimée, crochet d'annulation neutralisé, graine ignorée…) | 21/21 tués | script hors dépôt, scratchpad `mutate.py` |
| Compose | `config`, puis `compose run --rm --no-deps --service-ports -d qwen3` | port `127.0.0.1:8021` seul ; `/health` 200 `unloaded` ; Host étranger 403 ; Origin 403 ; IP du réseau local : refusé ; user 1000:1000, cap_drop ALL, restart no ; `deploy-kyutai16-1` inchangé (même StartedAt) | aucune charge GPU |
| Hors ligne | conteneur de preuve `--network none` | interfaces `['lo']` seulement ; aucun téléchargement | |
| Voix figée | 2 phrases | 3,52 s et 4,16 s d'audio, RTF 2,66 puis 1,97 | WER 0 et 0,125 |
| Voix jouée | 2 phrases, consigne « spontaneous conversation » | 4,16 s et 4,72 s, RTF 1,93 et 1,99 | WER 0 et 0,125 |
| Graine | même texte et même consigne, après rechargement, bascule ou annulation | WAV identiques octet pour octet (sha256 `ecfe3b0d…`, `b8c861c8…`, `aedd328d…`) | |
| VRAM par processus (KFD) | Kyutai 5011 Mio à côté, Ollama absent | Base chargé 4638 ; après phrase 5666 ; les deux chargés 8874 ; pic 9882 ; carte 16132/16304 au plus haut ; pire ordre (phase C) sans manque de mémoire | sondage Kyutai à ce moment : 200 en 3,0 s |
| Bascule forcée | seuil 999999 Mio | `model_swapped_out frozen memory_low` ; 4638 → 4650 Mio (un seul modèle) | |
| Annulation réelle | client parti à 4,0 s sur un texte de 299 caractères | journal `499` en 4,08 s ; la requête suivante passe | |
| Mode jeu (drapeau de TEST dans le conteneur) | posé 5 s après le début d'une synthèse | 503 `gpu_yield` en 0,24 s ; modèles libérés : 4650+ → 864 Mio ; pendant le jeu `/tts` figée, jouée, `/load` : 503 immédiat, VRAM inchangée ; après : la voix revient | vrai drapeau jamais posé, jamais vu |
| Confidentialité | journaux des 3 conteneurs | aucun mot des phrases ni de la consigne | |
| WER | `wer.json` | 0 sur la phrase 1 (5 fichiers), 0,125 sur la phrase 2 (4 fichiers) | seul écart : « leurs livres » entendu « leur livre », homophones |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | yes | enveloppe, ce pack, carte passée en needs_verification | clôture humaine |
| Quality | yes | 80 tests, 21 mutants tués, image et hôte | |
| Runtime | yes | preuve GPU réelle hors ligne, compose démarré | conteneur compose non chargé sur GPU |
| Knowledge | yes | API lue dans `qwen_tts/inference/qwen3_tts_model.py` et `modeling_qwen3_tts.py` | |
| Model/provider | yes | aucun service distant ; HF_HUB_OFFLINE forcé ; `--network none` | |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| `POST /load` sans paramètre charge la voix figée ; `?mode=played` pour l'autre | contrat Kyutai inchangé | Non accepté à ce jour : à arbitrer | intégration dans l'extension |
| Retrait de `[Cough]`, `[Sigh]`, `[Laughter]` et des jetons `<\|…\|>` côté serveur | la voix figée ne les prononce plus ; un texte qui n'en contient que d'autres est intact | Non accepté à ce jour : à arbitrer | autres balises relevées au banc |
| Seuil 3000 Mio pour garder les deux modèles | à côté de Kyutai les deux restent (carte à 99 %) ; avec Ollama chargé, bascule | Non accepté à ce jour : à arbitrer | coupure ou ralentissement constaté |
| En mode jeu, 864 Mio restent au processus après libération | contexte du runtime GPU ; tout part à l'arrêt du service | Non accepté à ce jour : à arbitrer | jeu gêné |
| Première phrase plus lente (RTF 2,66 contre ~1,97) | latence au premier son | Non accepté à ce jour : à arbitrer | |
| Code repris de `kyutai16/server.py` sans partage | correctifs à porter deux fois | Non accepté à ce jour : à arbitrer | prochain correctif commun |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.
