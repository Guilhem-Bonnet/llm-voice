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

C'est tout — la voix démarre immédiatement, sans Docker, sans Python, sans
terminal. Si aucune voix locale n'est encore installée, une seule notification
propose de télécharger la voix française autonome (~60 Mo, une fois) ; en cas
de refus ou hors ligne, la voix système de votre OS prend le relais
honnêtement — jamais d'erreur sans solution.

## Trois niveaux de voix

| Niveau | Qualité | Installation |
|---|---|---|
| **Voix système** | Correcte | Aucune — utilise la synthèse vocale de votre OS |
| **Voix française autonome (Piper, recommandé)** | Meilleure, 100 % locale | Téléchargement automatique au premier `Speak` (~60 Mo, une fois) — aucun Docker, aucun serveur |
| **Qualité maximale (avancé)** | Meilleure, clonage de voix | Nécessite Docker (`deploy/docker-compose.tts.yml`) — pour qui le veut, jamais par défaut |

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

MIT — voix locale autonome par défaut : Piper (rhasspy, MIT) + voix française
`fr_FR-siwis-medium` (CC0) ; Chatterbox Multilingual V3 (Resemble AI, MIT)
reste disponible pour qui active le niveau « Qualité maximale ».
