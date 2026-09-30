# Agentic Claim Ledger

- Task id: GAO-adr-015-5-an-001
- Profile: controlled

## Partie 5a

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-5a-001 | `src/direction/director/` n'importe pas `vscode`, ne fait aucun `fetch` ni import réseau, ne référence ni le player ni `CoreClient` | fait | `static.test.ts` (regex par fichier) ; `tsc` et ESLint verts | prouvé | élevée | utiliser |
| CL-5a-002 | L'analyste n'écrit que dans la portée document (aucun journal série ou utilisateur créé), une fois par document, sans rejeter en cas de panne | fait | `analyst.test.ts` (18 tests) | prouvé | élevée | utiliser |
| CL-5a-003 | Le metteur en scène renvoie ≤ 2 fois puis retombe sur la partition neutre ; les faits d'une réponse rejetée ne sont pas appliqués | fait | `stageDirector.test.ts` ; mutant « faits d'une réponse rejetée » tué (14 échecs) | prouvé | élevée | utiliser |
| CL-5a-004 | En mode jeu, aucun appel LLM n'est émis, la partition en cache est jouée, sinon lecture neutre immédiate, la direction reprend à la fenêtre suivante après la levée du drapeau | fait | `pipeline.test.ts` « Test 14 (mode jeu) », drapeau simulé par dossier temporaire ; mutant « drapeau ignoré » tué (4 échecs) | prouvé | élevée | utiliser |
| CL-5a-005 | Panne, retard au-delà du budget, réponse invalide, annulation : le pipeline répond en neutre dans un délai borné | fait | `pipeline.test.ts` « Test 10 et 11 », durées assertées (< 500 ms, < 600 ms avec budget 60 ms) | prouvé | élevée | utiliser |
| CL-5a-006 | Avec un `EgressGuard` en `local`, une destination non loopback (IP publique, hôte distant, rebinding, `file:`) n'émet aucune requête ; une lecture loopback complète n'atteint que 127.0.0.1 | fait | `pipeline.test.ts` « Test 12 » (fetch enregistreur) ; mutant « refus sans suspension » tué (4 échecs) | prouvé | élevée | utiliser |
| CL-5a-007 | Aucun contenu (texte, note de jeu, trait) dans la trace, les journaux du garde ni les événements du store | fait | test sentinelle de `pipeline.test.ts` | prouvé | moyenne (trace et garde seulement ; pas de logger de production ici) | utiliser |
| CL-5a-008 | Relire un document = zéro appel modèle, malgré les faits ajoutés par le metteur en scène ; modifier un paragraphe ne recalcule que les fenêtres touchées | fait | `pipeline.test.ts` « Test 14 (cache et anticipation) » ; mutant « empreinte incluant le metteur en scène » tué (3 échecs) | prouvé | élevée | utiliser |
| CL-5a-009 | `npm run test:unit` 1 775 verts (avant : 1 662), `typecheck` et `lint` sans erreur | résultat | dernière exécution de la session | prouvé | élevée | utiliser |
| CL-5a-010 | Le comportement d'un vrai client Ollama (prompts, sortie `format`, timeouts HTTP) est conforme | hypothèse | aucun client réel écrit ni exécuté en 5a | non vérifié | — | traiter en 5b |
| CL-5a-011 | Les latences du metteur en scène tiennent le bilan de débit ; les valeurs K, W, L, N, 1,5 s, 10 s, seuil 3 conviennent | hypothèse | aucune mesure (aucun LLM réel) | non vérifié | faible | mesurer en 5b/6, hors mode jeu |
| CL-5a-012 | `src/core/direction.ts` et les modules bible, controller, translator n'ont pas été modifiés | fait | aucun Edit/Write sur ces fichiers | prouvé | élevée | utiliser |
| CL-5a-013 | La carte n'a pas changé d'état et rien n'a été commité | fait | aucune commande `task move/close`, aucun `git commit` | prouvé | élevée | utiliser |

