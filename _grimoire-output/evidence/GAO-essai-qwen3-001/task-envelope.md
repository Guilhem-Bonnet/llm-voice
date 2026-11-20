# Agentic Task Envelope

## Task

- Task id: GAO-essai-qwen3-001
- Request: Essai Qwen3-TTS : voix d'assistant créées sur description, deux registres, page d'écoute
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
| Qwen3-TTS peut-il être téléchargé et exécuté ? | Oui, dans ~/.llm-voice/voices-lab/qwen3/, sur GPU AMD, texte local, hors ligne après téléchargement | question ciblée : « oui pour qwen3 » (guilhem-bonnet) |
| Le modèle Base (non listé) est-il permis pour figer une voix ? | Hypothèse : oui, la carte officielle décrit « Voice Design then Clone » avec ce modèle ; écart signalé dans le rapport | hypothèse |

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Context bundle | _grimoire-output/context/GAO-essai-qwen3-001/context-bundle.yaml | généré par le kit depuis le Mission Ledger | 2026-11-06 | n/a |

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
| `docker run --rm deploy-chatterbox:latest` (image inchangée) | execute | génération Qwen3-TTS, /dev/kfd + /dev/dri, gpu-yield en lecture seule | ~/.llm-voice/voices-lab/qwen3/, scripts/voice-lab/ |
| `pip install --target` (conteneur, réseau) | execute | qwen-tts 0.1.1, transformers 4.57.3 dans qwen3/extras, pas de torch | qwen3/extras uniquement |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
|  |  |  |  |  |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | autorisation explicite de l'utilisateur, périmètre ci-dessus | done |
| Implementation complete |  | pending |
| Validation complete |  | pending |
| Deviations documented |  | pending |
