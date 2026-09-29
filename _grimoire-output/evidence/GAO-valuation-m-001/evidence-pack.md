# Evidence Pack — GAO-valuation-m-001

> **Les étiquettes sont PROPOSÉES par Claude et NON validées par l'utilisateur** (`labelSource:
> "claude-proposed"`, 51/51). Chaque précision ci-dessous mesure l'**accord avec ces propositions**, pas la
> qualité ressentie. Le critère « étiquettes validées par guilhem-bonnet » reste ouvert : relecture dans
> `vscode-extension/scripts/decision-spike/dataset/LABELS-TO-REVIEW.md`, puis `node apply-labels.mjs` et
> `node run-all.mjs`.

## Jeu d'évaluation

- `vscode-extension/scripts/decision-spike/dataset/auto-eval-v1.jsonl` : 51 réponses finales d'agent de code
  **inventées** (aucune donnée personnelle, aucune capture d'inbox), 16 catégories (done-short, error-report,
  question-to-user, tutorial, code-diff, results-table, step-list, architecture-plan, code-review, english,
  mixed-fr-en, command-output, test-summary, concept-explanation, apology-failure, cheat-sheet).
- Classes = 4 profils réels : `faithful-local` 17, `llm-summary` 15, `technical-teacher` 11, `quick-review` 8.
  `system-voice` exclu (même mode `faithful`, seule la voix diffère — voir task-envelope).
- Champs : `id`, `text`, `category`, `proposedProfile`, `rationale`, `labelSource`.
- `LABELS-TO-REVIEW.md` généré par `node apply-labels.mjs --generate` ; application des corrections testée
  sur une copie en scratchpad (1 correction → `userLabel` + `labelSource: "user"`, accord 98 % affiché ; id
  inconnu → exit 1 sans écriture). Le jeu du dépôt n'a PAS été modifié par ce test.

## Commande et tableau final

```
$ node vscode-extension/scripts/decision-spike/run-all.mjs \
    --reuse-from=_grimoire-output/evidence/GAO-valuation-m-001/gptoss-results.json --reuse=json-gptoss \
    --json-out=_grimoire-output/evidence/GAO-valuation-m-001/run-all-results.json
