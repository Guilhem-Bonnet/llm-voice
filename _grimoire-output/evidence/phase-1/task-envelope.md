# Agentic Task Envelope

## Task

- Task id: phase-1
- Request: Repo GitHub public `Guilhem-Bonnet/llm-voice` (MIT), gouvernance, CI matrice 3 OS, squelette extension VS Code vert en CI, squelette plugin Claude Code ; en parallèle, trois études : garantie 100 % local, Linux first, UI compacte dans VS Code.
- Owner agent: concierge (Marcel) ; exécutants : pipeline-architect (Sonnet), general-purpose ×3 (Sonnet, avec web) ; revue : agent-optimizer Sentinel (Sonnet)
- Profile: starter
- Current state: `executing`
- Risk level: `medium` (push public ; validé explicitement par l'utilisateur le 2026-09-08 : « Je valide tout »)

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| decisions-cadrage-v1.md D1-D9 | planning-artifacts | décisions validées | 2026-09-08 | ~6k |
| github-repo-ci-plan-v1.md + déviation D-1 | planning-artifacts | base à corriger | 2026-09-08 | ~4k |
| master-plan §5-7 | planning-artifacts | pyramide de tests, phases | 2026-09-08 | ~4k |
| CdC §24-27, §56 | cahier-des-charges.md | Linux/ROCm, extensionKind | 2026-09-08 | ~3k |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---|---|
| Docs officielles VS Code, Ollama, HuggingFace, ROCm, Chatterbox-TTS-Server, Piper (web) | WebSearch/WebFetch par les agents | moyenne (officiel) à faible (communautaire) | no | chaque affirmation doit être sourcée ou marquée non vérifiée |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| decisions-log.md | write | validation utilisateur, décisions phase 1 | format |
| session-state.md | write | état de phase | — |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Write (agents) | write | racine du projet (gouvernance, .github, vscode-extension/, integrations/, scripts/, docs/) ; jamais `_grimoire/kit`, `.github/copilot-instructions.md` | pas de suppression |
| npm install / lint / test | execute | vscode-extension/ | local |
| gitleaks | execute | racine | lecture seule |
| git init / commit / gh repo create / push | execute | **uniquement après revue Sentinel et ordre explicite de Marcel** | crée un repo public ; réversible par suppression du repo |
| gh api (branch protection, labels, dependabot) | execute | repo llm-voice | idem |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| Préparation repo, CI, squelette | Anthropic | sonnet | opus | contenu public |
| Revue avant exécution | Anthropic | sonnet (Sentinel, contexte neuf) | opus | idem |
| Études local / Linux / UI | Anthropic | sonnet + web | opus | idem |
| Gate de phase | Anthropic | fable | — | lit evidence-pack uniquement |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | validation utilisateur « Je valide tout » (D1-D9 + repo) consignée dans decisions-log | recorded |
| Implementation complete | repo créé, CI verte sur 3 OS, 3 études livrées | pending |
| Validation complete | revue Sentinel du script avant exécution ; gitleaks clean ; gate check phase-1 | pending |
| Deviations documented | evidence-pack phase-1 | pending |
