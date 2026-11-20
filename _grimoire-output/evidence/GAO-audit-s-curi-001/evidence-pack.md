# Agentic Evidence Pack

## Summary

- Task id: GAO-audit-s-curi-001 (audit de sécurité offensif du démon local)
- Profile: controlled
- Outcome: suite d'attaque `scripts/security/core-attack.sh` construite et exécutée contre le binaire release réel `target/release/llm-voice-core`, dans un état/cache isolés (mktemp). 33 attaques. **28 refus conformes**, **2 failles confirmées** (F02 DoS mémoire, I01 pas d'arrêt sur mort du parent), **3 verdicts FAIL du banc réfutés après vérification** (C04, E03, G02 : artefacts de banc / assertions trop strictes ; les défenses fonctionnent). Aucune modification de code, aucun commit, l'état de la carte n'est pas changé.
- Final state: prêt pour vérification

## Cible

| Composant | Fichiers |
|---|---|
| Serveur | `crates/llm-voice-core/src/{server,security,lock,main,engine,events}.rs` |
| Client | `vscode-extension/src/playback/{CoreProcess,NativeAudioSink}.ts` |
| Contrat | `contracts/core-v1/**`, invariants `docs/adr/ADR-012-native-audio-core.md` §5-§6 |

## Suite d'attaque

`scripts/security/core-attack.sh` : compile le binaire release, démarre un Core isolé, lit `core.json`, lance 33 attaques loopback, imprime un tableau et sort non nul si une attaque attendue comme refusée ne l'est pas. Choix de conception : toutes les attaques sont exécutées puis le tableau est imprimé (audit complet), le code de sortie reste non nul en cas d'échec. Bornes de temps (`curl -m 8`) pour éviter que les contrôles WS réussis (upgrade 101, flux ouvert) ne bloquent.

## Tableau des attaques (exécution 2026-09-28)

```
ID     | Attaque                                        | Attendu                | Obtenu                 | Verdict
A01    | POST /v1/pause sans jeton                      | 401 invalid_token      | 401 invalid_token      | PASS
A02    | jeton faux même longueur                       | 401                    | 401                    | PASS
A03    | jeton longueur 31 (voisine)                    | 401                    | 401                    | PASS
A04    | jeton longueur 33 (voisine)                    | 401                    | 401                    | PASS
A05    | corps non-JSON (sans jeton)                    | 401                    | 401                    | PASS
A06    | 6 routes sans jeton -> 401                     | toutes 401             | ok                     | PASS
B-evil | Origin=http://evil.example + jeton valide      | 403 invalid_origin     | 403 invalid_origin     | PASS
B-null | Origin=null + jeton valide                     | 403 invalid_origin     | 403 invalid_origin     | PASS
B-file | Origin=file:// + jeton valide                  | 403 invalid_origin     | 403 invalid_origin     | PASS
C01    | Host: evil.example:PORT (rebinding)            | 403 invalid_host       | 403 invalid_host       | PASS
C02    | Host: 127.0.0.1 mauvais port                   | 403                    | 403                    | PASS
C03    | Host: attacker.tld (sans port)                 | 403                    | 403                    | PASS
C04    | HTTP/1.0 sans en-tête Host                     | 403                    | 403 (revérifié)        | PASS*
D01    | upgrade WS sans jeton                          | 401                    | 401                    | PASS
D02    | upgrade WS jeton faux                          | 401                    | 401                    | PASS
D03    | upgrade WS jeton valide + Origin               | 403                    | 403                    | PASS
D04    | upgrade WS jeton valide (contrôle)             | 101                    | 101                    | PASS
D05    | upgrade WS via Bearer (contrôle)               | 101                    | 101                    | PASS
E01    | enqueue /etc/passwd                            | 403 path_outside_cache | 403 path_outside_cache | PASS
E02    | enqueue lien symbolique -> /etc/passwd         | 403 path_outside_cache | 403 path_outside_cache | PASS
E03    | enqueue traversal ../../../etc/passwd          | refusé                 | 400 internal_error     | PASS*
E04    | enqueue fichier absent                         | 404 segment_not_found  | 404 segment_not_found  | PASS
E05    | enqueue fichier non-WAV                        | 400 unsupported_format | 400 unsupported_format | PASS
F01    | corps JSON 60 Mo                               | 413 (limite)           | 413                    | PASS
F02    | enqueue PCM 200 Mo (plafond taille?)           | refus/limite           | 200 ok=true            | FAIL (faille)
F03    | flood 200x /health (sans jeton)                | service survit         | echecs=0 vivant        | PASS
G01    | core.json en 0600                              | 600                    | 600                    | PASS
G02    | dossier d'état en 0700                         | 700                    | 755 -> 700 (revérifié) | PASS*
G03    | seconde instance concurrente                   | exit 17                | exit 17                | PASS
G04    | core.json intact après 2e instance            | présent                | présent                | PASS
H01    | écoute 127.0.0.1 uniquement                    | 127.0.0.1:* seul       | 127.0.0.1 seul         | PASS
H02    | aucune connexion sortante pendant lecture      | aucune                 | aucune                 | PASS
I01    | arrêt à la mort du parent (ADR-012 §5)         | s'arrête               | vivant (orphelin)      | FAIL (faille)
Total: 33 — refus conformes 28, failles 2, verdicts corrigés (*) 3
```

