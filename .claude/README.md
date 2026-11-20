<!-- grimoire:managed — régénéré par `grimoire host sync`; éditez la source, pas ce fichier. -->

# Surface Claude Code — TTS-Voice

Fichiers générés par `grimoire host sync --host claude`. Les éditer ici est
sans effet durable : la prochaine synchronisation les régénère. Pour
personnaliser, modifiez la source (persona dans `_grimoire/`, skill ou
commande dans le kit) puis resynchronisez.

| Surface | Contenu |
|---|---|
| Sous-agents | 9 — `.claude/agents/` |
| Skills transversales | 2 — `.claude/skills/`, chargées toutes sessions |
| Skills attachées | 11 — repliées dans le fichier de leur agent, payées seulement quand il tourne |
| Commandes | 12 — `.claude/commands/` |
| Hooks | 7 — `.claude/settings.json` |

## Hooks bloquants

- `PreToolUse` — Refus des mutations destructrices et des accès secrets, selon le profil de risque.
- `Stop` — Une clôture sans gates verts est une tâche non terminée — la règle devient contrainte ici.

Un hook bloquant refuse une action ou une clôture. Pour désactiver temporairement la gouvernance, retirez l'entrée de `.claude/settings.json` et n'exécutez pas `grimoire host sync` avant de l'avoir remise.
