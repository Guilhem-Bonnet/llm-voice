# Agentic Task Envelope

## Task

- Task id: phase-7
- Request: Corriger l'expérience de première utilisation signalée par l'utilisateur sur la 0.1.0 : (1) aucun TTS ne fonctionne sans installation manuelle de Chatterbox ; (2) la page de l'extension est vide (pas de README dans le VSIX) ; (3) `LLM Voice: Play` et le raccourci ne font rien sans session ; (4) les fonctions ne sont découvrables que par hasard. Cible : un utilisateur non technique installe le VSIX et entend du son immédiatement.
- Owner agent: concierge (Marcel)
- Profile: starter
- Current state: `done`
- Risk level: `low` (UX et packaging ; aucune donnée sortante ajoutée)

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| worktree par story | write | branches `feat/s7-*`, PR vers main | jamais `--force` |
| spd-say / paplay | execute | test local de la voix système | audio uniquement |
| docker compose | execute | vérification du script de configuration guidée | pas de suppression |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| S7.1 voix système zéro installation, S7.2 onboarding, S7.3 commandes | Anthropic | sonnet | opus après 2 échecs | public |
| Revue | Anthropic | sonnet | — | public |
| Gate | Anthropic | fable | — | evidence-pack |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted | retour utilisateur du 2026-09-09 | recorded |
| Implementation complete | 3 PR mergées, VSIX 0.1.1 avec README et parcours | pending |
| Validation complete | test réel : VSIX installé sur un profil vierge sans serveur TTS → son audible | pending |
| Deviations documented | evidence-pack phase-7 | pending |
