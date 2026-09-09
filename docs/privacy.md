# Politique de Confidentialité — LLM Voice

> LLM Voice, extension VS Code pour narration vocale — version 0.1.0

## Principes

LLM Voice est conçu pour **fonctionner entièrement en local par défaut**. Aucun contenu utilisateur (documents, prompts, audio, réponses LLM) n'est envoyé à un service tiers sans configuration explicite.

## Données stockées localement

Par défaut, tous les éléments suivants **restent sur votre machine** :

- **Documents Markdown et sélections** : traités localement par l'extension.
- **Réponses Claude Code** : stockées dans `~/.llm-voice/inbox/` avec permissions `0700`.
- **Profils de narration** : stockés dans VS Code `globalStorageUri`.
- **Cache audio généré** : stocké sur disque dans `globalStorageUri`, configurable via `llmVoice.cache.maxSizeMb`.
- **Prompts de narration** : restent locaux, transmis uniquement à un serveur Ollama/llama.cpp en local via HTTP localhost.

## Transmission vers des services distants

### Mode local (par défaut, 🔒 Local)

Aucune transmission.

### Mode providers distants (☁ Remote provider)

Si vous configurez un provider distant (OpenAI, ElevenLabs, ou API custom), le comportement change :

- **TTS distant** : le texte à synthétiser est envoyé au serveur configuré.
- **Narrator distant** : le contenu à transformer est envoyé au serveur distant.

**Vous êtes averti explicitement** via le badge `☁ Remote provider` visible dans la barre de statut.

Avant d'activer un provider distant, consultez sa politique de confidentialité.

## Données jamais collectées

Même si une télémétrie était ajoutée ultérieurement :

- ❌ Jamais votre contenu texte ou audio.
- ❌ Jamais vos prompts de narration.
- ❌ Jamais le contenu de vos réponses Claude.
- ❌ Jamais vos chemins de fichiers ou répertoires.

Seules des métriques techniques anonymes pourraient être collectées (ex. "nombre de documents lus", "durée moyenne d'une session"), avec opt-in explicite.

## Clés d'API cloud

Les clés API (OpenAI, etc.) sont stockées **exclusivement** via VS Code `SecretStorage`, qui les chiffre et ne les synchronise pas entre machines. Jamais en clair dans les fichiers de configuration.

## Suppression de toutes les données

Pour supprimer entièrement vos données locales :

1. **Cache audio** : `LLM Voice: Clear Audio Cache` (commande).
2. **Inbox Claude** : supprimez manuellement `~/.llm-voice/inbox/` (permissions `0700` : vous êtes le seul propriétaire).
3. **Profils** : effacez `globalStorageUri/profiles.json` via `LLM Voice: Open Profiles`.
4. **Secrets** : `LLM Voice: Clear Provider API Key` pour chaque clé sauvegardée.

## Mode local détaillé

Voir [`docs/security/local-mode.md`](./security/local-mode.md) pour une documentation technique sur le fonctionnement en local complet, l'architecture de blocage HTTP (EgressGuard), et la vérification du mode local.

## Contact

Pour toute question de confidentialité ou de sécurité, ouvrez une issue sur le dépôt du projet.

---

**Version** : 0.1.0  
**Dernière mise à jour** : 2026-09-09
