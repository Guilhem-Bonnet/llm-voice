# Agentic Task Envelope — phase 10

## Task

- Task id: phase-10 (grimoire-upgrade-3.46)
- Request: mettre à jour le Grimoire du projet (CLI 3.40.0 → 3.46.1, kit projet 3.38.0 → 3.46.1), adapter le workflow du projet aux meilleurs apports de la nouvelle version, puis nettoyer.
- Owner agent: concierge (Marcel) — exécution directe, sans sous-agent (tâche d'outillage, pas de code applicatif).
- Profile: starter → controlled attendu (l'archétype `agentic-standard` déclaré l'exige depuis 3.46.1).
- Current state: `done`
- Risk level: `low` — aucun fichier sous `vscode-extension/src` touché ; tout est régénérable par `grimoire up` ; snapshot git disponible (`git stash`/`git checkout`).

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| Bash lecture (cat, grep, find, git status/diff/log) | read-only | projet entier + `/mnt/Travail/Projets/Dev/Grimoire-Forge/grimoire-kit` (changelog, docs) | aucun |
| `pipx upgrade grimoire-kit` | write | environnement utilisateur | réversible (`pipx install grimoire-kit==3.40.0`) |
| `grimoire up`, `grimoire hooks install`, `grimoire workflows sync/prune`, `grimoire standard init/fix` | write | `_grimoire/`, `_grimoire-output/`, `.claude/`, `.github/`, `.codex/`, `.cursor/`, `.gemini/`, `project-context.yaml`, `CLAUDE.md`, `.git/hooks/` | jamais `vscode-extension/src/**`, jamais `CHANGELOG.md` (diff en attente non lié) |
| Édition manuelle | write | `_grimoire/standard/policies.yaml`, `llm-provider-registry.yaml`, `shared-context.md`, `decisions-log.md`, evidence phase-10 | pas de suppression de preuve existante |
| Suppression | write | fichiers de sauvegarde/snapshots produits par la migration, artefacts hôtes orphelins signalés par `doctor`/`workflows doctor` | uniquement après listing, jamais `_grimoire/_memory/**` |

## Exit criteria

1. `grimoire --version` = 3.46.1 et `grimoire doctor` sans FAIL.
2. `grimoire standard verify .` : 0 erreur ; `grimoire standard gate check --task-id bootstrap --strict` OK.
3. Surfaces hôtes synchronisées (`grimoire host sync --dry-run` ne trouve plus rien à écrire).
4. Workflow adapté : politiques temporelles, registre de fournisseurs reflétant le routage réel (Fable orchestration / Sonnet / Haiku / Ollama), hooks git installés, nouveaux agents/skills documentés dans shared-context.
5. Nettoyage : aucun fichier de sauvegarde ni artefact orphelin dans `git status` ; décision consignée dans decisions-log.
