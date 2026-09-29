# Agentic Task Envelope

## Task

- Task id: GAO-adr-015-dire-001
- Request: Rédiger `docs/adr/ADR-015-reading-direction.md` (statut **Proposé**, à valider par guilhem-bonnet) : direction de lecture sans règles de prosodie codées en dur. Cinq rôles (analyste, distribution + mémoire « bible », metteur en scène, traducteur moteur, contrôleur), contrat de la partition et de la bible (esquisses JSON Schema), portées de mémoire et stockage local, traduction par capacités (ADR-005), latence et cache, garde-fous, compatibilité ascendante avec le contrat actuel du narrateur ; points ouverts (moteur à consignes EN ATTENTE de `GAO-veille-moteu-001`) ; alternatives rejetées ; tests ; plan de livraison. Mise à jour de `docs/adr/README.md`.
- Owner agent: platform-architect (Archie) — aucun fichier de code modifié, aucun commit, pas de Bash (commandes grimoire listées pour le concierge)
- Profile: controlled
- Current state: `running` (carte ouverte par le concierge)
- Risk level: `medium` (nouveau sous-système transverse : contrats, stockage local de données dérivées du contenu, appels LLM sur le chemin de lecture ; aucune modification de code produit par cette tâche)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Persona et règles | `_grimoire/kit/agents/platform-architect.md`, `agent-base-compact.md` | ADR obligatoire, Mermaid, contrats avant implémentation, prior art | kit 3.46.1 | ~3k |
| Invariants P0 | `_grimoire/_memory/shared-context.md` | zéro autoplay, local-first, provider agnostic, profils, pas de modèle dans le VSIX | 2026-09-28 | ~5k |
| Contrats providers | `docs/adr/ADR-005-provider-contracts.md`, `vscode-extension/src/core/tts.ts`, `src/core/narration.ts` | `getCapabilities()`, mode dégradé, `NarrationSegment.metadata` | branche courante | ~5k |
| Paliers TTS | `docs/adr/ADR-009-tts-tiers.md` | aucun LLM cloud ajouté | accepté | ~1k |
| Core natif | `docs/adr/ADR-012-native-audio-core.md`, `contracts/core-v1/common.schema.json`, `http/enqueue.request.schema.json`, `examples/valid/health.response.json` | Core passif ; `enqueue` sans champ de silence ni de fondu | branche courante | ~6k |
| Format ADR + Auto | `docs/adr/ADR-013-decision-provider.md` | gabarit, `DecisionProvider` absorbé par l'analyste | Proposé | ~6k |
| Stockage | `docs/adr/ADR-004-storage-inbox-cache.md` | le cache ne contient que de l'audio ; SQLite rejeté | accepté | ~2k |
| Contrat narrateur | `vscode-extension/src/narrator/narrationContract.ts` | `{segments:[{sourceIds, spokenText}]}` | branche courante | ~1k |
| Paramètres moteurs | `vscode-extension/src/tts/ChatterboxProvider.ts`, `SystemTtsProvider.ts` (l. 1-320) | exaggeration/cfg_weight/temperature ; `speed` 0,5–2 | branche courante | ~6k |
| Mesures | `_grimoire-output/evidence/GAO-valuation-f-001/evidence-pack.md`, `GAO-valuation-m-001/evidence-pack.md` | fidélité, négations fragiles, SemIf 7b 75 %, JSON structuré 0 invalide | 2026-09-29 | ~5k |
| Banc audio | `scripts/audio-proof/README.md` | mesure des silences, transcription | branche courante | ~1k |
| Gabarit de preuve | `_grimoire-output/evidence/GAO-adr-012-lect-001/` | enveloppe, pack, claim-ledger | 2026-09-28 | ~4k |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---|---|
| Fichiers du dépôt | lecture directe | high | yes | seules sources des faits cités |
| Prior art (SSML, attribution de répliques) | connaissance générale | low | no | marqué « non vérifié dans cette session » dans l'ADR ; aucun accès web utilisé |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| `_grimoire/_memory/shared-context.md` | read | invariants P0 | — |
| `decisions-log.md` | non modifié | hors périmètre du brief | le concierge journalise la décision après validation utilisateur |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Read / Glob | read-only | dépôt | aucun |
| Write / Edit | write | `docs/adr/ADR-015-reading-direction.md`, `docs/adr/README.md`, `_grimoire-output/evidence/GAO-adr-015-dire-001/` | jamais un fichier de code, jamais `vscode-extension/`, aucun commit |
| Bash / grimoire | aucun | — | commandes listées dans le retour, exécutées par le concierge |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Rédaction de l'ADR-015 (platform-architect) | Anthropic | opus | — | code public |
| Vérification indépendante (à dispatcher) | Anthropic | sonnet (agent-optimizer, contexte neuf) | — | ADR + evidence-pack |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | architecture multi-agents proposée par le concierge et acceptée par guilhem-bonnet (brief du 2026-09-29) | recorded |
| Implementation complete | ADR-015 écrit ; ligne ADR-015 dans `docs/adr/README.md` | passed (écrit par l'auteur, à vérifier) |
| Validation complete | vérificateur indépendant ; `grimoire standard gate check --task-id GAO-adr-015-dire-001 --strict` ; `grimoire standard verify .` | pending |
| Deviations documented | `evidence-pack.md` de la tâche | passed |
