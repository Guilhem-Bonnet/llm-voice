<!-- grimoire:managed — régénéré par `grimoire host sync`; éditez la source, pas ce fichier. -->

# Surface Claude Code — TTS-Voice

Fichiers générés par `grimoire host sync --host claude`. Les éditer ici est
sans effet durable : la prochaine synchronisation les régénère. Pour
personnaliser, modifiez la source (persona dans `_grimoire/`, skill ou
commande dans le kit) puis resynchronisez.

| Surface | Contenu |
|---|---|
| Sous-agents | 18 — `.claude/agents/` |
| Skills | 2 — `.claude/skills/` |
| Commandes | 9 — `.claude/commands/` |
| Hooks | 2 — `.claude/settings.json` |

## Hooks bloquants

- `PreToolUse` — Refus des mutations destructrices et des accès secrets, selon le profil de risque.

Un hook bloquant refuse une action ou une clôture. Pour désactiver temporairement la gouvernance, retirez l'entrée de `.claude/settings.json` et n'exécutez pas `grimoire host sync` avant de l'avoir remise.
