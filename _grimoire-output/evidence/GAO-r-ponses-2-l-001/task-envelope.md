# Task envelope : GAO-r-ponses-2-l-001

## Objectif
Une réponse de LLM s'écoute sans balisage ni code dicté : l'utilisateur entend la phrase, pas sa mise en forme, et peut choisir de faire lire le code.

## Périmètre outillé
- Autorisé : `vscode-extension/src/parser/`, `src/pipeline/` pour le texte d'une réponse, `src/views/player/`, `media/player/`, `package.json`, leurs tests, CHANGELOG, `scripts/audio-proof/`.
- Exclu : section Studio complète (écran à part), sections et barre d'état (Réponses 4), « l'essentiel » (Réponses 5), capture (Réponses 3), jeu d'acteurs, lexique. Pas d'IA, pas de service distant. Aucune réponse privée lue.

## Critères de sortie
- `npm --prefix vscode-extension run test:unit` vert, avec une table de formes réelles : balisage, chemins, URL, code en ligne, blocs, tableaux, listes.
- Preuve audio réelle sur une réponse de test : aucun balisage ni URL entendu, code annoncé et non dicté.
- Bascule « Code : ignoré / lu » vérifiée à 260, 320 et 500 px.
- `grimoire standard gate check --strict` vert ; accord de guilhem-bonnet consigné.