### Verdicts corrigés après vérification (pas des failles)

- **C04** (Host absent) : le `FAIL` initial (« vide ») venait de `nc`/zsh (zsh n'a pas `/dev/tcp`). Revérifié avec `bash -c` + `/dev/tcp` : `GET /health HTTP/1.0` **sans** en-tête Host → `HTTP/1.0 403 Forbidden` ; HTTP/1.1 sans Host → 403. `host_is_allowed(None)` (`security.rs:30-35`) refuse bien. **Défense correcte.**
- **E03** (traversal `..`) : refusé en `400 internal_error` par `Validate` (« path … contient un segment .. ») **avant** tout accès disque. Mon attendu (403/404) était trop strict ; le chemin est bien refusé, plus tôt encore. Code d'erreur non idéal (`internal_error` au lieu d'un `invalid_request` — déjà noté déviation #3 du pack GAO-core-rust-mi-001). **Défense correcte.**
- **G02** (mode dossier d'état) : le `755` venait de mon script qui **pré-créait** le dossier (umask 022). Quand le Core crée le dossier lui-même (absent au départ) : `stat` → `700 run`, `600 core.json`, `600 core.lock`. **Défense correcte au chemin de création.** Réserve mineure ci-dessous.

## Failles confirmées

### F-01 (F02) — Lecture de fichier enfilé sans plafond de taille : DoS mémoire
- Gravité : **faible** (exige un jeton valide ET un droit d'écriture dans le dossier de cache — tous deux du même utilisateur local ; robustesse plutôt qu'élévation de privilège).
- Preuve reproductible : `scripts/security/core-attack.sh` attaque F02 — un fichier de 200 Mo (`head -c 200000000 /dev/zero`) enfilé en `pcm16le` renvoie `HTTP 200 {"ok":true}` ; le Core l'a entièrement chargé en RAM. Aucun plafond n'existe.
- Cause : `load_pcm16le` fait `std::fs::read(path)` du fichier entier (`crates/llm-voice-core/src/server.rs:200`), et `load_wav` (hound) charge de même ; aucune vérification de taille dans `resolve_in_cache` (`server.rs:181-197`) ni dans `enqueue` (`server.rs:215-256`, décodage `server.rs:229-233`). Un fichier de cache géant (même accidentel) fait gonfler la mémoire du démon partagé entre fenêtres VS Code, jusqu'à l'OOM.
- Correctif proposé : plafonner la taille avant lecture. Dans `resolve_in_cache` (`server.rs:181-197`), après `canonicalize`, lire `std::fs::metadata(&resolved)?.len()` et refuser au-delà d'une borne (ex. 64 Mo) avec un code dédié ; ou plafonner dans `load_pcm16le` (`server.rs:199-213`) et via `load_wav`. Ajouter un test `tests/security.rs` : fichier > borne → refus.

### F-02 (I01) — Pas d'arrêt sur mort du parent (écart ADR-012 §5)
- Gravité : **faible-à-moyenne** (le démon orphelin garde un port loopback authentifié ouvert et son `core.json` — jeton en clair — présents indéfiniment, et retient le périphérique audio).
- Preuve reproductible : `scripts/security/core-attack.sh` attaque I01 — un Core lancé via un sous-shell (`setsid`) qui meurt aussitôt reste vivant (`kill -0` réussit) ; attendu par ADR-012 §5 (« le Core s'arrête … quand son parent disparaît »).
- Cause : `crates/llm-voice-core/src/main.rs` `run()` (lignes 65-114) n'installe aucune surveillance du parent ; `shutdown_signal()` (`main.rs:48-63`) ne réagit qu'à SIGTERM/SIGINT. `CoreProcess.dispose()` (`vscode-extension/src/playback/CoreProcess.ts:124-130`) n'envoie SIGTERM que si l'hôte d'extension appelle `dispose()` proprement ; un crash de l'hôte laisse l'orphelin (limitation déjà reconnue dans la doc de classe de `CoreProcess.ts:26-30` et déviation #7 du pack GAO-core-rust-mi-001, mais **non fermée**).
- Correctif proposé : sous Linux, `prctl(PR_SET_PDEATHSIG, SIGTERM)` au démarrage du Core (via `libc`/`nix`), ou recevoir le PID parent en variable d'environnement et le sonder périodiquement (`kill(pid,0)`), + un délai de grâce sans client (ADR-012 §5). Point d'ancrage : `main.rs` `run()` avant `axum::serve`. Compléter `CoreProcess` pour transmettre le PID parent.

## Observations mineures (durcissement, pas de faille exploitée)

1. **Dossier d'état pré-existant non resserré.** `ensure_dir` (`crates/llm-voice-core/src/lock.rs:83-92`) fait `DirBuilder::mode(0o700).create()` ; sur un dossier **déjà existant** avec des droits laxistes (ex. `0755` créé par un autre outil ou une version antérieure), le mode n'est pas resserré. `core.json` reste `0600` (jeton protégé), mais les métadonnées du dossier sont exposées. Correctif : `fs::set_permissions(dir, 0o700)` si le dossier existe déjà. Gravité négligeable (XDG_RUNTIME_DIR est déjà 0700).
2. **Jeton dans la query WebSocket.** Le serveur accepte `?token=` (`server.rs:324`) en plus de `Authorization: Bearer` (`server.rs:322-323`). `scripts/audio-spike/core-play.sh` porte le jeton dans l'URL de `curl` → visible dans `ps`/`/proc/<pid>/cmdline` par d'autres utilisateurs locaux le temps de la connexion (déviation #7). `NativeAudioSink.ts:403` met aussi le jeton en query, mais en processus Node (pas de fuite `ps`). Recommandation : préférer partout `Authorization: Bearer` (déjà supporté) ; les query strings sont plus susceptibles d'être journalisées.
3. **Oracle d'existence de fichiers, limité au porteur du jeton.** `resolve_in_cache` (`server.rs:181-197`) distingue `404 segment_not_found` (chemin inexistant) de `403 path_outside_cache` (chemin existant hors cache), révélant l'existence de chemins arbitraires à un client authentifié. Même utilisateur, jeton requis : gravité très faible ; informatif.
4. **`/health` non authentifié** expose version/moteur/formats (`server.rs:168-177`) : par conception du contrat (découverte de version avant connexion), acceptable.

## Défenses vérifiées solides

Jeton obligatoire sur les 6 routes HTTP et à l'ouverture WS (401) ; comparaison à temps constant, longueur voisine refusée (`security.rs:20-26`) ; tout `Origin` non vide refusé, y compris `null` et `file://` (403 `invalid_origin`, `guard` `server.rs:99-114`) ; `Host` étranger et rebinding DNS refusés, Host absent refusé (403 `invalid_host`) ; upgrade WS avec `Origin` refusé (403) ; chemin hors cache et évasion par lien symbolique refusés via `canonicalize` (403 `path_outside_cache`) ; `..` refusé à la validation (400) ; fichier non-WAV refusé (400) ; corps JSON de 60 Mo refusé (413, limite axum par défaut) ; instance unique (exit 17) ; écoute sur `127.0.0.1` seulement ; aucune connexion sortante pendant la lecture ; `core.json` 0600 et dossier d'état 0700 au chemin de création.

## Commandes exécutées (2026-09-28)

```
cargo build --release -p llm-voice-core                     # binaire cible
bash scripts/security/core-attack.sh                        # 33 attaques, exit 1 (2 failles + 3 verdicts corrigés)
# vérifications ciblées : C04 via bash /dev/tcp -> 403 ; E03 validate() -> 400 « segment .. » ;
# G02 dossier créé par le Core -> 700 / core.json 600 / core.lock 600
```

## Deviations

1. Le script exécute toutes les attaques puis imprime le tableau (au lieu de s'arrêter au premier échec) : un audit doit voir l'ensemble ; le code de sortie reste non nul si failles.
2. Trois assertions du banc étaient trop strictes / sensibles à l'outillage (C04 via `nc`/zsh, E03 code d'erreur, G02 dossier pré-créé) : corrigées et documentées ci-dessus ; ce ne sont pas des failles.
3. Les DoS (F01/F02/F03) sont bornés (60/200 Mo, 200 requêtes) pour ne pas saturer la machine ; ils démontrent la présence/absence de plafond sans provoquer d'OOM réel.

## Correctifs (2026-09-28)

Les deux failles confirmées (F-01, F-02) et l'observation E03 sont corrigées dans `crates/llm-voice-core`. Aucun `unsafe`, pas de nouvelle dépendance.

- **F-01 (plafond de taille)** — `server.rs` : `MAX_ENQUEUE_FILE_BYTES = 50 * 1024 * 1024` (documentée), vérifiée par `std::fs::metadata(&resolved).len()` dans `resolve_in_cache` **avant** tout `std::fs::read` ; refus `413 file_too_large` (nouveau code, ajouté à `common.schema.json#/$defs/errorCode` et à `ERROR_CODES` dans `llm-voice-protocol`). Plafond de durée décodée cohérent ajouté en défense en profondeur : `MAX_DECODED_DURATION_MS = MAX_ENQUEUE_FILE_BYTES / 2 * 1000 / 8000` (dérivé du pire cas PCM mono 8 kHz — le plancher `sampleRate` du contrat — donc mathématiquement jamais dépassable par un `wav`/`pcm16le` qui respecte déjà le plafond en octets ; filet de sécurité pour un format futur plus dense en durée par octet), vérifié après décodage via `Clip::duration_ms()` dans `enqueue`, même code `file_too_large`. Tests : `cargo test` `enqueue_above_the_size_cap_is_refused_before_being_read` (fichier creux via `set_len`, jamais lu) + script F02 (`413 file_too_large`).
- **F-02 (arrêt sur mort du parent)** — `main.rs` : nouvel argument `--parent-pid <pid>` (jamais dans l'environnement, comme documenté en tête de fichier) ; `parse_parent_pid` le lit, `wait_for_parent_death` sonde `/proc/<pid>` (`Path::exists`, aucun `unsafe`/FFI) toutes les secondes et déclenche le même arrêt propre qu'un SIGTERM via `shutdown_signal`. `vscode-extension/src/playback/CoreProcess.ts::spawnAndWait` passe désormais `--parent-pid <process.pid>` au Core qu'il lance. Tests : `cargo test` unitaires (`parse_parent_pid`, `parent_is_alive`) + intégration `stops_when_the_process_named_by_parent_pid_disappears` (parent = `sleep 0.2`, arrêt constaté ≤ 3 s, `core.json` retiré) ; vitest `core-process.test.ts` (le binaire factice publie `argv` dans `core.json`, assertion `["--parent-pid", String(process.pid)]`).
- **E03 (code d'erreur)** — `server.rs::authorize` : les échecs de désérialisation/`Validate::validate` (dont le motif `..` de `absolutePath`) répondent désormais `400 invalid_request` (nouveau code contrat) au lieu de `internal_error`, qui restait réservé aux vraies erreurs serveur (`engine_err`, panique de tâche). Test : `cargo test` (assertion `code == "invalid_request"` ajoutée à `valid_commands_answer_like_the_contract_examples`) + script E03.
- **Script `scripts/security/core-attack.sh`** : C04 réécrit en `bash -c` + `/dev/tcp` (plus de dépendance à `nc`) ; E03/F02 attendent les nouveaux codes ; G02 ne pré-crée plus `STATE_DIR` (seul `CACHE_DIR` l'est), pour que le Core le crée lui-même en `0700` ; I01 lance le Core avec `--parent-pid <pid>` d'un `sleep` qui meurt puis attend ≤ 3 s l'arrêt.

### Sortie finale (2026-09-28)

```
cargo test --workspace                          # 24+9+... tests, tous verts (voir détail ci-dessous)
cargo clippy --workspace -- -D warnings          # No issues found
cargo fmt --check                                # silencieux
cargo build --release -p llm-voice-core          # OK
bash scripts/security/core-attack.sh             # 33 attaques, 0 échec, exit 0
npm --prefix vscode-extension run test:unit      # 84 fichiers, 1026 tests, tous verts
npm --prefix vscode-extension run typecheck      # silencieux
```

```text
Total: 33  Échecs/failles: 0
```

Toutes les lignes du tableau (A01…I01) sont `PASS`, y compris F02 (`413 file_too_large`), E03 (`400 invalid_request`) et I01 (`arrêt quand --parent-pid meurt`, `arrêté`).

## Vérification concierge après correctifs (2026-09-28)

`bash scripts/security/core-attack.sh` → **Total: 33, Échecs/failles: 0**, exit 0 (sortie brute `/tmp/claude-1000/attack.out`).
`cargo test --workspace`, `cargo clippy --workspace -- -D warnings`, `cargo fmt --check` verts ; 1 026 tests vitest verts ; `tsc --noEmit` sans erreur.
F-01 (taille) et F-02 (mort du parent, `--parent-pid` passé par `CoreProcess`) corrigés ; E03 renvoie `400 invalid_request` ; C04/G02 fiabilisés dans le script.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
