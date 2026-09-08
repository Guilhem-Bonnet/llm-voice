# Architecture Decision Records — LLM Voice

Format : MADR court (Contexte / Décision / Conséquences / Alternatives
rejetées / Tests qui prouvent la décision).

| ADR | Titre | Décision(s) source |
|---|---|---|
| [ADR-001](./ADR-001-audio-playback.md) | Lecture audio dans VS Code (en cours) | D4 |
| [ADR-002](./ADR-002-synchronization.md) | Synchronisation audio → highlight (en cours) | D6 |
| [ADR-003](./ADR-003-claude-code-hook.md) | Installation du hook Claude Code (en cours) | D7 |
| [ADR-004](./ADR-004-storage-inbox.md) | Stockage et inbox (en cours) | D3 |
| [ADR-005](./ADR-005-provider-api.md) | API providers et `synthesizeStream?` (en cours) | D2 |
| [ADR-006](./ADR-006-segmentation.md) | Segmentation du texte source | §11-14, §33 CdC |
| [ADR-007](./ADR-007-open-inbox-protocol.md) | Protocole d'inbox ouvert et CLI `llm-voice-inbox` | D8 |
| [ADR-008](./ADR-008-copilot-voice-participant.md) | Intégration Copilot Chat : sélection puis participant `@voice` | D8 |
| [ADR-009](./ADR-009-tts-tiers.md) | Offre TTS à trois niveaux : local, entreprise, API | D9 (mise à jour par D11) |
| [ADR-010](./ADR-010-egress-guard.md) | `EgressGuard` : garantie « rien ne sort », prouvée | D10 |
| [ADR-011](./ADR-011-ui-layout.md) | Layout UI : `minimal` par défaut, `full` en option | D12 |

ADR-001 à 005 sont rédigées en parallèle par un autre agent (statut « en
cours » au moment de cet index) ; leurs liens seront actifs dès leur fusion
sur `main`.

Décisions détaillées : `_grimoire-output/planning-artifacts/decisions-cadrage-v1.md`.
Études sources : `local-guarantee-v1.md`, `linux-first-v1.md`,
`ui-compact-v1.md`, `brainstorm-llm-voice-v1.md`, `cahier-des-charges.md`.
