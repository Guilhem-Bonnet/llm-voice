<!-- grimoire:managed — régénéré par `grimoire host sync`; éditez la source, pas ce fichier. -->

# TTS-Voice — Gemini CLI

Projet **Grimoire Kit**. Instructions canoniques : [`.github/copilot-instructions.md`](.github/copilot-instructions.md).

Cet hôte lit des instructions et parle MCP ; il n'exécute ni sous-agents, ni
compétences chargées à la demande, ni hooks de cycle de vie. Ce fichier tient
donc lieu de catalogue : tout ce qui suit s'active en lisant un fichier ou en
lançant une commande.

## Personas

| Persona | Rôle | Définition | Outils |
|---|---|---|---|
| `agent-optimizer` | Agent Quality Assurance & Optimizer — Sentinel | `_grimoire/kit/agents/agent-optimizer.md` | read, search, edit, execute |
| `art-director` | Art Director — Visual identity, prompt aesthetics, output formatting | `_grimoire/kit/agents/art-director.md` | read, search, edit, execute |
| `backend-engineer` | Backend Engineer — Stack | `_grimoire/kit/agents/backend-engineer.md` | read, search, edit, execute |
| `backup-dr-specialist` | Backup & Disaster Recovery Specialist — Phoenix | `_grimoire/kit/agents/backup-dr-specialist.md` | read, search, edit, execute |
| `concierge` (entrée) | Concierge — Triage, clarification, routage intelligent vers l'agent adapté | `_grimoire/kit/agents/concierge.md` | read, search, edit, execute |
| `creative-toolsmith` | Creative Toolsmith — Tool design, framework extension, automation patterns | `_grimoire/kit/agents/creative-toolsmith.md` | read, search, edit, execute |
| `deploy-orchestrator` | Deploy Orchestrator — Convoy | `_grimoire/kit/agents/deploy-orchestrator.md` | read, search, edit, execute |
| `fix-loop-orchestrator` | Closed-Loop Fix Orchestrator — zéro 'done' sans preuve d'exécution réelle | `_grimoire/kit/agents/fix-loop-orchestrator.md` | read, search, edit, execute |
| `k8s-navigator` | Kubernetes & GitOps Navigator — Helm | `_grimoire/kit/agents/k8s-navigator.md` | read, search, edit, execute |
| `memory-keeper` | Memory Keeper & Knowledge Quality — Mnemo | `_grimoire/kit/agents/memory-keeper.md` | read, search, edit, execute |
| `monitoring-specialist` | Monitoring & Observability Specialist — Hawk | `_grimoire/kit/agents/monitoring-specialist.md` | read, search, edit, execute |
| `ops-engineer` | Infrastructure & DevOps Engineer — Forge | `_grimoire/kit/agents/ops-engineer.md` | read, search, edit, execute |
| `pipeline-architect` | CI/CD & Automation Specialist — Flow | `_grimoire/kit/agents/pipeline-architect.md` | read, search, edit, execute |
| `platform-architect` | Platform Architect — Archie | `_grimoire/kit/agents/platform-architect.md` | read, search, edit |
| `project-navigator` | Project Knowledge Curator & Navigator — Atlas | `_grimoire/kit/agents/project-navigator.md` | read, search, edit, execute |
| `reliability-engineer` | Reliability Engineer (SRE) — Guardian | `_grimoire/kit/agents/reliability-engineer.md` | read, search, edit, execute |
| `security-hardener` | Security & Compliance Specialist — Vault | `_grimoire/kit/agents/security-hardener.md` | read, search, edit, execute |
| `systems-debugger` | Systems Debugger & Linux Internals — Probe | `_grimoire/kit/agents/systems-debugger.md` | read, search, edit, execute |

Activer une persona = lire sa définition en entier et l'appliquer, sans la
résumer. Aucun contexte n'est isolé sur cet hôte : la persona s'ajoute à la
conversation courante au lieu de s'exécuter à part.

## Compétences

| Compétence | Quand l'utiliser | Contenu |
|---|---|---|
| `grimoire-agent-dispatch` | Choisir et activer la bonne persona Grimoire du projet. À utiliser quand une demande relève clairement d'un rôle (architecture, tests, documentation, sécurité, produit) plutôt que d'une exécution directe, ou quand l'utilisateur demande un avis spécialisé. | `_grimoire/hosts/skills/grimoire-agent-dispatch.md` |
| `grimoire-memory` | Mémoire projet Grimoire : retrouver une décision passée, un incident ou une convention, et consigner ce qui doit survivre à la session. À utiliser avant de reprendre un sujet déjà traité, et après toute décision non déductible du code. | `_grimoire/hosts/skills/grimoire-memory.md` |

Aucun chargement automatique ici : lire le fichier quand la situation décrite se présente.

## Commandes

| Commande | Effet |
|---|---|
| `grimoire host run grimoire-changelog` | Génère un CHANGELOG structuré depuis git history et les décisions Grimoire |
| `grimoire host run grimoire-doctor [--fix]` | Diagnostiquer et réparer l'installation Grimoire du projet |
| `grimoire host run grimoire-dream` | Dream Mode — consolidation hors-session, patterns cross-domaine, insights émergents |
| `grimoire host run grimoire-health-check` | Health check complet du projet Grimoire — agents, mémoire, config, intégrité |
| `grimoire host run grimoire-pre-push` | Validation pre-push — intégrité agents, qualité code, mémoire, tests si disponibles |
| `grimoire host run grimoire-recall <sujet>` | Chercher une décision, un incident ou une convention en mémoire projet |
| `grimoire host run grimoire-self-heal` | Auto-diagnostic et réparation Grimoire — identifie et corrige les problèmes courants |
| `grimoire host run grimoire-session-bootstrap` | Bootstrap une nouvelle session Grimoire — contexte projet, historique, état git, santé |
| `grimoire host run grimoire-status` | Tableau de bord Grimoire — agents actifs, mémoire, activité récente, état projet |

## MCP

Serveurs déclarés dans `.mcp.json` : `grimoire`.

## Gouvernance

- **session_start** — Directive de session — mécanisme mesuré 40/40 contre 0/40 sans lui (campagne 2026-07-09).
- **pre_tool_use** — Refus des mutations destructrices et des accès secrets, selon le profil de risque.

Sur cet hôte, ces règles ne sont pas opposables : rien n'intercepte un appel
d'outil ni une fin de tour. Elles tiennent par discipline, et par la CI.
