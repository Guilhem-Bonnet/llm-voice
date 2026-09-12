# Checklist de test — LLM Voice, version de développement 0.2

VSIX construit depuis `main` (commit `9d1606b`). Environ 20 minutes.
Coche ce qui marche, note le numéro de ce qui casse.

## Installation

```bash
code --install-extension /tmp/claude-1000/-mnt-Travail-Projets-Dev-TTS-Voice/389c7bfc-f6bb-4fe0-8f7c-a67d861aaed1/scratchpad/llm-voice-0.2-dev.vsix --force
```
Puis recharge la fenêtre VS Code.

1. [ ] Un parcours « Démarrer avec LLM Voice » s'ouvre tout seul.
2. [ ] La page de l'extension (onglet Extensions → LLM Voice) affiche une vraie description.

## Partie A — le parcours d'un nouvel utilisateur, sans Chatterbox

C'est le cœur de ce que tu as demandé. **Arrête d'abord Chatterbox** :
```bash
docker compose -f deploy/docker-compose.tts.yml stop chatterbox
```

3. [ ] Ouvre un fichier Markdown, puis `Ctrl+Alt+V` `D` (ou palette → « LLM Voice: Speak Document »).
4. [ ] **Aucune erreur exigeant Chatterbox.** Soit ça parle immédiatement, soit une seule proposition d'installer la voix française apparaît.
5. [ ] Si tu acceptes l'installation : barre de progression, puis **la lecture démarre toute seule** sans avoir à relancer la commande.
6. [ ] **Écoute la voix par défaut et donne-moi ton avis** : acceptable pour quelqu'un qui découvre l'extension, ou trop synthétique ?
7. [ ] Le passage lu est surligné dans l'éditeur et le surlignage avance.
8. [ ] `Ctrl+Alt+V` `Espace` met en pause puis reprend.
9. [ ] Palette → « LLM Voice: Play » sans rien en cours : démarre le document actif (ne fait plus rien de muet).

## Partie B — voix et profils

```bash
docker compose -f deploy/docker-compose.tts.yml start chatterbox
```
Attends une trentaine de secondes.

10. [ ] « LLM Voice: Browse Voices » : la liste s'affiche, chaque voix a un bouton d'écoute qui joue un extrait sans fermer la liste.
11. [ ] Les voix anglophones sont signalées comme telles quand le profil est en français.
12. [ ] Choisir une voix l'applique au profil courant.
13. [ ] « LLM Voice: Edit Profile » : l'éditeur graphique s'ouvre, le bouton Tester lit la phrase de référence sans sauvegarder.
14. [ ] « LLM Voice: Use My Own Voice » : l'assistant explique le consentement et propose fichier ou enregistrement.
15. [ ] « LLM Voice: Provider Status » liste Chatterbox et Ollama en Ready.

## Partie C — Claude Code et confidentialité

16. [ ] « LLM Voice: Install Claude Hook » → choisis une des deux voies proposées.
17. [ ] Lance une tâche dans Claude Code et laisse-la finir. **Aucun son ne doit se déclencher.** C'est l'invariant le plus important du projet.
18. [ ] « LLM Voice: Open Inbox » liste la réponse, et tu peux la lire à la demande.
19. [ ] « LLM Voice: Verify Local Mode » affiche le cadenas et ses contrôles.
20. [ ] « LLM Voice: Uninstall Claude Hook » remet ton fichier de configuration comme avant.

## Retour attendu

Pour chaque échec : le numéro, ce qui s'est passé, et si possible le contenu du panneau Sortie « LLM Voice » après avoir mis `llmVoice.log.level` sur `debug`.
Et surtout ta réponse au point 6, qui décide de la voix par défaut de la 0.2.
