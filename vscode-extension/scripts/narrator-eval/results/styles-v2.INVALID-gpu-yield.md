# styles-v2 — 24 textes × 3 profils × 1 modèles (×1), résultats : /mnt/Travail/Projets/Dev/TTS-Voice/vscode-extension/scripts/narrator-eval/results/styles-v2.json

| profil | modèle | fidélité essentielle | détails | négations | inventions (mustNotSay / chiffres neufs) | longueur méd. | dégradés / repli partiel / total | p50 (s) | p95 (s) |
|---|---|---|---|---|---|---|---|---|---|
| technical-teacher | qwen2.5:7b | 100.0% (5/5) | 100.0% (3/3) | 100.0% (2/2) | 0 / 0 | 1.26 | 23 / 0 / 24 | 0.00 | 2.67 |
| llm-summary | qwen2.5:7b | n/a (0/0) | n/a (0/0) | n/a (0/0) | 0 / 0 | NaN | 24 / 0 / 24 | 0.00 | 0.00 |
| quick-review | qwen2.5:7b | n/a (0/0) | n/a (0/0) | n/a (0/0) | 0 / 0 | NaN | 24 / 0 / 24 | 0.00 | 0.00 |

## 5 pires cas (exécutions utilisables, toutes combinaisons)

1. [qwen2.5:7b / technical-teacher] agent-01-timeout (gravité 0)
   extrait fautif : « J'ai modifié le délai d'attente dans le fichier src/net/EgressGuard.ts, augmentant la valeur de 30 secondes à 60 secondes. Le test npm test -- --grep egress passe maintenant avec 42 tests et aucun échec. Il est important de ne pas relancer npm run compile avan »
