<!-- grimoire:managed — régénéré par `grimoire host sync`; éditez la source, pas ce fichier. -->

# Surface Copilot — TTS-Voice

Généré par `grimoire host sync --host copilot`. Source de vérité des
instructions : `.github/copilot-instructions.md`.

| Surface | Contenu |
|---|---|
| Agents | 9 — `.github/agents/` |
| Skills transversales | 2 — `.github/skills/` |
| Skills attachées | 11 — repliées dans le fichier de leur agent |
| Prompts | 5 — `.github/prompts/` |
| Hooks | 7 — `.github/hooks/` |

Les fichiers de hook ne portent pas de marqueur de gestion : ce sont des
JSON purs. C'est la commande invoquée qui dit à qui le fichier
appartient — `grimoire host sync` réécrit ceux qui appellent
`grimoire-hook`, et préserve les autres en les signalant `[!]`.

## Politique de dispatch

Quand l'agent d'entrée route une tranche de travail vers une autre
persona, la classe de vérifiabilité de la tâche (celle que
`grimoire task dispatch` calcule) dit le niveau de confiance à lui
accorder avant de croire son résultat sans relecture :

- **V0** — Tous les critères nomment un verdict qu'un programme rend seul (test, lint, schéma, gate, code de sortie, build/CI, fichier attendu).
- **V1** — Au moins un critère nomme une revue, un jugement ou une validation par une personne ou un agent, et aucun critère ne reste ambigu.
- **V2** — Au moins un critère ne nomme ni verdict mécanique reconnu ni revue reconnue — ou la tâche n'a aucun critère : sa vérifiabilité reste à démontrer.

Cet hôte ne documente aucun nom de modèle par palier : voir la
dégradation « model affinity » ci-dessous, le contrat
`.github/agents/*.agent.md` n'offre rien d'équivalent à `inherit`.
Ce qui reste vrai partout : toute persona routée doit clore sa
réponse par un bloc ```grimoire-uncertainties``` — une liste JSON
d'objets `{"where": ..., "what": ..., "why": ...}` pour ce qu'elle
n'a pas pu vérifier. Sans ce bloc, la réponse n'est pas un résultat
vérifiable, c'est une opinion.

## Hooks bloquants

- `PreToolUse` — Refus des mutations destructrices et des accès secrets, selon le profil de risque.
- `Stop` — Une clôture sans gates verts est une tâche non terminée — la règle devient contrainte ici.

## Dégradations sur cet hôte

- **permissions** — Copilot n'expose pas de table de permissions déclarative. Repli : règles appliquées par le hook PreToolUse (mêmes refus, même formulation).
- **hook matchers** — Les hooks VS Code ne filtrent pas par outil dans leur configuration. Repli : le filtrage se fait dans la décision : un appel en lecture seule sort en `allow` sans effet.
- **model affinity** — L'agent personnalisé VS Code (.github/agents/*.agent.md) accepte un nom de modèle explicite ou une liste de repli via `model`, mais aucune valeur de sélection automatique équivalente à `inherit` n'y est documentée (source : https://code.visualstudio.com/docs/copilot/customization/custom-agents). Repli : `model` n'est pas émis ; le modèle actuel du sélecteur VS Code s'applique à chaque agent.
