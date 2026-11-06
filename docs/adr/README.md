# Architecture Decision Records — LLM Voice

Format : MADR court (Contexte / Décision / Conséquences / Alternatives
rejetées / Tests qui prouvent la décision).

| ADR | Titre | Décision(s) source |
|---|---|---|
| [ADR-001](./ADR-001-audio-playback.md) | Lecture audio via Webview `<audio>` et protocole postMessage — **remplacé par ADR-012** | D4 |
| [ADR-002](./ADR-002-synchronization-highlight.md) | Synchronisation audio et surlignage dans l'éditeur | D6 |
| [ADR-003](./ADR-003-claude-code-hook.md) | Capture des réponses Claude Code : plugin + collector Node | D7 |
| [ADR-004](./ADR-004-storage-inbox-cache.md) | Stockage : inbox fichier, cache audio et secrets | D3 |
| [ADR-005](./ADR-005-provider-contracts.md) | Contrats de providers : TTS, narrateur, sources, réseau | D2, D9, D10 |
| [ADR-006](./ADR-006-segmentation.md) | Segmentation du texte source | §11-14, §33 CdC |
| [ADR-007](./ADR-007-open-inbox-protocol.md) | Protocole d'inbox ouvert et CLI `llm-voice-inbox` | D8 |
| [ADR-008](./ADR-008-copilot-voice-participant.md) | Intégration GitHub Copilot Chat : sélection puis participant `@voice` | D8 |
| [ADR-009](./ADR-009-tts-tiers.md) | Offre TTS à trois niveaux : local, entreprise, API | D9 (mise à jour par D11) |
| [ADR-010](./ADR-010-egress-guard.md) | `EgressGuard` : garantie « rien ne sort », prouvée | D10 |
| [ADR-011](./ADR-011-ui-layout.md) | Layout UI : `minimal` par défaut, `full` en option — **révisé par ADR-012** (webview = affichage) | D12 |
| [ADR-012](./ADR-012-native-audio-core.md) | Lecture audio native hors webview : Core Rust minimal `llm-voice-core` | décision du 2026-09-27 (option E) |
| [ADR-013](./ADR-013-decision-provider.md) | Fournisseur de décision typée (`DecisionProvider`) et mode « Auto » — **proposé** | décision du 2026-09-27 (mode Auto) |
| [ADR-015](./ADR-015-reading-direction.md) | Direction de lecture : partition par segment, distribution des voix et mémoire (« bible ») — **accepté** (2026-09-29) | demande du 2026-09-29 (architecture en cinq rôles), veille `GAO-veille-moteu-001` |
| [ADR-016](./ADR-016-kyutai-tts-provider.md) | Kyutai Pocket TTS : palier de voix additionnel — voir le fichier pour son statut | décisions-log, 2026-11-05 |
| [ADR-017](./ADR-017-voice-and-reading-mode.md) | Voix globale et mode de lecture : retrait du mot « profil », migration, fusion des vues ; amende ADR-011 — **proposé** | décision du 2026-11-05 (refonte UX) |

Les ADR-001 à ADR-011 sont accepté(e)s et fusionné(e)s sur `main` ; ADR-001
est remplacé par ADR-012 (le `<audio>` du webview ne reste qu'en repli sur
clic). ADR-012 est accepté le 2026-09-27 (condition d'entrée du code : spike
`llm-voice-audio` contre mpv au banc de preuve audio). ADR-013 est proposé
(condition d'entrée : spike `GAO-spike-valuat-001`). ADR-015 est accepté (2026-09-29) ; il
étend ADR-005 et ADR-004 et déplace l'appel
d'« Auto » (ADR-013) dans l'analyste quand la direction est active ; le choix
du moteur à consignes attend le banc d'une journée (étape 1 bis). Aucun
fichier ADR-014 n'existe dans ce dossier.

Décisions détaillées : `_grimoire-output/planning-artifacts/decisions-cadrage-v1.md`.
Études sources : `local-guarantee-v1.md`, `linux-first-v1.md`,
`ui-compact-v1.md`, `brainstorm-llm-voice-v1.md`, `cahier-des-charges.md`.
