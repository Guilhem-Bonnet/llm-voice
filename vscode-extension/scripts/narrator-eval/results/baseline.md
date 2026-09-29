# baseline — 24 textes × 3 profils × 2 modèles (×1), résultats : /mnt/Travail/Projets/Dev/TTS-Voice/vscode-extension/scripts/narrator-eval/results/baseline.json

| profil | modèle | fidélité essentielle | détails | négations | inventions (mustNotSay / chiffres neufs) | longueur méd. | dégradés / repli partiel / total | p50 (s) | p95 (s) |
|---|---|---|---|---|---|---|---|---|---|
| technical-teacher | qwen2.5:7b | 86.8% (118/136) | 85.4% (35/41) | 69.4% (25/36) | 0 / 0 | 2.04 | 0 / 0 / 24 | 27.28 | 58.37 |
| technical-teacher | qwen2.5:3b | 83.8% (114/136) | 85.4% (35/41) | 55.6% (20/36) | 0 / 3 | 2.09 | 0 / 0 / 24 | 6.39 | 9.64 |
| llm-summary | qwen2.5:7b | 96.3% (129/134) | 78.0% (32/41) | 80.0% (28/35) | 0 / 0 | 1.08 | 0 / 1 / 24 | 39.04 | 61.40 |
| llm-summary | qwen2.5:3b | 85.9% (116/135) | 87.5% (35/40) | 74.3% (26/35) | 0 / 2 | 1.15 | 0 / 2 / 24 | 3.82 | 5.34 |
| quick-review | qwen2.5:7b | 97.1% (132/136) | 97.6% (40/41) | 86.1% (31/36) | 0 / 0 | 1.00 | 0 / 0 / 24 | 5.17 | 19.93 |
| quick-review | qwen2.5:3b | 91.9% (125/136) | 90.2% (37/41) | 88.9% (32/36) | 1 / 2 | 1.07 | 0 / 0 / 24 | 4.08 | 5.86 |

## 5 pires cas (exécutions utilisables, toutes combinaisons)

1. [qwen2.5:3b / llm-summary] agent-23-incident (gravité 18)
   essentiels perdus : 27 septembre ; OOM killer ; 2 Go ; 40 Mo
   négations perdues (ancre) : plafond ; donnée
   extrait fautif : « Pour le bug d'aujourd'hui où le Core a été tué à 03h12 après 6 heures, il s'agissait d'un incident de buffer trop grand pour la requête. Nous avons également ajusté l'allocation de données en limitant l'entrée à 64 Ko dans `Core::read_request`, sans perte de d »
2. [qwen2.5:3b / technical-teacher] doc-21-en-readme (gravité 14)
   essentiels perdus : out/ ; telemetry
   négations perdues (ancre) : out/ ; telemetry
   extrait fautif : « Avant de lancer le serveur d'extension, n'hésitez pas à exécuter la commande `npm run compile`. N'oubliez pas que les fichiers générés par ce processus sont récompilés chaque fois qu'il est lancé. Pour VS Code, assurez-vous qu'il utilise une version 1.90 ou pl »
3. [qwen2.5:3b / technical-teacher] agent-24-limits (gravité 13)
   essentiels perdus : tableaux Markdown ; Ollama 0.3 ; lecture fidèle
   négations perdues (ancre) : tableaux
   extrait fautif : « Bonjour, aujourd'hui nous allons parler des limites d'un système qui ignore la lecture de blocs de code beaucoup trop grands, plus de 200 lignes. Il envoie un avertissement W_CODE_SKIPPED. Et puis, je vais vous expliquer sur ce que signifie le mode 'narrated'  »
4. [qwen2.5:7b / technical-teacher] agent-11-config (gravité 12)
   essentiels perdus : 1000 ; 0
   négations perdues (ancre) : valeur de 0 ; settings.json
   extrait fautif : « Nous venons d'introduire un nouveau paramètre appelé 'llmVoice.narrator.timeoutMs' avec une valeur par défaut de 60000 millisecondes, c'est-à-dire 60 secondes. Cette valeur peut être ajustée, mais elle ne doit pas être nulle. Si vous utilisez un modèle de plus »
5. [qwen2.5:3b / llm-summary] agent-02-migration (gravité 12)
   essentiels perdus : 20260912_add_index.sql ; 1,2 million ; CREATE INDEX CONCURRENTLY ; verrou en écriture
   extrait fautif : « La migration pour ajouter un index sur users.email a pris 14 secondes. Il ne devrait pas être exécuté en production pendant les heures ouvrées, car ça met la table en lecture seule temporaire. Pour faire tourner à l'envers, utilisez -f rollback_202600912.sql a »
