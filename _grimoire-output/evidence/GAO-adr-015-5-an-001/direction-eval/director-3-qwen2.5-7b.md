# Mesure de la direction de lecture — director-3-qwen2.5-7b

- Date : 2026-09-30T02:44:49.958Z
- Modèle : `qwen2.5:7b` (température 0.2, num_ctx 8192, keep_alive 10m)
- Version des prompts : `analyst-2.director-3`
- Paramètres : K=4, W=6, L=4, N=8, budget établi 1 500 ms, budget de premier son 10 000 ms, lecture estimée 15 caractères/s
- Répétitions par texte : 2 (chaque répétition = document neuf, bible et cache vides, modèle chaud)
- Démarrage : 5b-bis (segments de tête neutres : 2, première fenêtre : 2, préchargement, budgets de production 10 s / 1,5 s) ; lecture en temps réel (durée estimée de chaque segment).
- Chargement à froid du modèle (hors mesure) : 142 ms
- Statut : complete

## Synthèse par texte

| Texte | Fenêtres | Dirigées | Repli neutre | Fenêtres avec renvoi | Appels/fenêtre | 1re réponse acceptée | 1re acceptée (faithful) | « À conserver » | Premier segment dirigé p50 / p95 (ms) | Direction / lecture (seg/s) |
|---|---|---|---|---|---|---|---|---|---|---|
| conte | 6 | 6 (1) | 0 (0) | 2 (0.333) | 1.33 | 4/6 | 4/6 | 8/8 | 34421 / 34421.1 | 0.042 / 0.07 |
| doc-technique | 6 | 5 (0.833) | 1 (0.167) | 4 (0.667) | 1.83 | 2/6 | 2/6 | 6/6 | 32150.7 / 32150.7 | 0.031 / 0.082 |
| reponse-ia | 4 | 3 (0.75) | 1 (0.25) | 3 (0.75) | 2 | 1/4 | 1/4 | 8/8 | 41152.3 / 41152.9 | 0.024 / 0.071 |

## Démarrage par texte

| Texte | Premier son p50 (ms) | Direction prête p50 (ms) | Premier segment dirigé p50 (ms) | Segments lus en neutre / total | Analyse (statuts) | Segments dirigés avec récit et réplique séparés |
|---|---|---|---|---|---|---|
| conte | 0.7 | 33117.3 | 34421 | 8/20 | {"analyzed":2} | 0.125 |
| doc-technique | 0.3 | 19887.4 | 32150.7 | 11/18 | {"analyzed":2} | 0 |
| reponse-ia | 0.4 | 27231.9 | 41152.3 | 8/12 | {"analyzed":2} | 0 |

## Latence et débit (tous textes)

- Premier segment dirigé (analyse + première fenêtre, modèle chaud) : p50 34421 ms, p95 41152.6 ms, min 32150.7 ms, max 41153 ms sur 6 mesures (0 sans segment dirigé).
- Premier son (segment 1, neutre au démarrage) et premier segment dirigé prêt : voir « Démarrage par texte » ci-dessous.
- Appel d'analyse : p50 2030.5 ms, p95 3405.5 ms.
- Appel de direction (une fenêtre, un essai) : p50 10145 ms, p95 24088.7 ms (temps serveur total_duration p50 10143.2 ms, évaluation du prompt p50 217.7 ms) ; jetons de prompt p50 1916 / max 2305 ; jetons générés p50 325 ; 92.8 jetons/s en génération.
- Contexte saturé (prompt ≥ 98 % de num_ctx) : 0 appel(s) ; réponses coupées par la limite de jetons : 0 ; appels en échec : 1 sur 34.
- Débit : la direction produit 0.031 segments/s (médiane des lectures) contre 0.071 segments/s lus à 15 caractères/s : rapport 0.4.
- Relecture (cache) : 1 appel(s) modèle sur 3 relecture(s), fenêtres servies par le cache 6/6.

## Simulation de lecture (durées mesurées, lecture à vitesse estimée)