exit=0   (sortie intégrale : run-all-output.txt ; durées : run-all-timings.txt ; par cas : run-all-results.json)
```

gpt-oss:20b a été mesuré à part (`--only=json-gptoss`, 1 676 s, `gptoss-results.json`) puis repris tel quel
(prédictions + latences par cas, empreinte du jeu vérifiée). Machine : Radeon RX 9070 (16 Go), Ollama 0.21.0,
Node 22.22.2, `temperature 0`, modèles chauffés hors jeu avant chaque variante.

| Approche | Groupe | Précision | Pire catégorie | p50 | p95 |
|---|---|---:|---|---:|---:|
| Classe constante `faithful-local` (plancher) | — | 33 % (17/51) | architecture-plan 0/3 | 0 ms | 0 ms |
| Témoin à règles du spike, tel quel (A/B/C → profils) | départ | 4 % (2/51) | apology-failure 0/3 | 0 ms | 0 ms |
| **Témoin à règles v2** (mêmes seuils, sémantique des profils réels) | départ | **33 % (17/51)** | architecture-plan 0/3 | 0 ms | 0 ms |
| Embeddings k-NN nomic, k=3, LOO | départ | 25 % (13/51) | cheat-sheet 0/3 | 212 ms* | 19 265 ms* |
| SemIf qwen2.5:3b, lettres (prompt du spike) | départ | 37 % (19/51) | apology-failure 0/3 | 236 ms | 289 ms |
| SemIf qwen2.5:7b, lettres | a | 53 % (27/51) | cheat-sheet 0/3 | 257 ms | 307 ms |
| SemIf qwen2.5:3b, prompt enrichi, lettres | b | 55 % (28/51) | cheat-sheet 0/3 | 219 ms | 273 ms |
| **SemIf qwen2.5:7b, prompt enrichi, lettres** | b | **75 % (38/51)** | tutorial 0/3 | 256 ms | 378 ms |
| SemIf qwen2.5:3b, enrichi, noms | c | 33 % (17/51) | architecture-plan 0/3 | 225 ms | 8 757 ms* |
| SemIf qwen2.5:7b, enrichi, noms | c | 59 % (30/51) | results-table 0/4 | 244 ms | 286 ms |
| SemIf qwen2.5:7b, enrichi, noms + calibration contextuelle | g | 69 % (35/51) | code-review 0/3 | 241 ms | 291 ms |
| Hybride (d) + qwen2.5:7b enrichi noms + calibration | d | 75 % (38/51) | code-review 0/3 | 239 ms | 291 ms |
| Hybride (d) + qwen2.5:3b lettres | d | 59 % (30/51) | cheat-sheet 0/3 | 231 ms | 288 ms |
| SemIf qwen2.5:7b, enrichi, noms + consignes (circulaire) | b+ | 65 % (33/51) | tutorial 0/3 | 244 ms | 282 ms |
| Embeddings k-NN nomic « classification: », k par CV imbriquée | e | 51 % (26/51) | cheat-sheet 0/3 | 27 ms | 39 ms |
| Embeddings k-NN qwen2.5:1.5b, k par CV imbriquée | e | 71 % (36/51) | architecture-plan 1/3 | 105 ms | 130 ms |
| **Hybride (d) + k-NN qwen2.5:1.5b** | d | **75 % (38/51)** | architecture-plan 1/3 | 102 ms | 125 ms |
| gpt-oss:20b, JSON contraint (`format` enum, think low) | f | 67 % (34/51) | code-review 0/3 | 32 703 ms | 62 479 ms |

Tableau complet (34 lignes, dont toutes les variantes hybrides et calibrées) : `run-all-output.txt`.
\* latence vraisemblablement contaminée par une contention GPU (mode jeu constaté juste après, voir « Écarts »). Premier passage
partiel du même jour (contention inconnue) : k-NN nomic p95 35 ms, qwen2.5:3b lettres p95 508 ms (warm-up compris
dans la 1re requête), qwen2.5:3b enrichi noms p95 254 ms.

## Gagnante et configuration exacte

Règle de sélection codée dans `run-all.mjs` : meilleure précision parmi les p95 < 1 000 ms, égalité départagée
par le p95. **Gagnante : `hybrid+knn-qwen1.5b` — 75 % (38/51), p50 102 ms, p95 125 ms.**

- Étape 1 (règles, seuils fixés a priori) : texte < 200 caractères, ou ≥ 60 % des caractères dans des blocs
  ```…``` → `faithful-local`, latence 0.
- Étape 2 : `POST /api/embed` `{"model":"qwen2.5:1.5b","input":<texte brut, sans préfixe ni troncature>}`,
  similarité cosinus contre les 50 autres cas étiquetés, vote majoritaire (égalité → somme des similarités),
  k ∈ {1,3,5,7} choisi par LOO interne → **k = 1 choisi 51 fois sur 51** (plus proche voisin).
- Exige une base d'exemples étiquetés livrée avec le produit.

**Ex æquo sans aucune donnée d'entraînement : `semif-7b-rich-letters` — 75 % (38/51), p50 256 ms, p95 378 ms.**
`POST /api/generate` `{"model":"qwen2.5:7b","stream":false,"logprobs":true,"top_logprobs":20,
"keep_alive":"30m","options":{"temperature":0,"num_predict":1}}`, prompt `buildRichPrompt(text,{byName:false})`
de `auto-classifiers.mjs` : A–D = libellé réel + description (+ exemple hors jeu de `PROMPT_EXAMPLES`), texte
tronqué à 1 500 caractères, ligne de métadonnées (longueur, part de code, « ? »), argmax de la masse
des jetons A/B/C/D du premier jeton. Ordre A fidèle, B résumé, C révision, D professeur.

Les deux gagnantes ne diffèrent pas entre elles (McNemar : 8 cas contre 8, p = 1). Recommandation (à valider) :
**SemIf qwen2.5:7b enrichi** pour le produit — même score, zéro exemple étiqueté à embarquer, modèle déjà
narrateur par défaut ; le k-NN à k = 1 profite vraisemblablement de la ressemblance entre cas d'une même
catégorie (même auteur), la validation par catégorie exclue est codée mais **non mesurée** (voir Écarts).

## Écart avec le témoin à règles

- Témoin v2 (33 %) → gagnantes (75 %) : **+41 à +42 points**. McNemar exact : k-NN hybride 22 cas justes
  contre 1 (p < 0,0001) ; SemIf 7b enrichi 24 contre 3 (p < 0,0001) ; gpt-oss 18 contre 1 (p = 0,0001).
- Le témoin du spike tel quel fait 4 % : il envoie les textes courts vers « révision rapide », que le spike
  décrivait comme « survol bref », alors que le profil réel `quick-review` est une réécriture narrée. Le témoin
  v2 garde les mêmes signaux et seuils mais lit les textes courts tels quels ; il ne sait produire que
  `faithful-local` et `llm-summary`, et vaut ici le plancher constant.

## Enseignements

- Le prompt enrichi (libellé, description, exemple hors jeu) fait **+22 points sur le 7b** (53 → 75 %) mais
  aucun gain sur le 3b en noms (33 %) : qwen2.5:3b suit mal une consigne à quatre options.
- Les options par nom (c) sont moins bonnes que les lettres sur ce jeu (7b : 59 % contre 75 %).
- La calibration contextuelle (g) aide le 7b en noms (+10 points) mais détruit les variantes par lettres
  (distribution « N/A » dégénérée, une option à 0).
- La ligne de consignes qui reprend le guide d'étiquetage (b+) **n'aide pas** (65 % contre 75 %) : le risque
  de circularité ne s'est pas traduit en gain.
- `nomic-embed-text` (anglais) est faible (25–51 %) ; aucun modèle d'embedding multilingue dédié n'est
  installé (pas de `ollama pull`, hors périmètre) — qwen2.5:1.5b, LLM multilingue, sert de substitut.
- Pire catégorie des meilleures variantes : `tutorial` (SemIf 7b, 0/3 : lus comme résumés) et
  `architecture-plan` (k-NN, 1/3). `quick-review` reste le profil le plus mal reconnu (4/8 au mieux).
- gpt-oss:20b n'est pas un plafond ici : 67 % en 33 s médians (modèle en partie sur CPU, voir Écarts).

## Écarts et limites

1. **Étiquettes non validées** (critère de la carte ouvert). Tout le classement peut bouger après relecture.
2. **Mode jeu actif** : juste après la dernière mesure, `gpu-yield` a refusé toute nouvelle charge GPU/IA
   (partie en cours) ; le début exact de la partie n'est pas connu. Symptômes compatibles : latences aberrantes sur 4 variantes (marquées *), gpt-oss:20b
   chargé à 8,5–9 Go sur 14 en VRAM (reste sur CPU), et la variante **k-NN « catégorie exclue »
   (`knn-*-group`) ajoutée à `run-all.mjs` après la mesure n'a pas été exécutée**. Sa logique est vérifiée
   sur CPU par un test sur vecteurs factices (LOO → voisin de même catégorie, groupe → voisin d'une autre).
   À relancer : `node vscode-extension/scripts/decision-spike/run-all.mjs --reuse-from=… --reuse=json-gptoss`.
3. **Biais du gagnant** : ~34 variantes comparées sur 51 cas ; un écart de quelques points n'est pas
   significatif (IC binomial à 95 % de 75 % sur 51 ≈ ±12 points).
4. Jeu **synthétique** écrit par le même auteur que les étiquettes ; le protocole §10 demande 50 réponses
   réelles de l'inbox étiquetées par l'utilisateur (inbox toujours vide, cf. GAO-spike-valuat-001).
5. Un seul passage par variante (température 0, donc déterministe pour la précision ; latence non répétée).

## Fichiers produits ou modifiés

- `vscode-extension/scripts/decision-spike/dataset/auto-eval-v1.jsonl`, `dataset/LABELS-TO-REVIEW.md` (nouveaux)
- `vscode-extension/scripts/decision-spike/auto-profiles.mjs`, `auto-classifiers.mjs`, `apply-labels.mjs` (nouveaux)
- `vscode-extension/scripts/decision-spike/run-all.mjs` (réécrit), `embeddings-knn.mjs` (+ `embedItems`,
  `knnLooProfiles`), `README.md` (section banc)
- `_grimoire-output/evidence/GAO-valuation-m-001/` : task-envelope, evidence-pack, claim-ledger,
  `run-all-output.txt`, `run-all-timings.txt`, `run-all-results.json`, `gptoss-results.json`

Aucun commit, aucune modification de `vscode-extension/src/**`, état de la carte inchangé (`running`).
