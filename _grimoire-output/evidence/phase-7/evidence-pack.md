# Agentic Evidence Pack

## Summary

- Task id: phase-7
- Profile: starter
- Outcome: Les quatre défauts d'expérience remontés par l'utilisateur sur la 0.1.0 sont corrigés et publiés en **0.1.1** : voix système sans aucune installation, installation guidée de Piper avec vérification d'intégrité, sélection automatique du provider, README et métadonnées dans le VSIX, parcours de découverte à la première activation, vues d'accueil, bouton dans la barre de titre, commandes qui répondent toujours, message d'erreur actionnable.
- Final state: done

## Origine

Retour utilisateur du 2026-09-09 après installation réelle de la 0.1.0 : « il me dit que Chatterbox n'est pas installé », « le readme de l'extension est vide », « LLM Voice play ne retourne rien par défaut », « c'est en cherchant un peu partout que j'ai trouvé le bouton Lire cette section », « il faut penser aux utilisateurs qui veulent juste ajouter l'extension et l'utiliser ».

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| PR #44 voix système + Piper + sélection auto | merge `3a736e0` | backend-engineer (Sonnet) | espeak-ng et Piper testés réellement, WAV audibles joués via paplay |
| PR #43 commandes | merge `aedfb42` | backend-engineer (Sonnet) | 30 commandes revues, 9 corrigées, bascule Espace |
| PR #42 onboarding | merge `9c6a488` | art-director + project-navigator (Sonnet) | README/CHANGELOG/LICENSE dans le VSIX, parcours 4 étapes, vues d'accueil |
| Release 0.1.1 | https://github.com/Guilhem-Bonnet/llm-voice/releases/tag/v0.1.1 | Convoy | VSIX 295 Ko attaché, workflow vert |
| Test d'acceptation | profil VS Code neuf, Chatterbox arrêté | Sentinel | son produit par la voix système sans serveur |

## Validation

| Check | Result |
|---|---|
| Unit | 817+ tests verts |
| Intégration xvfb | 43 tests sur 5 profils |
| Contenu du VSIX | README, CHANGELOG, LICENSE, media du parcours présents |
| Release | v0.1.1 publiée, workflow Release vert |

## Leçon principale

Le MVP satisfaisait ses 17 critères d'acceptation tout en étant inutilisable pour un nouvel utilisateur : tous les critères supposaient un serveur TTS déjà en place. Aucun test ne partait d'une machine vierge.

**Règle instaurée** : toute release passe par un test d'acceptation sur un profil VS Code neuf, sans aucun service tiers démarré.

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| `say` (macOS) et SAPI (Windows) implémentés mais non exécutés sur une vraie machine | risque de régression sur ces plateformes | concierge | avant la 1.0 |
| Qualité de la voix système inférieure à Chatterbox | assumé, c'est le niveau « zéro installation » | concierge | — |
| Téléchargement de Piper : réseau requis une fois, consenti, refusé en mode strict local | conforme à la promesse locale | concierge | — |

## Completion statement

Phase 7 complète : défauts corrigés, 0.1.1 publiée, test d'acceptation sur machine vierge ajouté au processus.
