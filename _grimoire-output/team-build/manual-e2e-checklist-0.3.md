# Checklist de test manuel — LLM Voice 0.3.0 (moteur natif, Fedora/Wayland)

Version installée : 0.3.0, `llmVoice.audio.engine: "native"`, journaux en `debug`.
Coche ce qui marche. Pour ce qui casse : le numéro et une phrase suffisent, je lis le journal moi-même.

## Pré-contrôle automatique (fait le 2026-09-29, rien à faire de ton côté)

| Contrôle | Résultat |
|---|---|
| Tests unitaires | 1 028 verts |
| Intégration VS Code sans écran (7 suites) | toutes vertes : 63 + 1 + 1 + 2 + 1 + 1 + 8 tests |
| Services réels : Chatterbox, clonage de voix, latence, narrateur Ollama | 10 verts sur 11 ; l'échec restant est un test qui attend espeak-ng alors que ta machine a Piper (dette de test, pas un défaut) |
| Démon Core : 33 attaques de sécurité | 0 faille |
| Son de bout en bout extension → Core → PipeWire | phrase retranscrite en entier |
| Ollama | en ligne, `qwen2.5:7b` présent |
| Chatterbox | conteneur en ligne depuis 7 jours |
| Voix Piper française | installée |
| **Hook Claude Code** | **non installé** : la section E commence par l'installer |

## A. Démarrage

1. [ ] L'icône LLM Voice est dans la barre d'activité ; la vue s'ouvre avec Lecture en cours, Inbox, Profils.
2. [ ] Panneau Sortie → « LLM Voice » : la ligne `llmVoice.audio.engine=native` apparaît au premier usage.
3. [ ] « LLM Voice: Open Walkthrough Example » ouvre l'exemple (depuis le dossier 0.3.0).

## B. Lecture

4. [ ] « Speak Document » sur un Markdown : le son démarre sans cliquer dans le lecteur.
5. [ ] La phrase entendue est surlignée dans l'éditeur, et le surlignage avance au bon rythme.
6. [ ] Aucun blanc ni coupure entre deux phrases ; le dernier mot n'est jamais coupé.
7. [ ] Pause puis Lecture : reprise exactement où ça s'était arrêté.
8. [ ] Phrase suivante / précédente, puis Stop : le son s'arrête et le surlignage disparaît.
9. [ ] Raccourcis : `Ctrl+Alt+V` puis `D` (document), `S` (sélection), `C` (presse-papiers), `Espace` (lecture/pause), `X` (stop), `N` / `P` (suivant/précédent).
10. [ ] « Speak Selection » : seule la sélection est lue.
11. [ ] « Speak From Cursor » : la lecture part du curseur.
12. [ ] CodeLens « Lire cette section » au-dessus d'un titre : seule la section est lue.
13. [ ] « Speak Clipboard » : le texte copié est lu.
14. [ ] Relire le même document : démarrage immédiat (cache).
15. [ ] « Clear Highlight » et « Clear Audio Cache » répondent par un message clair.

## C. Voix

16. [ ] « Browse Voices » : liste avec bouton d'écoute ; choisir une voix l'applique au profil courant.
17. [ ] **Après avoir choisi une voix, elle reste choisie** : pas de nouvelle demande de téléchargement, et Lecture ne dit pas « aucune voix » (bogue que tu as signalé).
18. [ ] « Test Voice » lit la phrase de référence avec la voix du profil.
19. [ ] Changer de moteur : voix système, Piper, Chatterbox (Docker tourne) ; l'accent est français dans les trois cas.
20. [ ] « Use My Own Voice » : consentement, enregistrement ou fichier, puis test de la voix clonée (Chatterbox).

## D. Profils et narration

21. [ ] « Select Profile » propose les profils ; le profil actif apparaît dans la barre d'état.
22. [ ] Vue Profils : activer, créer, dupliquer, supprimer.
23. [ ] « Edit Profile » (éditeur graphique) : modifier langue, voix, vitesse ; « Tester » sans sauvegarder ; « Enregistrer » persiste.
24. [ ] « Export Profile » puis « Import Profile » sur le fichier exporté.
25. [ ] Profil « Professeur technique » ou « Résumé LLM » : le texte est reformulé avant lecture (Ollama, qwen2.5:7b).

## E. Claude Code (zéro lecture automatique)

26. [ ] « Install Claude Hook » : choisis l'installation ; une sauvegarde de ton `~/.claude/settings.json` est créée.
27. [ ] Lance une tâche dans Claude Code et laisse-la finir : **aucun son ne doit se déclencher.**
28. [ ] La réponse apparaît dans l'Inbox (non lue).
29. [ ] Depuis l'Inbox : lire, ouvrir la réponse complète, marquer lu, supprimer.
30. [ ] « Speak Latest Claude Response » lit la dernière réponse.
31. [ ] « Uninstall Claude Hook » remet ton `settings.json` comme avant.

## F. Confidentialité et diagnostic

32. [ ] « Verify Local Mode » : badge local et contrôles verts.
33. [ ] « Provider Status » : Piper, Chatterbox et Ollama prêts.
34. [ ] « Show Performance Report » affiche des mesures.
35. [ ] Menu de la barre d'état : les actions s'ouvrent.

## G. Robustesse (ce que seule ta machine peut tester)

36. [ ] Réglages son de Fedora : un flux « LLM Voice » apparaît pendant la lecture ; le déplacer vers une autre sortie fonctionne et reste mémorisé.
37. [ ] Casque USB débranché puis rebranché pendant une lecture : pas de plantage.
38. [ ] Mise en veille pendant une lecture, puis réveil : l'extension répond encore.
39. [ ] Deux fenêtres VS Code lancent une lecture : jamais deux voix en même temps.
40. [ ] Arrêter Chatterbox (`docker stop deploy-chatterbox-1`) puis lire avec un profil Chatterbox : message clair avec Réessayer, pas de plantage ; relance-le ensuite (`docker start deploy-chatterbox-1`).

## Connu, pas la peine de le signaler

- Les descriptions des réglages sont écrites pour des développeurs (carte Kanban ouverte).
- La lecture de PDF/DOCX, le Dialogue avec tes modèles et le mode Auto ne sont pas encore codés.
