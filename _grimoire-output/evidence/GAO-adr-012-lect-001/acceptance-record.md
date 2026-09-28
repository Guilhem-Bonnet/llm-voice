# Agentic Acceptance Record

- Task id: GAO-adr-012-lect-001
- Profile: controlled
- Deliverable: ADR-012 — lecture audio native hors webview, Core Rust minimal `llm-voice-core`, orchestration TypeScript
- Validator: guilhem-bonnet (décision de fond du 2026-09-27) ; relecture indépendante agent-optimizer (Sonnet)

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | gate : ADR-012 versé dans docs/adr/ADR-012-*.md, relu par un vérificateur indépendant (agent-optimizer, contexte neuf), verdict dans evidence-pack | `docs/adr/ADR-012-native-audio-core.md`, indexé dans `docs/adr/README.md` ; `evidence-pack.md` § « Vérification indépendante » : ACCEPTER AVEC CORRECTIONS MINEURES, aucun point bloquant | passé |
| AC-002 | gate : grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-adr-012-lect-001 --strict` | passé |

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests | vert | `npm --prefix vscode-extension run test:unit` via le gate (`test-run.json`, exit 0) |
| Build / lint | non applicable | document ADR, aucun code |
| Sécurité | passé | relecture point 4 : P0 respectés ; aucune socket sortante du Core |
| Design / accessibilité | non applicable | — |
| Evals IA | non applicable | — |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Condition d'entrée : spike `llm-voice-audio` contre mpv au banc | aucun code produit avant | acceptée |
| Seuils, tailles, signature macOS non mesurés | marqués non vérifiés | acceptée |

## Décision

Accepter (relecture indépendante favorable ; décision de fond de guilhem-bonnet du 2026-09-27).
