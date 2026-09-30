# Diagnostic de latence du metteur en scène (qwen2.5:7b, Ollama local, GPU)

Carte GAO-adr-015-5-an-001, 2026-09-29. Aucun fichier de `src/` modifié. Mode jeu testé avant chaque série (absent). Mesures strictement séquentielles.

## Commandes

```bash
cd _grimoire-output/evidence/GAO-adr-015-5-an-001/direction-eval
node latency-diagnosis.mjs decompose   # 3 appels analyste + 5 appels metteur en scène, requêtes réelles du pipeline -> latency-decompose.json
node latency-diagnosis.mjs remedies    # 12 variantes x 3 répétitions sur la 1re fenêtre du « conte » -> latency-remedies.json
node latency-diagnosis.mjs combo       # 3 textes x 2 répétitions, analyste avec/sans format, direction allégée/fenêtre 2 ; froid et préchargement -> latency-combo.json
node latency-diagnosis.mjs richness    # contrôle de l'expressivité du prompt allégé -> latency-richness.json
```
Les requêtes (analyste et 1re fenêtre de chaque texte) sont capturées par le vrai pipeline compilé puis rejouées telles quelles (`latency-inputs.json`). Validité = verdict de `PartitionController` (profil normal, puis `faithful`).

## 1. Décomposition d'un appel réel (médiane, ms)

| Appel | n | Mur | load | préremplissage (jetons) | génération `eval_duration` (jetons) | Reste non compté (`total` − load − prompt − eval) |
|---|---|---|---|---|---|---|
| Analyste | 3 | 3 580 | 87 | 169 (937) | 1 184 (114) | 2 182 |
| Metteur en scène | 5 | 13 142 | 80 | 182 (1 457) | 4 530 (423) | 8 349 |

Par appel de direction : conte 26,9 s et 28,4 s (856 et 926 jetons), doc-technique 12,2 s et 11,0 s (391, 364), réponse-ia 13,1 s (423).

Constat : `eval_duration` ne représente qu'un tiers du temps. Coût mesuré par jeton généré, au mur : 30,4 ms (direction) et 29,5 ms (analyste) contre 10,4 à 10,7 ms rapportés par `eval_duration` (le « 93 jetons/s » de la baseline est donc trompeur : le débit réel est d'environ 33 jetons/s). Les 19 ms par jeton manquants sont la contrainte de format (grammaire JSON Schema appliquée à chaque jeton, comptée hors `eval_duration`). Chargement (80 ms, modèle chaud) et lecture du prompt (0,2 à 0,6 s, 11 ms quand le préfixe est en cache) sont négligeables. Le temps est donc : jetons générés x 30 ms, dont 62 % de surcoût de grammaire. Le nombre de jetons dépend du texte (dialogues : 720 à 930 ; doc : 360 à 420).

## 2. Remèdes (même entrée : 1re fenêtre de 4 segments du « conte » sauf mention ; 3 répétitions, médiane)

