# ADR-003 — Capture des réponses Claude Code : plugin + collector Node

- Statut : accepté
- Date : 2026-09-08
- Décideurs : Archie (platform-architect), sur cadrage D7/D8
- Références : CdC §39, §40, §41, §59, §79 ; décisions D3, D7, D8 ; `claude-hook-verification-v1.md`

## Contexte

LLM Voice doit lire la dernière réponse de Claude Code, qui n'expose aucune API
d'historique : le seul point d'extension officiel est le hook `Stop`, dont le
payload contient `last_assistant_message`. Vérifié : CLI et extension VS Code
lisent les mêmes fichiers de settings, les hooks de plusieurs fichiers
s'additionnent, `Stop` ne concerne que l'agent principal. Le hook est un
processus externe sans accès à l'API VS Code : il ne peut écrire que dans un
chemin connu — d'où l'inbox fichier d'ADR-004.

## Décision

### Deux voies d'installation, plugin d'abord

1. **Plugin Claude Code `llm-voice`** (`integrations/claude-code/plugin/`),
   embarquant `.claude-plugin/plugin.json`, `hooks/hooks.json` et
   `scripts/llm-voice-capture.js`. Voie recommandée : activable et désactivable
   sans jamais toucher à `settings.json`, versionnée avec le dépôt.
2. **Commande `LLM Voice: Install Claude Code Hook`** pour qui ne veut pas de
   plugin. Après **consentement explicite** affichant le diff exact, elle ajoute
   une entrée `Stop` dans `~/.claude/settings.json`, écrite en tmp+rename.
   `Uninstall` retire uniquement cette entrée. Jamais d'édition silencieuse.

Avant tout ajout, l'installeur vérifie l'absence de notre commande dans les
**trois** fichiers de settings (utilisateur, projet, local) en comparant le
chemin résolu, pas la chaîne : un `install()` répété ne doit pas produire N
exécutions par réponse.

### Collector

Un **unique** script Node cross-platform, `llm-voice-capture.js` :

```
stdin (JSON du hook) → parse → normalise → tmp (même dossier) → chmod 0600 → rename
```
- Node est déjà requis par Claude Code : ni bash, ni python, ni powershell.
  Remplace les trois variantes du CdC §59.
- **Écriture atomique** : `mkstemp` dans le dossier inbox lui-même (même
  filesystem, sinon `rename` n'est pas atomique) puis `rename`. Jamais d'écriture
  directe : l'extension surveille ce dossier et lirait un JSON tronqué.
- **Permissions** : inbox en `0700`, fichier en `0600`, posés explicitement par
  `chmod` après création — l'umask de l'environnement du hook n'est pas garanti.
  Sur Windows les modes POSIX sont ignorés ; l'inbox est sous le profil
  utilisateur, seule protection disponible.
- **`timeout: 15`** dans `hooks.json` : borne le pire cas disque indisponible.
- **Exit 0 systématiquement** : le collector ne doit jamais faire échouer le hook
  Claude Code. Toute erreur est journalisée sur stderr et le processus sort en 0.
- **`SubagentStop` n'est pas écouté** : chaque sous-agent produirait une entrée
  d'inbox, noyant la réponse finale. Seul `Stop` (agent principal) est capté.
- **Message vide ignoré** : aucun fichier si `last_assistant_message` est vide.

### Schéma JSON déposé

```jsonc
{
  "schemaVersion": 1,
  "provider": "claude-code",
  "sessionId": "abc123",
  "capturedAt": 1757337600000,
  "cwd": "/home/user/projet",   // optionnel
  "title": "Refactor du parser", // optionnel
  "message": "…texte de la réponse…"
}
```
Nom de fichier : `<capturedAt>-<sessionId>-<rand>.json`, préfixe temporaire
`.tmp-` ignoré par le watcher. `schemaVersion` est le point d'extension : un
fichier de version inconnue est affiché comme non lisible, jamais deviné.

Ce schéma est **ouvert** (D8) : Codex, Gemini CLI ou tout outil sachant lancer
une commande déposeront le même format via `--from <provider>` ou la future CLI
`llm-voice-inbox`. Aucun narrateur cloud : ces outils fournissent du texte, la
voix reste la nôtre.

### Zéro autoplay

Le dépôt ne déclenche jamais de lecture : notification discrète et badge, la
lecture reste une action explicite (CdC §41).

## Conséquences

- L'installation par plugin est réversible et n'altère aucun fichier utilisateur.
- Le collector reste un fichier sans dépendance, auditable en une lecture : c'est
  le prix d'un script exécuté par un outil tiers hors du regard de l'utilisateur.
- Un doublon reste possible si Claude Code réémet `Stop` : accepté en 0.1 plutôt
  que d'ajouter un index de déduplication qui peut lui-même corrompre le hook.
  Déduplication par `sha256(sessionId + message)` évaluée en 0.2.
- Les sous-agents ne sont pas lisibles : choix de bruit, réversible par réglage.

## Alternatives rejetées

- **Lecture de l'historique/`~/.claude/projects`** : format interne non
  contractuel, casse à chaque version, et lecture de contenus non consentis.
- **Trois scripts bash/python/powershell (CdC §59)** : trois comportements à
  maintenir, divergences de quoting et d'encodage garanties.
- **Édition automatique de `settings.json` sans consentement** : inacceptable
  pour un fichier appartenant à l'utilisateur.
- **Écoute de `SubagentStop`** : inonde l'inbox, dilue l'information utile.
- **Envoi direct à l'extension (HTTP local, socket)** : ouvre un port, contredit
  D10, et casse quand aucune fenêtre VS Code n'est ouverte.

## Tests qui prouvent la décision

- Unitaire (collector) : un payload `Stop` fixture produit un JSON conforme au
  schéma, `schemaVersion === 1`, `capturedAt` numérique.
- Unitaire : payload sans `last_assistant_message`, JSON invalide sur stdin,
  dossier inbox non inscriptible → aucun fichier créé **et** code de sortie 0.
- Unitaire : aucun fichier `.tmp-*` ne subsiste après un run réussi ; `stat`
  donne `0600` sur le fichier et `0700` sur le dossier (POSIX).
- Unitaire (installeur) : `install()` deux fois n'ajoute qu'une entrée ; une
  entrée existante dans l'un des trois fichiers de settings inhibe l'ajout ;
  `uninstall()` ne retire que la nôtre.
- Intégration : dépôt d'un fichier → apparition dans la liste sans lecture
  déclenchée (assertion : aucun appel TTS).
