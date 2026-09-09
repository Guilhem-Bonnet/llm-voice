# Checklist de test manuel — LLM Voice 0.1.0

Release : https://github.com/Guilhem-Bonnet/llm-voice/releases/tag/v0.1.0
Durée estimée : 15 minutes. Coche ce qui marche, note ce qui casse.

## Installation

```bash
cd /tmp && gh release download v0.1.0 --repo Guilhem-Bonnet/llm-voice --pattern '*.vsix'
code --install-extension llm-voice.vsix
# Chatterbox doit tourner (déjà le cas) :
curl -s localhost:8004/health
```

1. [ ] L'extension apparaît dans la liste des extensions, sans erreur dans l'Output « LLM Voice ».

## Lecture

2. [ ] Ouvre un fichier Markdown, palette de commandes → « LLM Voice: Speak Document ». Le son démarre en ~4 s.
3. [ ] La phrase lue est surlignée dans l'éditeur et le surlignage avance.
4. [ ] Le mini-player apparaît dans le Panel (3 lignes, barre de progression, 5 boutons).
5. [ ] Pause puis reprise : la lecture repart où elle s'était arrêtée.
6. [ ] Stop : le son s'arrête et le surlignage disparaît.
7. [ ] Sélectionne un paragraphe → « Speak Selection » : seule la sélection est lue.
8. [ ] Clique sur un CodeLens « Lire cette section » au-dessus d'un titre.
9. [ ] Relance le même document : le son démarre instantanément (cache).

## Profils et voix

10. [ ] « LLM Voice: Select Profile » : les 4 profils sont proposés.
11. [ ] « LLM Voice: Test Voice » lit la phrase de référence.
12. [ ] Un profil avec narration (Professeur technique) reformule le texte au lieu de le lire mot à mot. Ollama doit tourner.

## Claude Code

13. [ ] « LLM Voice: Install Claude Hook » → choisis « Plugin » ou « Éditer settings.json » (sauvegarde .bak créée).
14. [ ] Lance une tâche dans Claude Code et laisse-la finir. **Aucun son ne doit se déclencher.**
15. [ ] « LLM Voice: Open Inbox » : la réponse est listée.
16. [ ] Lis-la depuis l'inbox avec le profil Résumé LLM.
17. [ ] « LLM Voice: Uninstall Claude Hook » remet ton settings.json comme avant.

## Sécurité et confidentialité

18. [ ] « LLM Voice: Verify Local Mode » affiche le badge verrouillé et 10 contrôles verts.
19. [ ] « LLM Voice: Provider Status » montre Chatterbox et Ollama en Ready.
20. [ ] Arrête Chatterbox (`docker compose -f deploy/docker-compose.tts.yml stop chatterbox`) puis « Speak Document » : message d'erreur avec Retry, aucun plantage. Relance le conteneur ensuite.

## Retour

Note pour chaque point en échec : numéro, ce qui s'est passé, contenu de l'Output « LLM Voice » en niveau debug (`llmVoice.log.level`).
