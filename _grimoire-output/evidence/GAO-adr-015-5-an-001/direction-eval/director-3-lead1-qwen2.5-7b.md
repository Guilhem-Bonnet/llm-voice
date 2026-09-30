# Mesure de la direction de lecture — director-3-qwen2.5-7b

- Date : 2026-09-30T02:32:33.339Z
- Modèle : `qwen2.5:7b` (température 0.2, num_ctx 8192, keep_alive 10m)
- Version des prompts : `analyst-2.director-3`
- Paramètres : K=4, W=6, L=4, N=8, budget établi 1 500 ms, budget de premier son 10 000 ms, lecture estimée 15 caractères/s
- Répétitions par texte : 2 (chaque répétition = document neuf, bible et cache vides, modèle chaud)
- Démarrage : 5b-bis (segments de tête neutres : 1, première fenêtre : 2, préchargement, budgets de production 10 s / 1,5 s) ; lecture en temps réel (durée estimée de chaque segment).
- Chargement à froid du modèle (hors mesure) : 144.8 ms
- Statut : complete

## Synthèse par texte

| Texte | Fenêtres | Dirigées | Repli neutre | Fenêtres avec renvoi | Appels/fenêtre | 1re réponse acceptée | 1re acceptée (faithful) | « À conserver » | Premier segment dirigé p50 / p95 (ms) | Direction / lecture (seg/s) |
|---|---|---|---|---|---|---|---|---|---|---|
| conte | 6 | 6 (1) | 0 (0) | 1 (0.167) | 1.17 | 5/6 | 4/6 | 0/0 | 64905.2 / 64905.7 | 0.035 / 0.07 |
| doc-technique | 6 | 5 (0.833) | 1 (0.167) | 3 (0.5) | 1.67 | 3/6 | 3/6 | 0/0 | 48706.3 / 48708.1 | 0.036 / 0.082 |
| reponse-ia | 4 | 3 (0.75) | 1 (0.25) | 4 (1) | 3 | 0/4 | 0/4 | 0/0 | 71044.1 / 71044.1 | 0.006 / 0.071 |

## Démarrage par texte

| Texte | Premier son p50 (ms) | Direction prête p50 (ms) | Premier segment dirigé p50 (ms) | Segments lus en neutre / total | Analyse (statuts) | Segments dirigés avec récit et réplique séparés |
|---|---|---|---|---|---|---|
| conte | 0.7 | 23327.5 | 64905.2 | 10/20 | {"analyzed":2} | — |
| doc-technique | 0.4 | 29163 | 48706.3 | 10/18 | {"analyzed":2} | — |
| reponse-ia | 0.2 | 32957.6 | 71044.1 | 11/12 | {"analyzed":2} | — |

## Latence et débit (tous textes)

- Premier segment dirigé (analyse + première fenêtre, modèle chaud) : p50 64904.5 ms, p95 69816.5 ms, min 48704.2 ms, max 71044.1 ms sur 5 mesures (1 sans segment dirigé).
- Premier son (segment 1, neutre au démarrage) et premier segment dirigé prêt : voir « Démarrage par texte » ci-dessous.
- Appel d'analyse : p50 1985.5 ms, p95 3465.3 ms.
- Appel de direction (une fenêtre, un essai) : p50 9884 ms, p95 26620.4 ms (temps serveur total_duration p50 9883.2 ms, évaluation du prompt p50 161.8 ms) ; jetons de prompt p50 1823 / max 2517 ; jetons générés p50 322 ; 92.7 jetons/s en génération.
- Contexte saturé (prompt ≥ 98 % de num_ctx) : 0 appel(s) ; réponses coupées par la limite de jetons : 0 ; appels en échec : 0 sur 35.
- Débit : la direction produit 0.035 segments/s (médiane des lectures) contre 0.071 segments/s lus à 15 caractères/s : rapport 0.5.
- Relecture (cache) : 0 appel(s) modèle sur 3 relecture(s), fenêtres servies par le cache 0/0.

## Simulation de lecture (durées mesurées, lecture à vitesse estimée)

Non applicable : avec le démarrage 5b-bis la lecture est jouée en temps réel dans la mesure (voir « Démarrage par texte »).

## Qualité des partitions

### conte

- Analyse obtenue (dernière répétition) : genre « Conte pour enfants », ton « Doux, mystérieux », intention « Faire entendre l'histoire de Maëlys et le renard » ; personnages : maelys, renard.
- Cues dirigées : 0 (0 par segment). Locuteurs : {}. Attendu : {"minSpeakers":2} → NON conforme.
- Émotions : 0 libellés distincts, dominant — ; {}.
- Intensité : moyenne —, écart-type — ; tempo : {} ; pause après : {} ; pause avant : {}.
- Champs présents (part des cues) : émotion —, tempo —, pause —, note de jeu —, insistance —, non verbal —.
- Tempo > 1,1 parmi les cues qui portent un tempo : — ; segments dirigés avec plusieurs locuteurs : —.
- Monotonie : non (aucun critère atteint).
- Violations à la première réponse (contrôleur) : {"uncovered-source":1} ; replis : {}.

### doc-technique

- Analyse obtenue (dernière répétition) : genre « Instructions pour l'installation et la configuration d'un logiciel », ton « Informel, explicatif », intention « Informer et guider l'utilisateur à travers le processus d'installation et de configuration » ; personnages : aucun.
- Cues dirigées : 0 (0 par segment). Locuteurs : {}. Attendu : {"maxSpeakers":1} → conforme.
- Émotions : 0 libellés distincts, dominant — ; {}.
- Intensité : moyenne —, écart-type — ; tempo : {} ; pause après : {} ; pause avant : {}.
- Champs présents (part des cues) : émotion —, tempo —, pause —, note de jeu —, insistance —, non verbal —.
- Tempo > 1,1 parmi les cues qui portent un tempo : — ; segments dirigés avec plusieurs locuteurs : —.
- Monotonie : non (aucun critère atteint).
- Violations à la première réponse (contrôleur) : {"uncovered-source":3} ; replis : {"resend-budget-exhausted":1}.

### reponse-ia

- Analyse obtenue (dernière répétition) : genre « Documentation technique », ton « Formel », intention « Informations sur l'état de développement d'un système » ; personnages : aucun.
- Cues dirigées : 0 (0 par segment). Locuteurs : {}. Attendu : {"maxSpeakers":1} → conforme.
- Émotions : 0 libellés distincts, dominant — ; {}.
- Intensité : moyenne —, écart-type — ; tempo : {} ; pause après : {} ; pause avant : {}.
- Champs présents (part des cues) : émotion —, tempo —, pause —, note de jeu —, insistance —, non verbal —.
- Tempo > 1,1 parmi les cues qui portent un tempo : — ; segments dirigés avec plusieurs locuteurs : —.
- Monotonie : non (aucun critère atteint).
- Violations à la première réponse (contrôleur) : {"uncovered-source":4} ; replis : {"resend-budget-exhausted":1}.