Non applicable : avec le démarrage 5b-bis la lecture est jouée en temps réel dans la mesure (voir « Démarrage par texte »).

## Qualité des partitions

### conte

- Analyse obtenue (dernière répétition) : genre « Conte pour enfants », ton « Doux et amical », intention « Faire entendre l'histoire de Maëlys et le renard » ; personnages : maelys, renard, canetons.
- Cues dirigées : 20 (1.25 par segment). Locuteurs : {"narrator":14,"renard":5,"maelys":1}. Attendu : {"minSpeakers":2} → conforme.
- Émotions : 10 libellés distincts, dominant 0.25 ; {"joyeux":5,"implorant":3,"décision":2,"attente":2,"inquiétude":2,"curiosité":2,"douteuse":1,"satisfait":1,"doute":1,"doucement":1}.
- Intensité : moyenne 0.74, écart-type 0.12 ; tempo : {"0.9-1.1":15,">1.1":5} ; pause après : {"absent":12,"1-300":4,"301-800":4} ; pause avant : {"301-800":9,"absent":7,"1-300":4}.
- Champs présents (part des cues) : émotion 1, tempo 1, pause 1, note de jeu 0.45, insistance 0.45, non verbal 0.
- Tempo > 1,1 parmi les cues qui portent un tempo : 0.25 ; segments dirigés avec plusieurs locuteurs : 0.125.
- Monotonie : non (aucun critère atteint).
- Violations à la première réponse (contrôleur) : {"uncovered-source":2} ; replis : {}.

### doc-technique

- Analyse obtenue (dernière répétition) : genre « Instructions pour l'installation et la configuration d'un logiciel », ton « Informel, explicatif », intention « Informer comment installer et configurer le moteur de synthèse vocale » ; personnages : aucun.
- Cues dirigées : 9 (1 par segment). Locuteurs : {"narrator":9}. Attendu : {"maxSpeakers":1} → conforme.
- Émotions : 4 libellés distincts, dominant 0.667 ; {"informé":6,"informative":1,"neutral":1,"précaution":1}.
- Intensité : moyenne 0.52, écart-type 0.06 ; tempo : {"0.9-1.1":8,">1.1":1} ; pause après : {"1-300":5,"absent":4} ; pause avant : {"1-300":7,"absent":2}.
- Champs présents (part des cues) : émotion 1, tempo 1, pause 1, note de jeu 0.333, insistance 0.333, non verbal 0.
- Tempo > 1,1 parmi les cues qui portent un tempo : 0.111 ; segments dirigés avec plusieurs locuteurs : 0.
- Monotonie : non (aucun critère atteint).
- Violations à la première réponse (contrôleur) : {"uncovered-source":4} ; replis : {"resend-budget-exhausted":1}.

### reponse-ia

- Analyse obtenue (dernière répétition) : genre « Documentation technique », ton « Informel, détaillé », intention « Informations sur l'état de développement du modèle local et des tests associés. » ; personnages : aucun.
- Cues dirigées : 6 (1 par segment). Locuteurs : {"narrator":6}. Attendu : {"maxSpeakers":1} → conforme.
- Émotions : 3 libellés distincts, dominant 0.5 ; {"neutral":3,"positif":2,"satisfait":1}.
- Intensité : moyenne 0.62, écart-type 0.13 ; tempo : {"0.9-1.1":5,">1.1":1} ; pause après : {"absent":5,"1-300":1} ; pause avant : {"1-300":3,"301-800":2,"absent":1}.
- Champs présents (part des cues) : émotion 1, tempo 1, pause 1, note de jeu 0.833, insistance 0.833, non verbal 0.
- Tempo > 1,1 parmi les cues qui portent un tempo : 0.167 ; segments dirigés avec plusieurs locuteurs : 0.
- Monotonie : non (aucun critère atteint).
- Violations à la première réponse (contrôleur) : {"uncovered-source":3} ; replis : {"resend-budget-exhausted":1}.

