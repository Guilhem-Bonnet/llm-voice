# Étiquettes à relire — jeu d'évaluation du mode « Auto » (GAO-valuation-m-001)

Les profils ci-dessous ont été **proposés par Claude**, pas par toi. Tant qu'ils ne sont pas relus, tout
score du banc mesure seulement l'accord avec ces propositions. Texte complet de chaque cas :
`dataset/auto-eval-v1.jsonl` (champ `text`, même `id`), avec la justification dans `rationale`.

Profils possibles : `faithful-local` (Lecture fidèle : tel quel, mot à mot) · `llm-summary` (Résumé LLM :
fait, limites, reste à faire) · `technical-teacher` (Professeur technique : explication pédagogique) ·
`quick-review` (Révision rapide : concepts, pièges, essentiel). `system-voice` n'est pas une option : même
mode que `faithful-local`, seule la voix change.

## Consigne (5 minutes)

1. Parcours le tableau. Si le profil proposé te convient, **laisse « Profil validé » vide**.
2. Sinon, écris l'id du bon profil dans « Profil validé » (un des quatre ci-dessus).
3. Applique : `node vscode-extension/scripts/decision-spike/apply-labels.mjs` — chaque cas reçoit
   `userLabel` et `labelSource: "user"` (la proposition reste dans `proposedProfile`).
