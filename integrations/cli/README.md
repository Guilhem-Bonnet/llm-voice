# `llm-voice-inbox` — CLI d'inbox ouverte

Voir ADR-007 (protocole d'inbox ouvert). Aucune dépendance, Node uniquement.

Pour tout outil sachant lancer une commande ou piper sa sortie (Kimi, Qwen
Code, DeepSeek, Grok, autres CLI) et n'ayant ni hook ni mécanisme `notify`
natif.

## Usage

```bash
echo "Texte capturé" | node llm-voice-inbox.js add --provider mon-outil
```

Options :

- `--provider <nom>` (obligatoire) : identifiant libre de l'outil source.
- `--title <titre>` (optionnel).
- `--cwd <dossier>` (optionnel, défaut : répertoire courant).
- `--session-id <id>` (optionnel, défaut : identifiant généré).

Le message est lu sur **stdin**. Un stdin vide n'écrit rien (exit 0).

## Emplacement de l'inbox

Même résolution que le collector Claude Code : `$LLM_VOICE_INBOX` sinon
`~/.llm-voice/inbox/`. Écriture atomique (fichier temporaire `.tmp-*` puis
renommage), permissions `0600` sur le fichier, `0700` sur le dossier.
