# LLM Voice — Extension VS Code pour Narration Vocale

Extension VS Code permettant de transformer en **contenu vocal naturel** documents Markdown, réponses d'agents LLM (Claude Code, Copilot), sélections de code, et contenu presse-papiers via un moteur TTS local (Chatterbox, Kokoro) et un narrateur optionnel (Ollama, llama.cpp).

```
┌─────────────────────────────────┐
│  📄 Document Markdown / Claude  │
└────────────┬────────────────────┘
             │
             ▼
     ┌──────────────────┐
     │  Segmentation    │
     └────────┬─────────┘
              │
             ▼
    ┌─────────────────────┐
    │ Profil (Voix/Prompt)│
    └────────┬────────────┘
             │
             ▼
    ┌─────────────────────┐
    │ TTS Local 🔒        │
    │ (Chatterbox/Kokoro) │
    └────────┬────────────┘
             │
             ▼
      ┌──────────────┐
      │ 🔊 Lecture   │  [⏮ ▶️ ⏭ ■]
      │ Surlignage   │  Professeur ▼
      └──────────────┘
```

## ⚡ Essayer en 5 étapes

1. **VSIX** : téléchargez `llm-voice-0.1.0.vsix` et `code --install-extension llm-voice-0.1.0.vsix`.
2. **Ollama** (narrateur, optionnel) : `curl -fsSL https://ollama.ai/install.sh | sh && ollama pull mistral`.
3. **Chatterbox** (TTS, recommandé) : `docker run -p 8004:8000 resemble-ai/chatterbox:latest --device cuda --language_id fr` (ou [docs/install-linux.md](docs/install-linux.md) pour ROCm/CPU).
4. **VS Code** : ouvrez un `.md` et lancez **LLM Voice: Speak Document** (palette `Ctrl+Shift+P`).
5. **Aucun serveur ?** `LLM_VOICE_TEST_FAKE_TTS=1` avant VS Code pour tester (pas de GPU requis).

## 4 Profils par défaut

| Profil | Voix | Narration | Usage |
|--------|------|-----------|-------|
| **Lecture fidèle** | Chatterbox native | ✗ | Lire tel quel |
| **Professeur** | Teacher | ✓ Ollama (explique) | Concepts techniques |
| **Résumé LLM** | Native | ✓ Ollama (résume) | Réponses Claude |
| **Révision rapide** | Kokoro léger | ✓ Ollama (concis) | Réviser vite |

Profils entièrement personnalisables : prompt, voix, vitesse, mode local/cloud.

## Invariants fondamentaux

- **Zéro autoplay** : rien ne parle automatiquement.
- **Local-first** (🔒 Local) : tout reste sur votre machine par défaut.
- **Provider agnostic** : contrat unique pour toute source et tout TTS.
- **Linux d'abord** : validé Linux ; Windows/macOS CI non validés manuellement.

## Documentation

- **[docs/user-guide.md](docs/user-guide.md)** — installation complète, profils, FAQ.
- **[docs/install-linux.md](docs/install-linux.md)** — VS Code, Ollama, Chatterbox.
- **[docs/providers.md](docs/providers.md)** — contrats TTS/Narrator, presets.
- **[docs/adr/](docs/adr/)** — 11 décisions architecturales.
- **[docs/privacy.md](docs/privacy.md)** — confidentialité, mode local.
- **[docs/security/local-mode.md](docs/security/local-mode.md)** — EgressGuard.

## État du projet

**Version 0.1.0** — MVP complet.

- ✅ Slice vertical (source → TTS → lecteur → surlignage).
- ✅ 4 profils, providers TTS réels, narrateur réel.
- ✅ Inbox Claude Code passive.
- ✅ Mode local + EgressGuard, gestion erreurs.
- ✅ Tests complets (AC-01..17, AC-SEC-01..10).
- ⚠️ Linux ✓ • Windows/macOS CI ⚠

## Commandes principales

`Speak Document` • `Speak Selection` • `Play`/`Pause`/`Stop` • `Select Profile` • `Verify Local Mode`

## Licence

MIT — [LICENSE](LICENSE) — Voice : Chatterbox Multilingual V3 (Resemble AI, MIT).

---

**0.1.0** • [Cahier des charges](cahier-des-charges.md) • [Changelog](CHANGELOG.md) • [Traçabilité](docs/traceability.md)
