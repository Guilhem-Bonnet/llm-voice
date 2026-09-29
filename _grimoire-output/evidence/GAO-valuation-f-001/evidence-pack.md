# Agentic Evidence Pack

## Summary

- Task id: GAO-valuation-f-001 (fidélité du narrateur)
- Profile: controlled
- Outcome: banc construit et exécuté sur qwen2.5:7b et qwen2.5:3b via le vrai `OllamaNarrator.transform` compilé. **Point 4 (mesure du prompt amélioré) NON réalisé** : le hook `gpu-yield` (mode jeu actif) a refusé le lancement de toute nouvelle charge Ollama ; non contourné. La variante est prête (`styles-v2.json`), à lancer quand le mode jeu est terminé.
- Aucune modification de `src/`, aucun commit.

## Livrables (vscode-extension/scripts/narrator-eval/)

- `dataset/narrator-eval-v1.jsonl` (24 textes : 14 réponses d'agent, 10 extraits de doc dont 2 en anglais ; généré par `dataset/build-dataset.mjs`), champs `mustKeep[{priority}]`, `negations`, `mustNotSay`.
- `run-narrator-eval.mjs` (options `--models --profiles --styles --label --repeat --limit --temperature --out --compare`).
- `results/baseline.json` (sorties complètes de 144 appels) et `results/baseline.md`.
- `styles-v2.json` : prompts proposés, à passer via `--styles`.

## Résultats baseline (144 appels, 1 passage, température par défaut du modèle)

Source : `baseline-table.md` (copie de `results/baseline.md`).

| profil | modèle | essentiel | négations | inventions (mustNotSay / chiffres neufs) | longueur méd. | dégradés / repli partiel |
|---|---|---|---|---|---|---|
| technical-teacher | 7b | 86,8 % (118/136) | 69,4 % | 0 / 0 | 2,04 | 0 / 0 |
| technical-teacher | 3b | 83,8 % (114/136) | 55,6 % | 0 / 3 | 2,09 | 0 / 0 |
| llm-summary | 7b | 96,3 % (129/134) | 80,0 % | 0 / 0 | 1,08 | 0 / 1 |
| llm-summary | 3b | 85,9 % (116/135) | 74,3 % | 0 / 2 | 1,15 | 0 / 2 |
| quick-review | 7b | 97,1 % (132/136) | 86,1 % | 0 / 0 | 1,00 | 0 / 0 |
| quick-review | 3b | 91,9 % (125/136) | 88,9 % | 1 / 2 | 1,07 | 0 / 0 |

JSON invalide : 0 exécution dégradée sur 144 (le schéma imposé par Ollama `format` tient). Repli partiel (blocs non couverts relus tels quels) : 3 exécutions.

Latences : p50/p95 NON exploitables. Le mode jeu (gpu-yield) a suspendu/perturbé le GPU pendant le run (p50 teacher 7b 27 s contre 7,5 s au premier passage avant contention ; la première passe, non conservée, donnait 4 à 7 s pour le 7b et 24 s pour le 3b avec `gpt-oss:20b` chargé en parallèle). Chiffres bruts dans `baseline-table.md`, à refaire sur machine libre.

## Constats

- Sous le seuil de 95 % d'essentiel : technical-teacher (7b et 3b), llm-summary 3b, quick-review 3b. Conformes : llm-summary 7b (96,3 %) et quick-review 7b (97,1 %), avec marge faible (1 passage).
- Les négations sont le point le plus faible (55 à 89 %), y compris pour le 7b.
- Une vraie invention observée (première passe) : technical-teacher 7b remplace « 22 050 Hz / 48 000 Hz » par « tours par minute » (analogie du disque vinyle) ; le prompt « explique le code plutôt que d'en réciter la syntaxe » pousse aussi à supprimer commandes et identifiants.
- Limites de la mesure : contrôles lexicaux (paraphrases fidèles comptées perdues, ex. « ne doit pas être nulle » pour « 0 refusée » ; « quatre étapes » pour « quatre états » traité par alt) ; 1 passage, donc bruit de l'ordre de plusieurs points ; négation = mot de négation à ±8 mots de l'ancre (peut valider à tort).
- Fiabilité du banc : une première passe a révélé 3 faux négatifs (pluriel « secondes », regex `mustNotSay` macOS, alts) corrigés puis run refait (le baseline ci-dessus est le run corrigé).

## Amélioration proposée (mesure tentée, INVALIDE : gpu-yield réapparu)

Tentative du 7b après la levée du mode jeu : le drapeau `$XDG_RUNTIME_DIR/gpu-yield/active` est réapparu pendant le run ; sur 72 appels, 71 sont tombés en `degraded` (Ollama suspendu, latence 0), seul le premier texte teacher a répondu (5/5 essentiels, non significatif). Résultat archivé sous `results/styles-v2.INVALID-gpu-yield.*`, à ne pas citer. Arrêt propre, aucune relance (le hook refuse aussi toute commande visant le banc). Le gain avant/après reste NON mesuré.

`styles-v2.json` : ajouter à chaque `profile.style` un bloc « règles de fidélité impératives » (nombres avec unités, versions, fichiers, commandes, identifiants et noms propres repris tels quels ; négations attachées à leur objet ; aucune donnée ajoutée, une analogie ne remplace jamais une donnée) ; teacher : « explique le rôle du code mais cite une fois chaque nom exact » ; summary/review : déclarer ces éléments comme « essentiels ». Commande : `node scripts/narrator-eval/run-narrator-eval.mjs --label styles-v2 --styles scripts/narrator-eval/styles-v2.json` puis `--compare results/baseline.json results/styles-v2.json`.

## Commandes exécutées

`node scripts/narrator-eval/run-narrator-eval.mjs --label baseline` (exit 0) ; `grimoire task context GAO-valuation-f-001` ; `grimoire standard decision trace --task-id GAO-valuation-f-001`.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Mesure de styles-v2 (concierge, 2026-09-29, mode jeu inactif vérifié)

`node run-narrator-eval.mjs --models qwen2.5:7b --styles styles-v2.json --label styles-v2 --out results/styles-v2.json` (exit 0),
comparé par `--compare results/baseline.json results/styles-v2.json` :

| profil | essentiel avant → après | négations avant → après | inventions | p50 avant → après |
|---|---|---|---|---|
| llm-summary | 95,5 % → 100 % | 88,6 % → 97,2 % | 0 / 0 | 4,01 s → 3,90 s |
| quick-review | 97,8 % → 97,8 % | 86,1 % → 94,4 % | 0 / 0 | 3,68 s → 3,62 s |
| technical-teacher | 86,7 % → 94,1 % | 85,7 % → 80,6 % | 0 / 0 | 6,97 s → 4,90 s |

Réserve : `results/baseline.json` a été régénéré par une exécution accidentelle du concierge (`--help` non géré par le
script, lancé avec les options par défaut) ; ses taux diffèrent de la première mesure de référence (négations
technical-teacher 69,4 % → 85,7 %), ce qui mesure le bruit d'un passage unique. À répéter (`--repeat 3`) avant d'appliquer.
Recommandation : appliquer styles-v2 à llm-summary et quick-review ; technical-teacher reste sous 95 % sur les négations
(l'analogie pédagogique reformule les contraintes) — à retravailler, et à intégrer au futur contrôleur de fidélité (ADR-015).
