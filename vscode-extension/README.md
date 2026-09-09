# LLM Voice

Écoutez vos documents Markdown et les réponses de vos agents LLM (Claude Code) à voix haute — entièrement en local.

```
  📄 votre document               🔊 LLM Voice
  ┌─────────────────────┐         ┌───────────────────────────┐
  │ # Titre              │  Ctrl+Alt+V D  │ ⏮  ▶  ⏭  ■   03:12 │
  │ Un paragraphe ██████ │ ─────────────▶ │ ▬▬▬▬▬▬▬▭▭▭▭▭▭▭▭▭▭▭ │
  │ ▶ Lire cette section │                │ Professeur ▾   🔒  │
  └─────────────────────┘         └───────────────────────────┘
        surlignage synchronisé            mini-player (Panel)
```

## Démarrage en 30 secondes

1. **Installez** l'extension (déjà fait, vous y êtes).
2. **Ouvrez** un fichier `.md`.
3. Appuyez sur **`Ctrl+Alt+V` puis `D`** (ou palette de commandes → **LLM Voice: Speak Document**).

C'est tout — la voix du système démarre immédiatement, sans rien installer. La
palette de commandes (`Ctrl+Shift+P` → **LLM Voice: Setup Voice**) propose
ensuite deux options de meilleure qualité si vous le souhaitez.

## Trois niveaux de voix

| Niveau | Qualité | Installation |
|---|---|---|
| **Voix système** | Correcte | Aucune — utilise la synthèse vocale de votre OS |
| **Piper** (local) | Meilleure | Téléchargement d'un modèle (~60 Mo), 100 % local |
| **Chatterbox** (local) | Meilleure, clonage de voix | Nécessite Docker (`deploy/docker-compose.tts.yml`) |

**LLM Voice: Setup Voice** détecte ce qui est disponible et vous guide — jamais
besoin de deviner un port ou une variable d'environnement.

## 4 profils

| Profil | Usage |
|---|---|
| **Lecture fidèle** | Lire le texte tel quel |
| **Professeur technique** | Concepts techniques expliqués (narration Ollama) |
| **Résumé LLM** | Résumer une réponse Claude avant de la lire |
| **Révision rapide** | Relecture concise et rapide |

**LLM Voice: Select Profile** change de profil ; **LLM Voice: Open Profiles**
édite `profiles.json` (validé par schéma JSON).

## Inbox Claude Code

Les réponses de Claude Code peuvent être capturées automatiquement dans une
inbox dédiée (**LLM Voice: Open Inbox**, **LLM Voice: Speak Latest Claude
Response**). En attendant, **LLM Voice: Speak Clipboard** lit n'importe quel
texte copié.

## La promesse locale

- 🔒 **Aucune donnée ne quitte votre machine** par défaut — texte, audio,
  prompts restent sur `localhost`.
- **LLM Voice: Verify Local Mode** vérifie et affiche le détail (résolution
  DNS, CSP de la webview, dépendances…) plutôt que d'afficher un faux vert.
- Un profil pointant vers un provider distant est signalé clairement (☁)
  avant tout envoi.

## Liens

- [Guide utilisateur](https://github.com/Guilhem-Bonnet/llm-voice/blob/main/docs/user-guide.md) — installation détaillée, FAQ, erreurs courantes.
- [Providers TTS/Narrator](https://github.com/Guilhem-Bonnet/llm-voice/blob/main/docs/providers.md)
- [Installation Linux](https://github.com/Guilhem-Bonnet/llm-voice/blob/main/docs/install-linux.md) — ROCm/CPU, Ollama, Chatterbox.
- [Décisions d'architecture (ADR)](https://github.com/Guilhem-Bonnet/llm-voice/tree/main/docs/adr)
- [Signaler un problème](https://github.com/Guilhem-Bonnet/llm-voice/issues)
- [Changelog](https://github.com/Guilhem-Bonnet/llm-voice/blob/main/vscode-extension/CHANGELOG.md)

MIT — voix par défaut : Chatterbox Multilingual V3 (Resemble AI, MIT).
