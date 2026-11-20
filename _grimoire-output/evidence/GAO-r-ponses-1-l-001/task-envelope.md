# Task envelope : GAO-r-ponses-1-l-001

## Objectif
L'utilisateur écoute la dernière réponse de n'importe quel outil d'un seul geste, depuis une liste nommée « Réponses » qui affiche la durée de chaque réponse.

## Périmètre outillé
- Autorisé : `vscode-extension/src/inbox*`, `src/claude/`, `src/sources/ClaudeInboxSource.ts`, `src/views/inbox*`, `src/views/player/`, `media/player/`, `src/commands/`, `package.json`, leurs tests, CHANGELOG, README.
- Exclu : capture de nouveaux outils (Réponses 3), lecture adaptée à l'oral (Réponses 2), sections et barre d'état (Réponses 4), « l'essentiel » (Réponses 5), historique privé, service distant, lecture automatique. Le bouton « L'essentiel » n'apparaît pas tant que Réponses 5 n'existe pas.

## Critères de sortie
- `npm --prefix vscode-extension run test:unit` vert.
- Une preuve réelle lit la dernière réponse par la commande renommée, avec le raccourci Ctrl+Alt+V R.
- Boutons vérifiés à 260, 320 et 500 px : taille fixe, jamais de retour à la ligne.
- `grimoire standard gate check --strict` vert ; accord de guilhem-bonnet consigné.
