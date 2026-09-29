# Task envelope — GAO-valuation-f-001

- Objectif : mesurer la fidélité du narrateur (réécriture LLM avant lecture) via le vrai chemin `OllamaNarrator` compilé.
- Périmètre autorisé : `vscode-extension/scripts/narrator-eval/` (nouveau) et `_grimoire-output/evidence/GAO-valuation-f-001/`. Aucune modification de `src/`. Pas de commit.
- Livrables : jeu `dataset/narrator-eval-v1.jsonl` (24 textes), `run-narrator-eval.mjs`, mesures qwen2.5:7b et qwen2.5:3b, pires cas, amélioration de prompt mesurée si fidélité essentielle < 95 %.
- Critère de verdict : `grimoire standard gate check --task-id GAO-valuation-f-001 --strict` passe ; chiffres du evidence-pack issus de sorties réelles du script.
- Risques : non-déterminisme des LLM (temperature par défaut du modèle) ; métriques lexicales = approximation (faux négatifs possibles sur paraphrases).