## Partie 5b

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-5b-001 | `OllamaDirectionLlm` n'émet de requête que via `EgressGuardHandle` ; une destination non loopback, `file:`, un rebinding ou une redirection croisée n'émettent aucune requête et donnent `egress-denied` | fait | `ollama.test.ts` « local-first » (fetch enregistreur) ; mutant « refus du garde traité en panne » tué (6 échecs) | prouvé | élevée | utiliser |
| CL-5b-002 | Le format de requête (modèle `qwen2.5:7b`, `stream:false`, `keep_alive`, `format`, `num_ctx`) et les erreurs (HTTP, absent, non-JSON, sans contenu, timeout, annulation) sont conformes | fait | `ollama.test.ts` ; mutant « `keep_alive` retiré » tué (2 échecs) | prouvé | élevée | utiliser |
| CL-5b-003 | Le client réel a fonctionné contre un vrai Ollama : 28 appels, 0 échec, aucune réponse coupée, contexte jamais saturé | résultat | `direction-eval/baseline-qwen2.5-7b.json` | prouvé | moyenne (un modèle, 2 répétitions par texte) | utiliser |
| CL-5b-004 | Le contrôleur laisse passer les nombres, commandes, versions et négations : 27/27 éléments à conserver retrouvés ; 12/16 premières réponses acceptées, 4 refusées pour couverture (3), nombre (1), négation (1) | résultat | rapport de mesure, verdicts par réponse | prouvé | moyenne | utiliser |
| CL-5b-005 | 15 fenêtres sur 16 dirigées, 1 repli (6 %), 4 fenêtres renvoyées (25 %) | résultat | rapport de mesure | prouvé | moyenne (échantillon faible) | utiliser |
| CL-5b-006 | Le budget de premier son de 10 s est tenu | hypothèse | mesure : premier segment dirigé 16,0 à 29,1 s (p50 22,3 s) | **réfutée** | élevée | changer (budget, taille de la première fenêtre ou démarrage neutre) |
| CL-5b-007 | Le débit tient le régime établi (budget 1,5 s, N=8, K=4) | résultat | direction 0,216 seg/s contre lecture 0,071 seg/s (×3), simulation : retard limité à la première fenêtre | prouvé sans TTS ; non vérifié avec TTS sur le même GPU | moyenne | garder, revalider en 5c/6 |
| CL-5b-008 | Les partitions ne sont pas monotones | hypothèse | conte : 5 libellés mais tempo > 1,1 dans 8/9 cas, intensité 0,73 ± 0,08 ; documentation et réponse d'IA : aucune émotion, tempo ni pause | **partiellement réfutée** | moyenne | à juger à l'écoute (carte 6) ; prompt à retravailler si insuffisant |
| CL-5b-009 | Les dialogues sont attribués à des locuteurs distincts | résultat | conte : narrator 9, maelys 4, renard 3 ; mais une consigne par segment, pas de découpage récit/réplique dans un segment | prouvé pour l'attribution, limite constatée pour le découpage | moyenne | traiter (prompt ou exemple) |
| CL-5b-010 | Le prompt v2 (liste des segments à couvrir) corrige l'oubli du dernier segment | hypothèse | v1 : 0/3 acceptées (un passage) ; v2 : 12/16 ; pas de comparaison contrôlée | non vérifié statistiquement | faible | consigner |
| CL-5b-011 | Le numéro de version des prompts est dans la partition | fait | non : contrat strict ; version dans la clé de cache, le rapport et `promptVersion` | écart documenté | élevée | utiliser l'écart |
| CL-5b-012 | `test:unit` 1 809 verts (avant 1 775), `typecheck` et `lint` sans erreur | résultat | dernière exécution de la session | prouvé | élevée | utiliser |
| CL-5b-013 | Cause des ~8 s de génération non expliquées par le débit en jetons | hypothèse | `total_duration` p50 12,7 s contre ~4,3 s attendues | non vérifié | — | investiguer en carte 6 |
| CL-5b-014 | `src/core/direction.ts`, bible, controller, translator, `Pipeline.ts` non modifiés ; carte non déplacée ; rien commité | fait | aucun Edit sur ces fichiers, aucune commande `task move/close`, aucun `git commit` | prouvé | élevée | utiliser |

## Partie 5b-bis

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-5bb-001 | La lecture démarre sans attente : les segments de tête et ceux d'une fenêtre non prête sont lus en neutre, le relais vers la direction est transparent, le préchargement part à l'ouverture (jamais en mode jeu) | fait | `startup.test.ts` (15) ; mutants « attente de démarrage retirée » (2 échecs), « préchargement en mode jeu » (1) tués ; premier son 0,2 à 0,7 ms mesuré | prouvé | élevée | utiliser |
| CL-5bb-002 | L'analyste sans `format` est valide : lecture tolérante, un seul renvoi, puis repli | fait / résultat | `tolerantJson.test.ts`, `ollama.test.ts` ; mutant « renvoi retiré » tué (3) ; 6/6 analyses valides, appel 2,0 s contre 4,1 s | prouvé (petit échantillon) | moyenne | utiliser, garder `format` du metteur en scène |
| CL-5bb-003 | La version des prompts (`analyst-2.director-3`) est dans la clé de cache : une autre version ne sert pas le cache | fait | `startup.test.ts` « prompt version in the cache key » | prouvé | élevée | utiliser |
| CL-5bb-004 | Les partitions director-3 sont expressives pour documentation et réponse d'IA (plus de partition plate) et le tempo du conte n'est plus biaisé | résultat | émotion, tempo, pause à 100 % ; tempo > 1,1 : 25 % contre 89 % ; 10 libellés dans le conte | prouvé structurellement ; qualité sonore non jugée | moyenne | écoute en carte 6 |
| CL-5bb-005 | Le récit et les répliques sont séparés en consignes distinctes | résultat | 12,5 % des segments du conte à plusieurs locuteurs (0 % en baseline) | **partiellement atteint** | moyenne | à retravailler |
| CL-5bb-006 | Le premier segment dirigé arrive plus tôt qu'en baseline | hypothèse | 34,4 s p50 (32,2 à 41,2) contre 22,3 s ; 48,7 à 71,0 s avec une tête de 1 | **réfutée** | élevée (6 mesures, un modèle) | traiter : tête plus longue, fenêtres courtes au démarrage, prompt plus court |
| CL-5bb-007 | La validité des fenêtres est maintenue avec le prompt riche | hypothèse | 1re réponse acceptée 7/16 (12/16 en baseline), repli 2/16 (1/16) | **réfutée** en 1re réponse ; fenêtres dirigées 14/16 (88 %) | moyenne | surveiller ; prompt à alléger ou exemple de couverture |
| CL-5bb-008 | `test:unit` 1 845 verts (avant 1 809), `typecheck` et `lint` sans erreur | résultat | dernière exécution de la session | prouvé | élevée | utiliser |
| CL-5bb-009 | Un délai de démarrage nul lit en neutre un document entièrement en cache | fait | 1re mesure (`director-3-lead1`) : 0 cue en relecture ; corrigé par `startupGraceMs` 150 ms, test « re-read » sans `idle()` | prouvé, corrigé | élevée | utiliser |
| CL-5bb-010 | Aucun module protégé modifié, carte non déplacée, rien commité | fait | aucun Edit hors `vscode-extension/{src/direction/director,test,scripts/direction-eval}` | prouvé | élevée | utiliser |
