---
description: 'Vérification complète du standard agentique et score de conformité'
allowed-tools: 'Read, Glob, Bash'
---
<!-- grimoire:managed — régénéré par `grimoire host sync`; éditez la source, pas ce fichier. -->

Passe le projet à la vérification complète du standard.

1. `grimoire -o json standard verify .`
2. `grimoire -o json standard score`
3. `grimoire standard audit .` si la vérification signale des écarts.

Présente le score, puis les écarts par ordre de gravité. Pour chacun : ce qui
est attendu, ce qui est constaté, la commande qui corrige. Distingue ce qui
bloque une clôture de ce qui est seulement recommandé.