| Variante | Mur (ms) | Jetons | ms/jeton | Valide | Remarque |
|---|---|---|---|---|---|
| A référence (format schéma, ctx 8192) | 22 943 | 719 | 30,8 | 3/3 | |
| B sans `format` (JSON demandé dans la consigne) | 11 842 | 978 | 12,1 | 2/3 | 12 ms/jeton, mais sortie plus bavarde et 1 réponse `schema-invalid` |
| B2 `format: "json"` | 25 221 | 775 | 32,7 | 3/3 | aucun gain : la grammaire, pas le schéma, coûte |
| C prompt allégé, avec format | 12 017 | 394 | 30,5 | 3/3 | gain dû à 394 jetons au lieu de 719 ; voir réserve d'expressivité |
| C2 prompt allégé, sans format | 4 708 | 394 | 11,9 | 3/3 | **0 émotion, 0 tempo, 0 pause** dans les cues (contrôle `richness`) : direction vide de sens |
| D `num_ctx` 4096 | 29 060 | 933 | 31,1 | 2/3 | aucun effet sur la vitesse (jetons variables) |
| D2 `num_ctx` 3072 | 32 623 | 1 037 | 30,8 | 3/3 | idem |
| E fenêtre de 2 segments, format | 7 441 | 241 | 30,9 | 3/3 | latence proportionnelle aux jetons |
| E2 fenêtre de 2 segments, sans format, consigne d'origine | 3 173 | 241 | 13,2 | 3/3 sur le conte, mais 1/2 conte, 0/2 doc, 0/2 ia dans `combo` (`not-json`, `uncovered-source`) | fragile sans grammaire |
| F qwen2.5:3b, 4 segments | 12 955 | 449 | 27,9 | 3/3 | grammaire domine encore : 27,9 contre 30,8 ms/jeton |
| F2 qwen2.5:3b, 2 segments | 6 319 | 227 | 27,8 | 3/3 | pas meilleur que E (7,4 s) pour un modèle plus faible |
| G fusion analyste + 1re fenêtre (un appel, format) | 15 268 | 478 | 30,7 | 3/3 | équivalent à analyste + fenêtre de 2 (6,6 + 7,4 = 14,0 s) |
| `keep_alive` | — | — | — | — | modèle chaud : load 80 ms, déjà acquis avec 10 m. À froid : load 1 670 à 1 760 ms ; un préchargement à l'ouverture de la session coûte 1,85 s |

Analyste sans `format` (`combo`, 2 répétitions par texte, JSON valide 6/6) : 3,0 s contre 6,6 s (conte), 1,5 s contre 3,6 s (doc), 1,5 s contre 3,3 s (ia) : -54 % à -59 %.

Direction hors format, prompt allégé, fenêtre 2 (C3) : 2,0 à 2,4 s, valide 6/6, mais sans expressivité (mêmes réserves que C2).

## 3. Stratégie de démarrage chiffrée

Remède le plus efficace à qualité de direction constante : réduire les jetons à générer avant le premier segment dirigé (fenêtre 2 : -68 %, 22,9 s vers 7,4 s). Le plus efficace en coût par jeton : retirer la grammaire (2,5 fois plus vite, 12 contre 30 ms/jeton), mais la validité tombe à 2/3 avec la consigne d'origine ; à n'adopter qu'avec un analyseur tolérant (extraction du JSON, sinon un renvoi) que je n'ai pas le droit de tester dans `src/` ici.

Stratégie recommandée, chiffrée sur le conte (cas le plus lent) :

1. t = 0 : préchargement du modèle à l'ouverture de la session (1,85 s, masqué avant le premier appel) ; le segment 1 (titre, environ 1,5 s de parole) part en lecture neutre immédiatement, premier son sans attente.
2. Analyste sans `format` (JSON tolérant, 1,5 à 3,0 s ; avec format 3,3 à 6,6 s) puis première fenêtre de 2 segments avec format (7,4 s) : direction prête à t = 14,0 s (mesure `format` partout ; 10,4 s si l'analyste est sans format). Doc et réponse IA : analyste 3,3 à 3,6 s + fenêtre de 2 segments d'environ 5 s (estimé, non mesuré) : environ 9 s.
3. La lecture neutre des segments 1 et 2 dure environ 1,5 s + 17 s (segment 2 : 250 caractères à 15 c/s) : la fenêtre dirigée 3 à 4 est prête (t = 14 s) avant la fin du segment 2 (t = 18,5 s). Premier segment dirigé audible à t ≈ 18,5 s sans trou, contre 22 s p50 (26,9 s sur le conte) de la baseline. Fenêtres suivantes de 4 segments (23 s de calcul contre 4 segments lus en 30 à 60 s) : le rythme tient tant que N >= 2 fenêtres d'anticipation.
4. Gain complémentaire à décider hors de cette carte : retirer la grammaire du chemin de direction (4 segments en 11,8 s au lieu de 22,9 s) avec un analyseur tolérant ; à mesurer avec le vrai pipeline avant adoption.

Non concluant / non vérifié : validité du sans-format sur plus de 2 répétitions par texte ; expressivité des variantes E (fenêtre 2 avec format) mesurée seulement par le verdict du contrôleur, pas par un juge ; le prompt allégé C/C2 est rapide mais produit des partitions plates (à ne pas retenir en l'état).
