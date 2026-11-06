# Agentic Task Envelope

## Task

- Task id: GAO-jeu-d-acteur-001
- Request: Jeu d'acteurs : plusieurs voix pour le théâtre et le livre, narrateur et personnages
- Owner agent: guilhem-bonnet
- Profile: controlled
- Current state: `executing`
- Risk level: `medium`

## Ambiguïtés résolues

Toute ambiguïté bloquante rencontrée pendant la tâche, et comment elle a été
résolue — par contexte vérifié (relecture, source faisant autorité) ou par
question ciblée posée au demandeur. Une hypothèse non vérifiée reste une
hypothèse, jamais un fait tant que la colonne « Source » ne le dit pas.

| Question posée | Résolution | Source (contexte vérifié / question ciblée / hypothèse) |
|---|---|---|
| Étendue de la tranche | Étapes 1 à 4 du § 7 d'ADR-018, sans tranche LLM ni Studio ; l'étape 0 revient au concierge | question ciblée (brief du concierge, 2026-11-06) |
| « Préparer » avant l'étape 6 | Le choix confirmé exige le bouton dès l'étape 4 : `ReadingPreparer` minimal (même file, sans sink), sans budget ni reprise de mode jeu | hypothèse d'implémentation, signalée comme écart dans le pack |
| `casting` n'a droit qu'à `assignVoice` dans `MODEL_EVENT_TYPES`, et un test le fige | `addRole` part en origine `analyst` (le repérage tient ce rôle), `assignVoice` en origine `casting` ; contrat de la bible inchangé | contexte vérifié (`bible/events.ts:189`, `reducer.test.ts:55`) |

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| ADR-018 | docs/adr/ADR-018-jeu-d-acteurs.md | spécification | 2026-11-06 | n/a |
| Context bundle | _grimoire-output/context/GAO-jeu-d-acteur-001/context-bundle.yaml | généré par le kit depuis le Mission Ledger | 2026-11-06 | n/a |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---:|---|
|  |  |  | no |  |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
|  | read |  |  |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| `npm --prefix vscode-extension run test:unit` | execute | tests du projet (gate run-tests) | racine du projet |
| Édition de fichiers | edit | `vscode-extension/`, `docs/essais-voix/`, preuves de la carte | jamais `docs/Documentation-humaine/Voice-System.md` |
| Build, lint, vscode-test, package | execute | `vscode-extension/`, sans GPU ni banc audio, service kyutai16 intouché | aucun commit, push, stash, reset, checkout |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation (backend-engineer) | Anthropic | Opus 5.5 | aucun | code et textes d'essai seulement |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | ADR-018 accepté, brief du concierge | done |
| Implementation complete | étapes 1 à 4 d'ADR-018 §7, voir evidence-pack.md | done, preuve audible à faire |
| Validation complete | sorties réelles dans evidence-pack.md, hors GPU | partial : gate et écoute au concierge et à guilhem-bonnet |
| Deviations documented | evidence-pack.md, section Deviations | done |
