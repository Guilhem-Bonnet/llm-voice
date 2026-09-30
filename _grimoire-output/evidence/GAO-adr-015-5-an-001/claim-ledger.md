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
