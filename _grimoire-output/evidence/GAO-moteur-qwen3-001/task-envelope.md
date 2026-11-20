# Agentic Task Envelope

## Task

- Task id: GAO-moteur-qwen3-001
- Request: Moteur Qwen3 : serveur local hors ligne, voix figée et voix jouée
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
| `direction` absente ou vide : quel modèle ? | Absente ou blanche : voix figée (Base). Non vide : voix jouée (VoiceDesign) | Brief du concierge du 2026-11-07 ; le cas « blanche » est une hypothèse d'implémentation, testée |
| `POST /load` sans corps : quel modèle charger ? | Voix figée par défaut, `?mode=played` pour l'autre : le contrat Kyutai reste valable sans paramètre | Hypothèse d'implémentation, signalée au rapport |
| Quelle voix de référence ? | Aucune choisie : entrée provisoire `fr-naturelle` (`out-gao/naturel1-s11.wav` + `naturel2-s11.wav`), remplaçable dans `deploy/qwen3/voices.json` | Brief : guilhem-bonnet n'a pas encore choisi |
| Le dépôt reçoit-il les WAV de preuve ? | Non : régénérables, ignorés par git comme ceux du banc Kyutai ; mesures et transcriptions commitées | Contexte vérifié : `.gitignore` lignes 61-64 ; hypothèse sur la portée, signalée au rapport |

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Context bundle | _grimoire-output/context/GAO-moteur-qwen3-001/context-bundle.yaml | généré par le kit depuis le Mission Ledger | 2026-11-07 | n/a |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---:|---|
|  |  |  | no |  |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| `_grimoire/_memory/shared-context.md` | read | état du projet | lu le 2026-11-07 |
| Mémoire « mode jeu gpu-yield » | read | jamais de charge GPU pendant un jeu | vérification du drapeau avant chaque étape GPU |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| `python3 -P deploy/qwen3/test_server.py` | execute | tests du serveur, moteur factice | aucun GPU, boucle locale seulement |
| `docker run --network none deploy-chatterbox:latest` | execute | preuve réelle GPU, une fois | hors ligne, non root, `--cap-drop ALL`, modèles en lecture seule ; arrêt si le drapeau de jeu apparaît |
| `docker compose ... run --rm --service-ports qwen3` | execute | publication du port 8021 | `/health` seul, aucune charge GPU ; `deploy-kyutai16-1` non touché |
| `~/.llm-voice/tools/audio-proof-venv/bin/python` | execute | transcription faster-whisper, WER | CPU, `HF_HUB_OFFLINE=1`, rien n'est joué |
| Interdits du brief | none | enceintes, téléchargement, `git push`, `vscode-extension/`, arrêt de Kyutai | aucune exception |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation | Anthropic | Sous-agent backend-engineer, modèle choisi au dispatch | aucun | code et mesures locales seulement ; textes de preuve factices |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | Brief du concierge du 2026-11-07 ; hypothèses dans « Ambiguïtés résolues » | done |
| Implementation complete | `deploy/qwen3/`, service compose, README | done |
| Validation complete | evidence-pack « Validation » | done |
| Deviations documented | evidence-pack « Deviations » | done |
