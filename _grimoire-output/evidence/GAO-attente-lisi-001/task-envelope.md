# Agentic Task Envelope

## Task

- Task id: GAO-attente-lisi-001
- Request: Attente lisible et gestes de lecture : délai du premier chargement, étapes sans faux pourcentage, bloc Document ouvert, sélections multiples
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
| Que se passe-t-il au-delà de 60 s ? | Le test test/unit/tts/slowFirstLoad.test.ts le prouve avec un vrai serveur HTTP lent : coupure au délai, puis reprise par AudioQueue | contexte vérifié (test) |
| Comment démarrer le moteur sans synthèse ? | Route POST /load ajoutée au serveur : charge en tâche de fond, /health dit state et loading_since_s ; un serveur plus ancien répond 404 et le comportement précédent reste | décision de cette tranche, à relire |
| Chemin réel des fichiers | Le brief cite src/core/Pipeline.ts, AudioQueue.ts : ils sont dans vscode-extension/src/pipeline et src/playback | contexte vérifié |

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Context bundle | _grimoire-output/context/GAO-attente-lisi-001/context-bundle.yaml | généré par le kit depuis le Mission Ledger | 2026-11-06 | n/a |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---:|---|
| Maquettes Claude Design | Panneau-preparation, Panneau-attente-incidents, Panneau-document, Lancer-lecture, Panneau-lecture-detail | validées par guilhem-bonnet | yes | textes repris à la lettre, sauf écart signalé |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| Mémoire utilisateur (boutons taille fixe, gpu-yield, tests autonomes) | read | règles UI et mode jeu | relue dans le contexte de session |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| `npm --prefix vscode-extension run test:unit` | execute | tests du projet (gate run-tests) | racine du projet |
| typecheck, lint, build, vscode-test fake-tts, test:integration-voice, package:linux-x64, python3 deploy/kyutai16/test_server.py | execute | vérification | aucun banc audio, aucune charge GPU, service kyutai16 non touché |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation | Anthropic | claude-opus-5-5 (dispatch) | aucun | code du dépôt seulement |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | Direction validée par guilhem-bonnet (brief) ; hypothèses dans le tableau Ambiguïtés | done |
| Implementation complete | Les 6 points livrés, voir evidence-pack.md | done |
| Validation complete | Tableau Validation de evidence-pack.md ; essai réel avec le modèle non fait | partial |
| Deviations documented | evidence-pack.md | done |
