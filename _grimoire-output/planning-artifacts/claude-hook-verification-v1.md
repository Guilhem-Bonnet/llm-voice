# Vérification factuelle — hook `Stop` de Claude Code

> Agent guide Claude Code (Sonnet), 2026-09-08. Sources : docs officielles
> code.claude.com (settings.md, vs-code.md, hooks.md, hooks-guide.md) + lecture
> locale de `~/.claude/settings.json`.

| Point | Fait vérifié | Source |
|---|---|---|
| Fichiers lus | managed → `--settings` → `.claude/settings.local.json` → `.claude/settings.json` → `~/.claude/settings.json` | settings.md |
| Fusion | les listes `hooks` **s'additionnent** entre fichiers, aucun niveau n'écrase les autres | settings.md « Lists merge instead of overriding » |
| Extension VS Code | mêmes hooks, mêmes fichiers que le CLI ; aucune différence pour `Stop` | vs-code.md |
| stdin de `Stop` | `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `effort.level`, `hook_event_name`, `stop_hook_active`, **`last_assistant_message`** | hooks.md |
| `last_assistant_message` | officiel, recommandé par la doc à la place du parsing de `transcript_path` (JSONL écrit de façon asynchrone, peut être en retard) | hooks.md |
| Sous-agents | événement distinct `SubagentStop` ; `Stop` = agent principal uniquement ; `matcher` ignoré sur `Stop` | hooks.md |
| Timeout | 600 s par défaut ; dépassement = hook annulé silencieusement, l'arrêt n'est pas bloqué | hooks.md |
| Local | `~/.claude/settings.json` ne contient qu'un `PreToolUse` (rtk) ; **aucun hook `Stop`** | lecture locale |
| Mécanisme officiel | plugin avec `hooks/hooks.json`, actif quand le plugin est activé ; le menu `/hooks` est en lecture seule | hooks-guide.md |
| Non vérifié | existence d'une sous-commande `claude hooks add/remove` | — |

## Entrée minimale à insérer

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node ~/.llm-voice/hooks/llm-voice-capture.js", "timeout": 15, "statusMessage": "LLM Voice: capture..." } ] }
    ]
  }
}
```

## Conséquences pour LLM Voice

1. Le collector lit `last_assistant_message` sur stdin ; pas de parsing JSONL. Le CdC §39 est confirmé.
2. Le collector doit sortir en < 15 s et toujours en exit 0 (ne jamais bloquer Claude).
3. Deux voies d'installation : (a) **plugin Claude Code** `llm-voice` embarquant `hooks/hooks.json` = voie officielle, réversible par désactivation du plugin ; (b) édition ciblée de `~/.claude/settings.json` par la commande `Install Claude Code Hook`, repérage par la sous-chaîne `llm-voice-capture`, jamais d'autre modification.
4. Le collector doit être écrit en Node (déjà requis par VS Code) plutôt qu'en bash/python/powershell : un seul script cross-platform, pas de dépendance à Python sur Windows. Les variantes `.sh/.py/.ps1` du CdC §59 deviennent optionnelles.
5. Comme les hooks de plusieurs fichiers s'additionnent, un hook déjà présent au niveau projet ne doit pas être dupliqué au niveau utilisateur : la commande d'installation cherche `llm-voice-capture` dans les trois fichiers avant d'écrire.
