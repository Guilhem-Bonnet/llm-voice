# Agentic Evidence Pack

## Summary

- Task id: GAO-core-rust-mi-001 (étape A : démon Rust)
- Profile: controlled
- Outcome: crate `crates/llm-voice-core` (axum 0.7 + tokio) : `127.0.0.1:0`, jeton de session (32 alphanumériques CSPRNG, ou `LLM_VOICE_CORE_TOKEN` ≥ 16), `Host` ≠ `127.0.0.1|localhost:<port>` → 403, `Origin` non vide → 403, verrou `flock` `core.lock` + `core.json` `0600` (pid, port, token, protocolVersion), seconde instance → code 17, SIGTERM/SIGINT → arrêt propre et retrait de `core.json`. Routes `GET /health`, `POST /v1/{enqueue,play,pause,resume,stop,seek}`, `GET /v1/ws` ; événements `state`, `position` (~10 Hz), `segment_started`, `segment_ended`, `underrun`, `ended`, `error`, tous construits avec les types de `llm-voice-protocol`. `vscode-extension/` non touché. Rien de commité.
- Final state: prêt pour vérification (l'état de la carte n'est pas modifié par cet agent)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Démon | `crates/llm-voice-core/src/{main,lib,server,engine,events,lock,security}.rs` | backend-engineer | compile, clippy vert |
| Protocole | `crates/llm-voice-protocol/src/lib.rs` : `pub trait Validate`, `PROTOCOL_VERSION`, `is_supported_protocol_version`, `Serialize` sur réponses/événements, `skip_serializing_if` sur les champs optionnels (sinon `null`, refusé par les schémas) | backend-engineer | `contract_examples` 2/2 |
| Moteur | `crates/llm-voice-audio/src/player.rs` : `DrainTracker` (instant de fin estimé = callback + latence `cpal` + trames du dernier tampon, puis marge 250 ms), `output_latency()` ; `queue.rs` : `push` (repris de l'agent précédent) | backend-engineer | tests verts |
| Test corrigé | `queue::tests::push_after_ended_resumes_as_paused_not_stopped` : le test supposait `Ended` après un tampon de taille exactement égale au clip ; `Ended` n'est constaté qu'à la tentative de lire au-delà (même comportement que le callback). Test corrigé (tampon 1200 > 1000 trames), logique inchangée | backend-engineer | vert |
| Tests Core | `tests/security.rs` (7), `tests/playback.rs` (1), unitaires `lock`/`security`/`events` (7) | backend-engineer | 15/15 |
| Script de preuve | `scripts/audio-spike/core-play.sh` | backend-engineer | exit 0 |
| JSON du banc | `_grimoire-output/evidence/GAO-core-rust-mi-001/prove-core.json` | prove.sh | pass |

## Commandes exécutées (2026-09-28)

```
cargo test --workspace            → 27 passed, 0 failed (audio 7, audio-play 3, core 7+1+7, protocol 2)
cargo clippy --workspace --all-targets -- -D warnings   → Finished, 0 warning
cargo fmt --all --check           → exit 0
cargo build --release -p llm-voice-core
echo "Le démon natif lit cette phrase en entier, sans jamais couper le dernier mot." \
  | piper -m ~/.llm-voice/voices/fr_FR-siwis-medium.onnx --output_file <scratchpad>/core-proof.wav   # 3,959 s, 22050 Hz mono
bash scripts/audio-proof/prove.sh --play-cmd "bash scripts/audio-spike/core-play.sh" <scratchpad>/core-proof.wav \
  --expect "Le démon natif lit cette phrase en entier, sans jamais couper le dernier mot." --post-roll 2.5
  → exit 0
```

Sortie du banc (`prove-core.json`) :

```json
{"wer": 0.2143, "transcription": "Le démonatif lit cette frais en entier, sans jamais couper le dernier mot.", "duration_s": 5.944, "silence_max_ms": 1240.0, "rms": 0.135559, "silent": false, "wer_ok": true, "pass": true}
```

Trace `core-play.sh` (stderr) : `core.json` mode 600 ; `enqueue → {"protocolVersion":"1.0","ok":true}` ; `play → ok` ;
`ended → {"protocolVersion":"1.0","type":"ended","positionMs":3959,"totalDurationMs":3959}` ; reçus : 1 ended, 42 position, 1 segment_started, 1 segment_ended, 4 state, 1 underrun ;
`llm-voice-core : ended à 3959 ms, latence de sortie mesurée Some(0ns)`. Dernier mot « mot. » transcrit ; les deux erreurs de WER (« démonatif », « frais ») sont en milieu de phrase, pas en fin.

## Validation

| Exigence du brief | Preuve | Résultat |
|---|---|---|
| 401 sans jeton / jeton faux (6 routes), corps non-JSON | `commands_without_or_with_wrong_token_are_401` | vert |
| 403 `Origin` non vide (HTTP, `/health`, WS) | `any_non_empty_origin_is_403_even_with_a_valid_token` | vert |
| 403 `Host` étranger (rebinding DNS) | `foreign_host_header_is_403` | vert |
| WS : 401 sans jeton ou jeton faux, puis `state` courant à l'ouverture | `websocket_requires_the_token_and_then_sends_the_current_state` | vert |
| Réponses = exemples du contrat (`health.response.json`, `ack.response.ok.json`), erreurs validées `http/ack.response` ; `segment_not_found` 404, `invalid_protocol_version` 400, champ inconnu 400, `path_outside_cache` 403, `..` 400, `unsupported_format` 400 | `health_matches_contract_example`, `valid_commands_answer_like_the_contract_examples` | vert |
| Événements = exemples du contrat, octet sémantique près | `events::tests::events_match_contract_examples_exactly` | vert |
| Instance unique (code 17), `core.json` 0600, SIGTERM → exit 0 + `core.json` retiré, relance possible | `single_instance_state_file_and_clean_shutdown`, `lock::tests::*` | vert |
| Binaire + WAV enfilés + `ended` sur le WS ; ordre `segment_started`/`segment_ended`/`ended` ; `position` ≥ 4 Hz et monotone ; `ended` ≥ durée + 300 ms ; `state: ended` ensuite | `enqueue_two_wavs_play_and_receive_ended_on_the_websocket` (silence : rien d'audible) | vert |
| Phrase entière, dernier mot compris | banc `prove.sh` ci-dessus | exit 0, wer 0,2143 |

## Deviations

1. **Artefact du banc (constaté, non corrigé ici)** : `parecord` tué par `kill` perd son dernier fragment non livré. Au format natif Piper (22050 Hz mono), les captures font exactement 98 304 = 3 × 32 768 trames (4,458 s) avec le `--post-roll 1.0` par défaut : la fin de phrase manque **aussi avec le lecteur de référence `pw-play`** (même WAV : exit 1, « … couper le dernier », wer 0,2857). Avec `--post-roll 2.5` (option existante du banc), la capture fait 131 072 trames et contient la fin. La commande exacte du brief (post-roll par défaut) sort donc 1 avec le Core comme avec `pw-play` ; exit 0 obtenu avec `--post-roll 2.5`. Correctif proposé pour `prove.sh` (hors périmètre, outil partagé) : post-roll ≥ taille de fragment, ou `parecord --latency-msec=100`, ou arrêt par SIGINT. Ceci peut aussi expliquer une partie des troncatures mesurées au spike (CL-004 de GAO-spike-moteur-001) : à revérifier.
2. **Latence cpal nulle via pipewire-alsa** : `OutputCallbackInfo::timestamp` renvoie 0 ns ; la vidange repose donc, sur cette machine, sur la marge fixe de 250 ms après l'écriture du dernier échantillon. Mesuré suffisant (banc exit 0, dernier mot présent), non prouvé pour d'autres backends.
3. **Code d'erreur « requête mal formée »** absent du contrat v1 : le Core renvoie 400 + `internal_error` (champ inconnu, forme invalide). Proposition : ajouter `invalid_request` en v1.1 (contrat non modifié ici).
4. **Découpage HTTP/WS** du README du contrat confirmé à l'implémentation (commandes en HTTP avec jeton dans le corps, WS en événements seuls, jeton à l'ouverture par `?token=` ou `Authorization: Bearer`) — à journaliser dans `decisions-log.md`.
5. **Sémantique retenue** (doc de `engine.rs`) : `underrun` émis au début de toute file à sec en lecture (donc aussi avant chaque `ended`) ; un `enqueue` pendant une sous-alimentation ou après `ended` repart aussitôt ; `stop` vide la file et libère le périphérique ; `segment_ended` d'un segment non final à fin + 300 ms. À confronter au `NativeAudioSink` (étape B).
6. **PipeWire / WirePlumber** : après une première lecture sur les haut-parleurs, WirePlumber a réacheminé le flux `llm-voice-core` hors du sink nul (capture muette, rms 0). `core-play.sh` fixe `PIPEWIRE_NODE`, `PIPEWIRE_PROPS` (`node.dont-move`, nom inédit) en plus du sink par défaut basculé/restauré.
7. **Limites** : fichier d'état Linux (`/proc` retiré, `flock` via std, portable Unix ; Windows non traité) ; pas d'arrêt sur absence de client ni sur mort du parent (ADR-012 §5, non demandé à l'étape A) ; l'URL WS de `core-play.sh` porte le jeton en argument de `curl` (processus local éphémère, visible dans `ps` le temps de la lecture).
