# Agentic Task Envelope

## Task

- Task id: GAO-audit-s-curi-001
- Request: Audit de sécurité offensif du démon local `crates/llm-voice-core` (axum/tokio, 127.0.0.1, jeton de session, WebSocket) et de son client `vscode-extension/src/playback/{CoreProcess,NativeAudioSink}.ts`. Construire une suite d'attaque reproductible (`scripts/security/core-attack.sh`) contre le binaire release réel, exercer : requêtes sans jeton / jeton faux / longueur voisine (temps constant), en-têtes `Origin` (evil, null, file://) et `Host` falsifié (rebinding DNS), upgrade WebSocket sans jeton / avec `Origin`, chemins d'enfilage hors cache (`/etc/passwd`, lien symbolique, `..`), fichier non-WAV, WAV/PCM géant, corps JSON énorme, flood de connexions, permissions `core.json`/dossier d'état, seconde instance concurrente, adresse d'écoute, connexions sortantes pendant lecture, survie à la mort du parent. Chaque attaque attend un refus précis ; script non nul au premier échec, tableau imprimé. Pour chaque faille : gravité, preuve reproductible, correctif proposé (fichier:ligne). Ne corrige pas le code.
- Owner agent: security-auditor (Kael) — dispatch non-interactif
- Profile: controlled
- Current state: `running` (l'état de la carte n'est pas modifié par cet agent ; aucun commit)
- Risk level: `medium` (attaques loopback contre un binaire local ; aucun accès sortant ; état isolé sous scratchpad)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Cible serveur | `crates/llm-voice-core/src/{server,security,lock,main}.rs` | surface d'attaque HTTP/WS, jeton, chemins, cycle de vie | working tree | ~9k |
| Cible client | `vscode-extension/src/playback/{CoreProcess,NativeAudioSink}.ts` | spawn, lecture de `core.json`, auth WS | working tree | ~5k |
| Décision sécurité | `docs/adr/ADR-012-native-audio-core.md` §5-§6 | invariants attendus (127.0.0.1, jeton, Origin/Host, arrêt sur mort du parent) | 2026-09-28 | ~4k |
| Contrat | `contracts/core-v1/**` | forme des réponses/erreurs attendues | 2026-09-28 | ~3k |
| Limites connues | `_grimoire-output/evidence/GAO-core-rust-mi-001/evidence-pack.md` §Deviations 7 | jeton en argument curl, pas d'arrêt sur mort du parent | 2026-09-28 | ~2k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Read | read | `crates/**`, `vscode-extension/src/playback/**`, `contracts/**`, `docs/adr/**`, evidence | lecture seule |
| Bash | execute | `cargo build --release`, `scripts/security/core-attack.sh`, `curl`, `ss`, `nc`, `stat` | loopback seulement ; état+cache isolés sous scratchpad ; aucun commit ; pas de `grimoire policies reset-session` |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Audit offensif (security-auditor) | Anthropic | opus | — | code local, aucune donnée externe |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief non-interactif explicite | recorded |
| Attack suite built | `scripts/security/core-attack.sh` exécutable contre le binaire release | see evidence-pack |
| Attacks executed | sortie du script (tableau attaque/attendu/obtenu/verdict) | see evidence-pack |
| Findings triaged | gravité + preuve + correctif (fichier:ligne) par faille | see evidence-pack + claim-ledger |
