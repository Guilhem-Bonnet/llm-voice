# Agentic Claim Ledger

- Task id: GAO-audit-s-curi-001 (audit de sécurité offensif)
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Jeton obligatoire sur les 6 routes HTTP et à l'ouverture WS ; sans jeton / jeton faux → 401 | résultat | attaques A01-A06, D01-D02 (`core-attack.sh`) | prouvé | élevée | utiliser |
| CL-002 | Comparaison de jeton à temps constant, longueur voisine (31/33) refusée sans fuite utile (longueur fixée à 32) | résultat | A03-A04 + `security.rs:20-26` | prouvé | élevée | utiliser |
| CL-003 | Tout `Origin` non vide refusé (evil, `null`, `file://`) — 403 `invalid_origin`, y compris sur WS | résultat | B-evil/B-null/B-file, D03 | prouvé | élevée | utiliser |
| CL-004 | `Host` étranger / rebinding DNS / Host absent refusés — 403 `invalid_host` | résultat | C01-C03 + C04 revérifié (`bash /dev/tcp` → 403) | prouvé | élevée | utiliser |
| CL-005 | Chemin hors cache et évasion par lien symbolique refusés (canonicalize) ; `..` refusé à la validation | résultat | E01-E03 ; E03 = 400 « segment .. » avant accès disque | prouvé | élevée | utiliser |
| CL-006 | Fichier non-WAV refusé (400 unsupported_format) ; corps JSON 60 Mo refusé (413) | résultat | E05, F01 | prouvé | élevée | utiliser |
| CL-007 | Instance unique (exit 17), `core.json` 0600, dossier d'état 0700 au chemin de création | résultat | G01, G03, G04 + vérif dossier créé par le Core | prouvé | élevée | utiliser |
| CL-008 | Écoute sur 127.0.0.1 seulement ; aucune connexion sortante pendant la lecture | résultat | H01, H02 (`ss -ltnp`/`ss -tnp` filtrés sur le pid) | prouvé | élevée | utiliser |
| CL-009 | **FAILLE** : fichier enfilé lu sans plafond de taille → DoS mémoire du démon (200 Mo accepté) | résultat | F02 ; `server.rs:200` (`fs::read`), `server.rs:229-233` | prouvé | élevée | corriger (F-01, gravité faible) |
| CL-010 | **FAILLE** : pas d'arrêt sur mort du parent ; orphelin garde port authentifié + jeton + audio | résultat | I01 ; `main.rs:48-114` sans surveillance parent ; `CoreProcess.ts:26-30` | prouvé | élevée | corriger (F-02, gravité faible-moyenne) |
| CL-011 | Dossier d'état pré-existant non resserré à 0700 par `ensure_dir` | observation | `lock.rs:83-92` (revue) ; XDG_RUNTIME_DIR déjà 0700 | prouvé | moyenne | durcir (mineur) |
| CL-012 | Jeton transmis en query WS ; fuite `ps` dans `core-play.sh` (autres users locaux) | observation | `server.rs:324`, `core-play.sh` (URL curl), `NativeAudioSink.ts:403` | prouvé | moyenne | préférer Bearer (mineur) |
| CL-013 | Oracle d'existence de fichiers pour un client authentifié (404 vs 403) | observation | `server.rs:181-197` | prouvé | faible | informatif |

## Synthèse

| Question | Réponse |
|---|---|
| Attaques exécutées | 33 |
| Refusées conformément | 28 |
| Failles confirmées | 2 (CL-009 DoS mémoire faible ; CL-010 orphelin faible-moyenne) |
| Verdicts FAIL du banc réfutés après vérification | 3 (C04, E03, G02 — artefacts / assertions strictes, défenses correctes) |
| Observations de durcissement | 3 (CL-011, CL-012, CL-013) |
| Correction de code par cet agent | aucune (hors périmètre : audit seulement) |