4. Remesure : `node vscode-extension/scripts/decision-spike/run-all.mjs` (le banc lit `userLabel` d'abord).

| id | Catégorie | Extrait (80 car.) | Profil proposé | Profil validé |
|---|---|---|---|---|
| auto-001 | done-short | C'est fait : le fichier 'config.yaml' est corrigé et le lint passe. | faithful-local |  |
| auto-002 | done-short | Terminé. J'ai renommé 'getUser' en 'fetchUser' dans les 4 fichiers concernés ; … | faithful-local |  |
| auto-003 | done-short | Done — the migration ran successfully and the new column 'archived_at' is now i… | faithful-local |  |
| auto-004 | error-report | La compilation échoue : 'error TS2345: Argument of type 'string' is not assigna… | faithful-local |  |
| auto-005 | error-report | ## Diagnostic de l'échec du build CI J'ai analysé le job 'build-and-test' qui é… | llm-summary |  |
| auto-006 | error-report | Je n'ai pas pu terminer le déploiement sur l'environnement de préproduction. - … | llm-summary |  |
| auto-007 | question-to-user | Avant de continuer : tu préfères que je stocke les sessions dans Redis (plus ra… | faithful-local |  |
| auto-008 | question-to-user | J'ai besoin de trois précisions avant d'écrire le script de migration : 1. Les … | faithful-local |  |
| auto-009 | question-to-user | Le dossier 'dist/' contient 1,2 Go d'artefacts anciens. Je peux le vider avec '… | faithful-local |  |
| auto-010 | tutorial | # Mettre en place un reverse proxy Caddy avec HTTPS automatique Caddy obtient e… | technical-teacher |  |
| auto-011 | tutorial | Voici comment écrire ton premier test avec Vitest, étape par étape. **1. Instal… | technical-teacher |  |
| auto-012 | tutorial | ## How to profile a slow Python function 1. **Measure first.** Wrap the call wi… | technical-teacher |  |
| auto-013 | code-diff | J'ai corrigé la fuite de mémoire dans le composant 'LiveChart'. '''diff useEffe… | technical-teacher |  |
| auto-014 | code-diff | Modifications appliquées : '''diff --- a/src/api/client.ts +++ b/src/api/client… | llm-summary |  |
| auto-015 | code-diff | Remplace la ligne 18 de 'docker-compose.yml' par : '''yaml command: ["gunicorn"… | faithful-local |  |
| auto-016 | results-table | Résultats du benchmark des trois sérialiseurs (10 000 objets, moyenne sur 5 exé… | llm-summary |  |
| auto-017 | results-table | / Endpoint / p50 avant / p50 après / p95 avant / p95 après / /---/---:/---:/---… | llm-summary |  |
| auto-018 | results-table | Audit des dépendances terminé : / Paquet / Version / Vulnérabilité / Sévérité /… | llm-summary |  |
| auto-019 | step-list | Pour restaurer la base depuis la sauvegarde d'hier : 1. Arrête l'application : … | faithful-local |  |
| auto-020 | step-list | Il te reste trois choses à faire de ton côté : - ajouter le secret 'DEPLOY_TOKE… | faithful-local |  |
| auto-021 | step-list | Checklist de mise en production pour la version 2.4 : - [x] Changelog rédigé - … | quick-review |  |
| auto-022 | architecture-plan | # Proposition d'architecture : notifications en temps réel ## Contexte Aujourd'… | technical-teacher |  |
| auto-023 | architecture-plan | Plan d'implémentation proposé pour le module de facturation : **Étape 1 — Modèl… | llm-summary |  |
| auto-024 | architecture-plan | Je propose de découper le service en trois couches, sur le modèle « hexagonal »… | technical-teacher |  |
| auto-025 | code-review | ## Revue de la PR #218 « Ajout du cache produits » **Bloquant** - 'cache.ts:34'… | quick-review |  |
| auto-026 | code-review | J'ai relu 'auth/middleware.ts'. Points à retenir : 1. **Comparaison de jeton no… | quick-review |  |
| auto-027 | code-review | Review of 'payment_retry.py': - **Retry without backoff**: the loop retries imm… | quick-review |  |
| auto-028 | english | I've updated the README with the new installation steps and fixed the broken ba… | faithful-local |  |
| auto-029 | english | Summary of what I did: - Added the '/health' and '/ready' endpoints; '/ready' c… | llm-summary |  |
| auto-030 | english | Think of a Git rebase as replaying your work on top of a new starting point. Wh… | technical-teacher |  |
| auto-031 | mixed-fr-en | OK, j'ai fait le 'git rebase -i' et squashé les 3 commits de fix en un seul ; l… | faithful-local |  |
| auto-032 | mixed-fr-en | Récap de la session : - Le 'flaky test' sur 'checkout.spec.ts' venait d'un 'rac… | llm-summary |  |
| auto-033 | mixed-fr-en | Quelques pièges à garder en tête avec 'async/await' en JavaScript : - **'forEac… | quick-review |  |
| auto-034 | command-output | Voici la sortie de 'kubectl get pods -n shop' : ''' NAME READY STATUS RESTARTS … | llm-summary |  |
| auto-035 | command-output | Résultat de 'df -h' et 'du' sur le serveur : ''' Filesystem Size Used Avail Use… | llm-summary |  |
| auto-036 | command-output | 'node --version' renvoie 'v22.11.0' et 'npm --version' renvoie '10.9.0' : les d… | faithful-local |  |
| auto-037 | test-summary | Suite de tests exécutée ('pytest -q') : ''' ...................................… | llm-summary |  |
| auto-038 | test-summary | Bilan de la campagne de tests après la refonte du panier : - **Unitaires** : 34… | llm-summary |  |
| auto-039 | test-summary | Les 48 tests passent (0 échec, 0 ignoré) en 3,2 s. | faithful-local |  |
| auto-040 | concept-explanation | Un index de base de données fonctionne comme l'index à la fin d'un livre. Sans … | technical-teacher |  |
| auto-041 | concept-explanation | La différence entre un conteneur et une machine virtuelle tient à ce qu'ils iso… | technical-teacher |  |
| auto-042 | concept-explanation | En Rust, le *borrow checker* applique une règle simple : à un instant donné, un… | technical-teacher |  |
| auto-043 | apology-failure | Désolé, je me suis trompé : la commande que je t'ai donnée supprime aussi les b… | faithful-local |  |
| auto-044 | apology-failure | Je n'ai pas réussi à reproduire le bug de corruption des images. Ce que j'ai es… | llm-summary |  |
| auto-045 | apology-failure | Mea culpa : mon correctif précédent a cassé l'import des fichiers CSV avec poin… | faithful-local |  |
| auto-046 | cheat-sheet | Aide-mémoire Docker pour le quotidien : - 'docker ps -a' : tous les conteneurs,… | quick-review |  |
| auto-047 | cheat-sheet | Les points essentiels à retenir sur la gestion des secrets : 1. Jamais de secre… | quick-review |  |
| auto-048 | cheat-sheet | En résumé, les pièges des fuseaux horaires à retenir : - Stocker toujours en UT… | quick-review |  |
| auto-049 | done-short | Poussé sur 'feat/export-csv' ; la PR #231 est ouverte et la CI tourne. | faithful-local |  |
| auto-050 | concept-explanation | Why does my React component re-render when nothing changed? Because React compa… | technical-teacher |  |
| auto-051 | results-table | Comparaison des trois modèles de classification sur le jeu de validation : / Mo… | llm-summary |  |
