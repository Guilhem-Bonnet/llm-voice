# Agentic Task Envelope

## Task

- Task id: GAO-adr-012-lect-001
- Request: Rédiger `docs/adr/ADR-012-native-audio-core.md` (statut « Accepté » le 2026-09-27, décision de guilhem-bonnet) : lecture audio native hors webview par un Core Rust minimal (`llm-voice-core`) spawné par l'extension, HTTP + WebSocket sur la boucle locale, instance unique ; orchestration, pipeline, profils, inbox, narrateur et mode Auto conservés en TypeScript ; inférence locale sherpa-onnx dans un second temps. Option D (napi-rs) = repli documenté. Mise à jour de `docs/adr/README.md`, entrée courte dans `decisions-log.md`, ligne dans `shared-context.md`.
- Owner agent: platform-architect (Archie) — décision d'architecture documentée ; aucun fichier `.ts` modifié, aucun commit
- Profile: controlled
- Current state: `verified` (carte en vérification puis clôture, 2026-09-28)
- Risk level: `medium` (décision d'architecture structurante : nouveau binaire natif, matrice de 5 cibles, surface réseau locale ; aucune modification de code produit par cette tâche)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Persona et règles | `_grimoire/kit/agents/platform-architect.md` | ADR obligatoire, Mermaid, contrats avant implémentation | kit 3.46.1 | ~2k |
| Verdict, migration, projet de section Langage | `_grimoire-output/planning-artifacts/debat-langage-core-synthese-v1.md` §B, §C, §D, §F | base de l'ADR, scores du débat | 2026-09-27 | ~12k |
| Cause racine autoplay | `_grimoire-output/evidence/GAO-diagnostic-s-001/evidence-pack.md` | `NotAllowedError` mesuré deux fois, 0 flux PipeWire | 2026-09-27 | ~3k |
| Faits lecture native | `research_notes/Briques existantes pour LLM Voice/lecture-audio-native.md`, `controle-lecture-native-et-gapless.md` | `autoplayPolicy`, pw-cat sans pause/position, mpv IPC, `node-web-audio-api` + Jack, `vsce --target` | 2026-09-27 | ~6k |
| ADR remplacés ou révisés | `docs/adr/ADR-001`, `ADR-005`, `ADR-009`, `ADR-011` ; gabarit `ADR-013` ; index `README.md` | conséquences à consigner | main 88384dc | ~10k |
| Invariants et décisions | `_grimoire/_memory/shared-context.md`, `decisions-log.md` (2026-09-11 Zéro Docker ; 2026-09-27 option E validée) | contraintes P0, décision utilisateur | 2026-09-27 | ~5k |
| Interface conservée | `vscode-extension/src/playback/AudioSink.ts`, `WebviewAudioSink.ts`, `PlaybackController.ts` (lecture seule) | jonction `NativeAudioSink` | main 88384dc | ~3k |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---|---|
| Notes de veille sourcées (2026-09-27) | lecture directe | medium | yes, pour les faits cités | les non-vérifiés de la veille restent marqués « non vérifié » dans l'ADR |
| Web | non consulté | — | no | rien n'est re-dérivé ; la décision est prise |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| `_grimoire/_memory/shared-context.md` | read + write (1 ligne) | invariants P0 ; pointeur vers ADR-012 | diff relu |
| `_grimoire/_memory/decisions-log.md` | read + write (entrée courte) | décision validée ; « ADR-012 rédigé » | diff relu |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Read / Bash (lecture) | read-only | dépôt | aucun |
| Write / Edit | write | `docs/adr/ADR-012-native-audio-core.md`, `docs/adr/README.md`, `_grimoire/_memory/decisions-log.md`, `_grimoire/_memory/shared-context.md`, `_grimoire-output/evidence/GAO-adr-012-lect-001/` | jamais un fichier `.ts`, jamais `vscode-extension/`, aucun commit |
| Bash (grimoire) | execute | `grimoire task …`, `grimoire standard …` | ledger et board de cette carte uniquement |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Rédaction de l'ADR-012 (platform-architect) | Anthropic | opus | — | code public |
| Vérification indépendante | Anthropic | sonnet (agent-optimizer, contexte neuf) | — | ADR + evidence-pack |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | décision utilisateur « Ok, je valide l'option E » (decisions-log 2026-09-27) ; brief de dispatch | recorded |
| Implementation complete | `docs/adr/ADR-012-native-audio-core.md` écrit ; ligne ADR-012 dans `docs/adr/README.md` ; mémoire mise à jour | passed |
| Validation complete | vérificateur indépendant (agent-optimizer, sonnet) ; `grimoire standard gate check --task-id GAO-adr-012-lect-001 --strict` ; `grimoire standard verify .` | passed |
| Deviations documented | `evidence-pack.md` de la tâche | passed |
