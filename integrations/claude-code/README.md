# Intégration Claude Code

LLM Voice lit à la demande les réponses de Claude Code via l'inbox ouverte
(voir `cahier-des-charges.md` et ADR-007 / `decisions-cadrage-v1.md` D7-D8).
Un hook `Stop` dépose la dernière réponse de l'agent dans
`~/.llm-voice/inbox/` sous forme d'un fichier JSON. **Rien n'est jamais lu
automatiquement** : le dépôt dans l'inbox ne déclenche aucune lecture audio.

Deux façons d'installer le hook, la première recommandée.

## 1. Plugin Claude Code (recommandé)

Le plugin `llm-voice` (dossier [`plugin/`](./plugin/)) embarque :

- [`plugin/.claude-plugin/plugin.json`](./plugin/.claude-plugin/plugin.json) —
  manifeste du plugin.
- [`plugin/hooks/hooks.json`](./plugin/hooks/hooks.json) — déclare un hook
  `Stop` qui exécute le collector Node.
- [`plugin/scripts/llm-voice-capture.js`](./plugin/scripts/llm-voice-capture.js)
  — lit `last_assistant_message` sur stdin et l'écrit dans l'inbox.

Installation (Claude Code CLI) :

```bash
claude plugin install <chemin-ou-marketplace>/llm-voice
```

Le plugin est activable/désactivable sans toucher à `settings.json`.

## 2. Commande VS Code (alternative)

Pour ceux qui n'utilisent pas les plugins Claude Code, la commande **"LLM
Voice: Install Claude Code Hook"** de l'extension VS Code ajoute, après
consentement explicite, une entrée `Stop` équivalente dans
`~/.claude/settings.json` (après avoir vérifié son absence dans les trois
fichiers de settings). La commande **"LLM Voice: Uninstall Claude Code
Hook"** retire uniquement cette entrée. Aucune édition silencieuse de
`settings.json` n'est jamais effectuée.

## Emplacement de l'inbox

Par défaut : `~/.llm-voice/inbox/`. Surchargeable via la variable
d'environnement `LLM_VOICE_INBOX`. Chaque fichier déposé respecte le schéma
`{schemaVersion, provider, sessionId, capturedAt, cwd, title?, message}` et
est écrit de façon atomique (fichier temporaire puis renommage) avec les
permissions `0600`.
