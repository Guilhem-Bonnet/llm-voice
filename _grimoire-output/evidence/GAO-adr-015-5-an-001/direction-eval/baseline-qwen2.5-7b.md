# Mesure de la direction de lecture — baseline-qwen2.5-7b

- Date : 2026-09-30T01:58:33.270Z
- Modèle : `qwen2.5:7b` (température 0.2, num_ctx 8192, keep_alive 10m)
- Version des prompts : `analyst-1.director-2`
- Paramètres : K=4, W=6, L=4, N=8, budget établi 1 500 ms, budget de premier son 10 000 ms, lecture estimée 15 caractères/s
- Répétitions par texte : 2 (chaque répétition = document neuf, bible et cache vides, modèle chaud)
- Chargement à froid du modèle (hors mesure) : 152.9 ms
- Statut : complete

## Synthèse par texte

| Texte | Fenêtres | Dirigées | Repli neutre | Fenêtres avec renvoi | Appels/fenêtre | 1re réponse acceptée | 1re acceptée (faithful) | « À conserver » | Premier segment dirigé p50 / p95 (ms) | Direction / lecture (seg/s) |
|---|---|---|---|---|---|---|---|---|---|---|
| conte | 6 | 5 (0.833) | 1 (0.167) | 2 (0.333) | 1.67 | 4/6 | 2/6 | 5/5 | 26893.5 / 28855.5 | 0.085 / 0.07 |
| doc-technique | 6 | 6 (1) | 0 (0) | 1 (0.167) | 1.17 | 5/6 | 5/6 | 12/12 | 19188.4 / 22043.6 | 0.241 / 0.082 |
| reponse-ia | 4 | 4 (1) | 0 (0) | 1 (0.25) | 1.25 | 3/4 | 3/4 | 10/10 | 19614.6 / 22051.2 | 0.216 / 0.071 |

## Latence et débit (tous textes)

- Premier segment dirigé (analyse + première fenêtre, modèle chaud) : p50 22341.4 ms, p95 27983.5 ms, min 16015.8 ms, max 29073.5 ms sur 6 mesures (0 sans segment dirigé).
- Appel d'analyse : p50 4132.5 ms, p95 7750.5 ms.
- Appel de direction (une fenêtre, un essai) : p50 12746.5 ms, p95 21944.4 ms (temps serveur total_duration p50 12745.8 ms, évaluation du prompt p50 226.6 ms) ; jetons de prompt p50 1552 / max 2015 ; jetons générés p50 402 ; 93.1 jetons/s en génération.
- Contexte saturé (prompt ≥ 98 % de num_ctx) : 0 appel(s) ; réponses coupées par la limite de jetons : 0 ; appels en échec : 0 sur 28.
- Débit : la direction produit 0.216 segments/s (médiane des lectures) contre 0.071 segments/s lus à 15 caractères/s : rapport 3.
- Relecture (cache) : 0 appel(s) modèle sur 3 relecture(s), fenêtres servies par le cache 8/8.

## Simulation de lecture (durées mesurées, lecture à vitesse estimée)

Part de segments lus en neutre par retard (moyenne sur toutes les lectures mesurées) selon N (anticipation) et le budget établi ; budget de premier son 10 000 ms. Premier son = attente avant le premier segment.

| N \ budget établi | 1 500 ms | 3 000 ms | 5 000 ms |
|---|---|---|---|
| 4 | 0.307 (max attente 10000 ms) | 0.307 (max attente 10000 ms) | 0.291 (max attente 10000 ms) |
| 8 | 0.307 (max attente 10000 ms) | 0.307 (max attente 10000 ms) | 0.291 (max attente 10000 ms) |
| 12 | 0.307 (max attente 10000 ms) | 0.307 (max attente 10000 ms) | 0.291 (max attente 10000 ms) |

Premier son simulé : p50 10000 ms, p95 10000 ms, max 10000 ms ; part de lectures où le premier segment dépasse 10 000 ms : 0.

## Qualité des partitions

### conte

- Analyse obtenue (dernière répétition) : genre « Conte pour enfants », ton « Doux, mélancolique », intention « Raconter l'histoire d'une petite fille généreuse et son renard amical » ; personnages : maelys, renard.
- Cues dirigées : 16 (1 par segment). Locuteurs : {"narrator":9,"maelys":4,"renard":3}. Attendu : {"minSpeakers":2} → conforme.
- Émotions : 5 libellés distincts, dominant 0.556 ; {"dubitative":5,"doux":1,"triste":1,"joyful and relieved":1,"happy and relieved":1}.
- Intensité : moyenne 0.73, écart-type 0.08 ; tempo : {">1.1":8,"absent":7,"0.9-1.1":1} ; pause après : {"0":1,"absent":11,"1-300":2,"301-800":2} ; pause avant : {"1-300":8,"absent":7,"301-800":1}.
- Champs présents (part des cues) : émotion 0.563, tempo 0.563, pause 0.563, note de jeu 0.375, insistance 0.375, non verbal 0.
- Monotonie : non (aucun critère atteint).
- Violations à la première réponse (contrôleur) : {"uncovered-source":1,"number-lost":1,"negation-lost":1} ; replis : {"resend-budget-exhausted":1}.

### doc-technique

- Analyse obtenue (dernière répétition) : genre « Manuel d'instructions », ton « Informel, explicatif », intention « Informer sur l'installation et la configuration du moteur de synthèse vocale » ; personnages : aucun.
- Cues dirigées : 16 (0.89 par segment). Locuteurs : {"narrator":16}. Attendu : {"maxSpeakers":1} → conforme.
- Émotions : 0 libellés distincts, dominant — ; {}.
- Intensité : moyenne —, écart-type — ; tempo : {"absent":16} ; pause après : {"absent":16} ; pause avant : {"absent":16}.
- Champs présents (part des cues) : émotion 0, tempo 0, pause 0, note de jeu 0, insistance 0.063, non verbal 0.
- Monotonie : OUI (aucune émotion renseignée ; 0 libellé(s) d'émotion distinct(s) ; tempo identique partout ; mêmes pauses partout).
- Violations à la première réponse (contrôleur) : {"uncovered-source":1} ; replis : {}.

### reponse-ia

- Analyse obtenue (dernière répétition) : genre « Code et documentation », ton « Formel », intention « Informations sur l'état du développement et les prochaines étapes » ; personnages : aucun.
- Cues dirigées : 12 (1 par segment). Locuteurs : {"narrator":12}. Attendu : {"maxSpeakers":1} → conforme.
- Émotions : 0 libellés distincts, dominant — ; {}.
- Intensité : moyenne —, écart-type — ; tempo : {"absent":12} ; pause après : {"absent":10,"301-800":1,"1-300":1} ; pause avant : {"absent":12}.
- Champs présents (part des cues) : émotion 0, tempo 0, pause 0.167, note de jeu 0, insistance 0, non verbal 0.
- Monotonie : OUI (aucune émotion renseignée ; 0 libellé(s) d'émotion distinct(s) ; tempo identique partout).
- Violations à la première réponse (contrôleur) : {"uncovered-source":1} ; replis : {}.

