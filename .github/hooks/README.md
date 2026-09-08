<!-- grimoire:managed — régénéré par `grimoire host sync`; éditez la source, pas ce fichier. -->

# Surface Copilot — TTS-Voice

Généré par `grimoire host sync --host copilot`. Source de vérité des
instructions : `.github/copilot-instructions.md`.

| Surface | Contenu |
|---|---|
| Agents | 18 — `.github/agents/` |
| Skills | 2 — `.github/skills/` |
| Prompts | 2 — `.github/prompts/` |
| Hooks | 2 — `.github/hooks/` |

Les fichiers de hook ne portent pas de marqueur de gestion : ce sont des
JSON purs. C'est la commande invoquée qui dit à qui le fichier
appartient — `grimoire host sync` réécrit ceux qui appellent
`grimoire-hook`, et préserve les autres en les signalant `[!]`.

## Hooks bloquants

- `PreToolUse` — Refus des mutations destructrices et des accès secrets, selon le profil de risque.

## Dégradations sur cet hôte

- **permissions** — Copilot n'expose pas de table de permissions déclarative. Repli : règles appliquées par le hook PreToolUse (mêmes refus, même formulation).
- **hook matchers** — Les hooks VS Code ne filtrent pas par outil dans leur configuration. Repli : le filtrage se fait dans la décision : un appel en lecture seule sort en `allow` sans effet.
