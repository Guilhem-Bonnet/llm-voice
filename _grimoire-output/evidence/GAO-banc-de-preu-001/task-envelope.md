# Agentic Task Envelope

## Task

- Task id: GAO-banc-de-preu-001
- Request: Banc de preuve audio automatisé (`scripts/audio-proof/`) : sink nul PipeWire, capture monitor, transcription faster-whisper, calcul WER et silence ; sonde autoplay versée au dépôt si trouvée sur le disque.
- Owner agent: agent-optimizer (Sentinel) + skill attachée `meta-toolsmithing` — outil framework (stdlib Python, triple interface CLI/MCP/module quand applicable, test écrit avec l'outil)
- Profile: controlled
- Current state: `running` (mode non-interactif)
- Risk level: `medium` (exécute des binaires système — pactl/parecord/paplay/piper/sox — et un venv Python hors dépôt ; aucun réseau, aucune modification de code produit hors `scripts/` et `vscode-extension/test/integration-security/`)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Méthode manuelle déjà prouvée | brief utilisateur (2026-09-27) | reproduire en script : pactl null-sink, parecord -d monitor, paplay, faster-whisper small/cpu/int8/fr | 2026-09-27 | ~1k |
| Squelette outil framework | `_grimoire/kit/skills/meta-toolsmithing.md` | stdlib only, CLI+test, docstring FR, `main()->int` | kit 3.46.1 | ~1k |
| Modèle de pack de preuve | `_grimoire-output/evidence/GAO-adr-012-lect-001/*.md` | gabarit imposé par le brief | 2026-09-28 | ~4k |
| Actifs disponibles | `~/.llm-voice/voices/fr_FR-siwis-medium.onnx`, binaires `piper`/`sox`/`uv`/`pactl`/`parecord`/`paplay` (vérifiés présents) | selftest référence/silence | 2026-09-28 | ~1k |
| Sonde autoplay | chemin scratchpad donné par le brief | à copier telle quelle si présente, rien d'autre sous `vscode-extension/` | 2026-09-28 | ~1k |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Bash | execute | `pactl`, `parecord`, `paplay`, `piper`, `sox`, `uv`, venv sous `~/.llm-voice/tools/audio-proof-venv` (hors dépôt) | sink nul supprimé par `trap` à chaque sortie ; jamais de sink système par défaut modifié |
| Write/Edit | write | `scripts/audio-proof/**`, `vscode-extension/test/integration-security/audible-probe.test.ts` (copie), `_grimoire-output/evidence/GAO-banc-de-preu-001/**` | jamais d'autre fichier sous `vscode-extension/` |
| Bash (grimoire) | execute | `grimoire task context/move`, `grimoire standard decision trace/gate/verify` sur cette carte | ledger et board de cette carte uniquement |

## LLM routing

| Step | Provider | Model | Fallback | Data policy |
|---|---|---|---|---|
| Fabrication de l'outil (agent-optimizer, skill meta-toolsmithing) | Anthropic | sonnet | — | code local, aucune donnée externe |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | brief non-interactif explicite, méthode manuelle déjà validée le 2026-09-27 | recorded |
| Implementation complete | `setup.sh`, `prove.sh`, `analyze.py`, `selftest.sh`, `README.md` sous `scripts/audio-proof/` | en cours |
| Validation complete | `selftest.sh` exécuté, codes consignés ; `grimoire standard gate check --task-id GAO-banc-de-preu-001 --strict` | en cours |
| Deviations documented | `evidence-pack.md` de cette tâche | en cours |
