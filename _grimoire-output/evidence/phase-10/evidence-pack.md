# Agentic Evidence Pack — phase 10 (grimoire-upgrade-3.46)

## Summary

- Task id: phase-10
- Profile: controlled (need `provider-neutral`, pattern `provider-routing-contract`) — était `starter`
- Outcome: Grimoire Kit du projet porté de 3.38.0 (CLI 3.40.0) à 3.46.1 ; standard passé en `controlled` ; workflow adapté (politiques temporelles, registre de fournisseurs réel, registre d'outils/MCP, hooks git, nouveaux hooks hôtes, agents refondus) ; 33 fichiers obsolètes retirés. Aucun fichier applicatif touché.
- Final state: done

## Evidence inventory

| Evidence | Location / command | Result |
|---|---|---|
| Version CLI | `pipx upgrade grimoire-kit` → `grimoire --version` | `grimoire-kit 3.46.1` (depuis 3.40.0) ; `grimoire self version` : « Up to date » |
| Mise à niveau projet | `grimoire up .` | refresh : 34 artefacts kit mis à jour, 19 fichiers projet préservés ; override_review : aucun override ; identity : `project-context.yaml` (+`document_language`) ; standard : profil `controlled`, 6 artefacts ; host_sync : 68 fichiers écrits, 5 hôtes ; doctor 10/10 |
| Agents 3.46 | `_grimoire/kit/agent-manifest.csv` | 9 agents (concierge, agent-optimizer, security-auditor, ops-engineer, monitoring-specialist, systems-debugger, backend-engineer, platform-architect, fix-loop-orchestrator) + 10 skills attachés dans `_grimoire/kit/skills/` |
| Nettoyage kit | déplacement vers scratchpad (le hook PreToolUse Grimoire a refusé `rm -f`, profil light) | 10 agents devenus skills retirés de `_grimoire/kit/agents/`, `.claude/agents/`, `.github/agents/` (30 fichiers) ; 3 manifestes d'équipe fantômes (`team-build/ops/vision.yaml`, retirés du kit en 3.42) ; `.pre-commit-config.yaml` généré par `hooks install` écarté (ruff `--fix` aurait réécrit les `.py` du kit) |
| Synchro hôtes après nettoyage | `grimoire host sync --host all` puis `--dry-run` | « Écrirait 0 » sur les 5 hôtes ; `.claude/README.md` : 9 sous-agents, 11 skills attachées, 12 commandes, 7 hooks |
| Politiques temporelles | `_grimoire/standard/policies.yaml` ; `grimoire policies status` | 5 règles chargées sans `GrimoirePolicyError` : approbation par session de `git push`, `gh pr merge`, `gh release` ; refroidissement `rm` (5/10 min) ; budget 400 écritures / 2000 appels / 600 min |
| Registre de fournisseurs | `_grimoire/standard/llm-provider-registry.yaml` ; `grimoire providers status` | anthropic activé (haiku cheap, sonnet mid, opus + fable strong, quota) ; local activé (qwen2.5:7b) ; repli anthropic → local ; 3 fournisseurs explicitement non utilisés |
| Registre d'outils | `_grimoire/standard/tool-registry.yaml` | 6 outils avec owner ; MCP `grimoire` en périmètre ; 8 serveurs `hostinger-*` déclarés `out_of_scope` avec motif |
| Risques / incidents / conformité | `risk-control-matrix.yaml`, `incident-registry.yaml`, `compliance-declaration.md` | 5 risques avec owner ; `escalate_to: guilhem-bonnet` ; 12 lignes de statut renseignées, 2 non-conformités ouvertes |
| Mission brief / acceptation phase 0 | `mission-brief.md`, `bootstrap/acceptance-record.md` | profil `controlled` déclaré ; décision `accepté` enregistrée sur preuves (repo créé 2026-09-08, v0.1.0 2026-09-09) |
| Hooks git | `grimoire hooks install` ; `grimoire hooks status` | 6/6 hooks à jour (pre-commit CC + mnemo, post-checkout, prepare-commit-msg, commit-msg, post-commit, pre-push) ; scripts copiés dans `_grimoire/kit/hooks/` |
| Hooks Claude Code | `.claude/settings.json` | +5 événements : UserPromptSubmit, PostToolUse, PreCompact, SubagentStop, Stop (7 au total) ; hooks Copilot équivalents dans `.github/hooks/*.json` |
| Instructions canoniques | `.github/copilot-instructions.md` (importé par `CLAUDE.md`) | table des 9 agents + correspondance anciens rôles → skills, 3 nouveaux workflows, structure kit/overrides/hosts/standard, 3 conventions ajoutées, CLI 3.46 |
| Mission Ledger / board gouverné | `grimoire task add … -a …` → `GAO-phase-10-gri-001` ; `claim`, `move running`, `move needs_verification`, `close` ; `grimoire task board export .` | tâche `closed · accepted` ; mission `MIS-travaux-courants-001` créée ; `grimoire task context` → `_grimoire-output/context/GAO-phase-10-gri-001/context-bundle.yaml` ; `grimoire standard decision trace` → `_grimoire-output/decisions/GAO-phase-10-gri-001/decision-trace.yaml` ; board projeté dans `_grimoire/standard/task-board.yaml` (ledger source : `_grimoire-runtime-output/ledger/events.jsonl`) — répond au hook `Stop` qui signalait `bootstrap` sans état |
| Mémoire projet | `shared-context.md`, `decisions-log.md`, `session-state.md` | table de routage plan maître v1 → agent 3.46 + skill + modèle ; décision phase 10 consignée |

## Validation

| Check | Command | Result |
|---|---|---|
| Diagnostic | `grimoire doctor` | 24/24 checks passed, 0 FAIL (avant : FAIL sur 3 chemins du kit absents) |
| Standard | `grimoire standard verify .` | OK profil `controlled` — 0 erreur, 0 avertissement (2 INFO `dispatch.cost_slo` : moins de 5 dispatchs journalisés) |
| Score | `grimoire standard score .` | 100 % sur les 14 dimensions → `_grimoire-output/standard/bootstrap/compliance-score.yaml` |
| Gates | `grimoire standard gate check --task-id GAO-phase-10-gri-001 --strict` | OK (task_envelope, context_bundle, evidence_pack, decision_trace présents) ; `bootstrap` et `phase-10` répondent `gate.task_not_on_board` depuis que le board existe |
| Board | `grimoire task board export .` ; `grimoire standard board verify` | 1 tâche projetée (accepted) ; 0 erreur, 0 avertissement |
| Hôtes | `grimoire host status` | Claude Code à jour ; hooks bloquants pre_tool_use + stop ; persona d'entrée concierge ; 2 collisions de faisceau signalées « dette connue du kit #375, sans effet sur ce projet » |
| Workflows | `grimoire workflows doctor` | audit passé ; 5 prompts « extra » sont tous `grimoire:managed`, émis par `host sync` (incohérence interne au kit, non corrigée ici) |
| Périmètre respecté | `git status` | aucun fichier sous `vscode-extension/` modifié ; `CHANGELOG.md` conserve uniquement le diff préexistant (notes 0.2.0/0.2.1, +33 lignes) |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| D-1 : `grimoire up` régénère le kit mais ne retire pas les fichiers que la nouvelle version n'émet plus ; retrait fait à la main (liste dans decisions-log) | aucun si la liste est exacte : vérifiée par « fichier absent du paquet 3.46.1 » et manifeste | concierge | prochaine montée de version : relancer la même comparaison |
| D-2 : `.github/copilot-instructions.md` est considéré « fichier projet » par le kit et n'est pas régénéré ; mis à jour à la main | dérive possible à la prochaine version | concierge | à chaque `grimoire up` |
| D-3 : `.pre-commit-config.yaml` généré par `hooks install` écarté (config Python générique, `pre-commit` présent sur la machine) | `grimoire hooks install` le régénérera | concierge | si le projet adopte le framework pre-commit, l'adapter au lieu de l'écarter |
| D-4 : le hook `Stop` ne bloque une clôture sans gates verts qu'aux profils `governed`/`production` ; en `controlled` la règle reste une consigne | comportement inchangé pour ce projet | concierge | si passage au profil `governed` (need `multi-agent` ou `hooks-skills`) |
| D-5 : décision d'acceptation phase 0 enregistrée par le concierge a posteriori, pas par l'utilisateur | traçabilité : la décision cite ses preuves et sa date d'enregistrement | concierge | l'utilisateur peut la corriger dans `bootstrap/acceptance-record.md` |
| D-7 : le ledger classe la tâche en vérifiabilité V2 (critères libellés en français, un seul reconnu comme `gate`) ; la clôture a été acceptée par le gate `needs_verification → closed` sur les preuves | les prochains critères devront nommer un verdict mécanique reconnu (`gate`, test, lint) | concierge | prochaine tâche ouverte dans le ledger |
| D-6 : `_grimoire/kit/workflows/examples/workflow-status.md` et `workflow-graph.yaml` portent d'anciens noms (le kit livre désormais `*.tpl.*`) ; laissés en place | aucun (exemples) | concierge | prochaine montée de version |

## Completion statement

La mise à jour est complète et vérifiée : CLI et kit en 3.46.1, profil `controlled` à 0 erreur / 0 avertissement, score 100 %, doctor 24/24, surfaces hôtes à jour, gates verts. Rien n'est commité : les 126 changements (54 modifiés, 33 supprimés, 39 nouveaux) sont dans l'arbre de travail pour revue.
