# 🏛️ Failure Museum — TTS-Voice

> **Principe** : Chaque échec instruit. Ce document capture les erreurs les plus significatives
> du projet pour que chaque agent les consulte au démarrage et apprenne AVANT de répéter.
>
> **Mise à jour** : Automatiquement par `sil-collect.sh` + manuellement par tout agent
> après un incident non-trivial.
>
> **Usage** : Les agents consultent ce fichier en step 2 d'activation (LAZY-LOAD si projet actif > 2 semaines).
>
> Format : `[YYYY-MM-DD] [agent] [category] [description courte]`
> Catégories : `CC-FAIL` | `WRONG-ASSUMPTION` | `CONTEXT-LOSS` | `HALLUCINATION` | `ARCH-MISTAKE` | `PROCESS-SKIP`

---

## 🔴 Top Erreurs Critiques (à lire ABSOLUMENT)

> Ces erreurs ont causé du revert, de la perte de travail, ou bloqué l'équipe.

<!-- Exemple :
### [2026-02-10] [dev] CC-FAIL — Tests non exécutés avant "terminé"
**Ce qui s'est passé** : L'agent a déclaré l'implémentation terminée sans lancer `go test ./...`
**Cause racine** : Pression pour terminer vite, skip du CC
**Impact** : 3 tests en échec découverts par QA, revert nécessaire
**Leçon** : TOUJOURS exécuter le CC, même pour "un petit changement"
**Règle instaurée** : Le mot "terminé" est maintenant interdit sans output CC PASS affiché
-->

*(Aucune erreur critique enregistrée — remplir dès le premier incident)*

---

## 🟡 Erreurs Importantes (à connaître)

> Ces erreurs ont causé du retard ou nécessité du rework.

<!-- Exemple :
### [2026-02-15] [architect] WRONG-ASSUMPTION — Stack détecté comme monolith alors que microservices
**Ce qui s'est passé** : L'agent a supposé une architecture monolith sans lire project-context.yaml
**Cause racine** : Context pas chargé en step 2
**Leçon** : TOUJOURS lire project-context.yaml avant toute décision architecturale
-->

*(Aucune erreur importante enregistrée)*

---

## 🟢 Micro-Erreurs (signaux faibles)

> Petites frictions récurrentes qui méritent attention.

*(Aucune micro-erreur enregistrée)*

---

## 📊 Statistiques

| Catégorie | Occurrences | Dernière date |
|---|---|---|
| CC-FAIL | 0 | — |
| WRONG-ASSUMPTION | 0 | — |
| CONTEXT-LOSS | 0 | — |
| HALLUCINATION | 0 | — |
| ARCH-MISTAKE | 0 | — |
| PROCESS-SKIP | 0 | — |

---

## 🛠️ Ajouter une entrée

```markdown
### [YYYY-MM-DD] [agent] [category] — [titre court]
**Ce qui s'est passé** : description factuelle en 2-3 phrases
**Cause racine** : pourquoi c'est arrivé (pas de jugement — just facts)
**Impact** : temps perdu, revert, blocage équipe...
**Leçon** : ce qu'on fait différemment maintenant
**Règle instaurée** : (si applicable) modification dans agent-base.md ou workflow
```

---

*Template Grimoire Custom Kit — BM-03 Failure Museum | framework/memory/failure-museum.tpl.md*
*Initialisé le : 2026-09-08 — Projet : TTS-Voice*

### [2026-09-08] [sentinel] PROCESS-SKIP — Trois tentatives identiques contre CodeQL sur `audio.src`
**Ce qui s'est passé** : l'agent de revue a poussé trois variantes de garde `startsWith` que CodeQL ne reconnaît pas comme sanitizer (js/xss, js/client-side-unvalidated-url-redirection).
**Cause racine** : même signature d'échec répétée sans changer de stratégie ; le circuit breaker fix-loop (2 signatures identiques = stop) n'a pas été appliqué par l'agent.
**Impact** : ~40 minutes et trois runs CI.
**Leçon** : pour une URL assignée dans un webview, valider structurellement avec `new URL()` + allowlist protocole/hôte dès la première fois ; l'orchestrateur surveille les signatures d'échec des sous-agents.
**Règle instaurée** : tout brief de revue impose « max 2 tentatives sur la même alerte, puis rapport ».

### [2026-09-08] [backend-engineer] ARCH-MISTAKE — Traversée de chemin dans l'inbox livrée en PR
**Ce qui s'est passé** : `InboxRepository` construisait un chemin à partir de `sessionId` sans allowlist ; un `sessionId` contenant `../` écrivait hors du dossier inbox (PoC réel par Sentinel).
**Cause racine** : AC-SEC-03 était dans le brief mais l'auteur a testé la lecture, pas l'écriture avec un identifiant hostile.
**Impact** : aucun (corrigé avant merge).
**Leçon** : tout identifiant venant d'un fichier externe passe par une allowlist stricte avant toute opération filesystem, avec un test d'attaque explicite.
**Règle instaurée** : la revue Sentinel exécute un PoC pour chaque AC-SEC de type filesystem.

### [2026-09-09] [vault] ARCH-MISTAKE — `apiKeyRef` d'un profil importé lisait n'importe quelle clé du SecretStorage
**Ce qui s'est passé** : `Pipeline.ttsFor`/`narratorFor` passaient `profile.tts.apiKeyRef` tel quel à `context.secrets.get()`. Un profil importé pouvait donc nommer `llmVoice.apiKey.openai` tout en déclarant son propre `baseUrl` distant : la clé de l'utilisateur partait en `Bearer` chez l'attaquant. Trouvé en audit S6.1, jamais exploité.
**Cause racine** : AC-SEC-05 (« valider le profil importé ») a été lu comme « valider les types », pas comme « valider les *références* ». Une chaîne validée par le schéma restait une capacité.
**Impact** : aucun (corrigé avant la 0.1).
**Leçon** : un champ de profil qui *désigne* une ressource (clé, chemin, URL) est une capacité, pas une donnée. Valider son format ne suffit pas — il faut vérifier que le porteur y a droit.
**Règle instaurée** : toute référence portée par un fichier importable est liée à l'identité qui l'utilise (`apiKeyRef === apiKeySecretKey(providerId)`), et l'audit vérifie chaque champ « qui pointe vers quelque chose ».

### [2026-09-09] [vault] WRONG-ASSUMPTION — `EgressGuard` résolvait le DNS puis laissait `fetch` le re-résoudre
**Ce qui s'est passé** : ADR-010 annonce « résolution DNS avant connexion (anti rebinding — on ne fait confiance qu'à l'IP résolue) ». Le code résolvait bien, validait bien… puis passait le **nom** à `fetch`, qui refaisait sa propre résolution. Deux résolutions = la fenêtre TOCTOU que la garde prétendait fermer.
**Cause racine** : la vérification et la connexion étaient écrites comme deux étapes indépendantes ; les tests unitaires validaient `assertAllowed` seul, jamais le couple.
**Impact** : aucun (corrigé avant la 0.1).
**Leçon** : une vérification qui ne contraint pas l'action qu'elle autorise n'est pas un contrôle. Le test doit observer l'**effet** (quelle adresse est réellement composée), pas la décision.
**Règle instaurée** : `guardedFetch` compose l'URL avec l'adresse validée ; le test injecte un résolveur qui change de réponse au 2e appel et assert que le 2e appel n'a jamais lieu.

### [2026-09-09] [vault] PROCESS-SKIP — une négation dans `.vscodeignore` a failli publier 130 fichiers de VS Code
**Ce qui s'est passé** : en réécrivant `.vscodeignore`, l'ajout de `!**/*.d.ts` (censé préserver d'éventuelles définitions livrées) a ré-inclus tous les `.d.ts` du VS Code téléchargé dans `.vscode-test/`. Détecté par `scripts/check-vsix.mjs` écrit dix minutes plus tôt, pas à la relecture.
**Cause racine** : `.vscodeignore` est une liste *deny* dans un monde *allow-by-default* ; une négation y ouvre un trou global, invisible tant que le dossier concerné n'existe pas.
**Impact** : aucun (jamais publié).
**Leçon** : ne jamais raisonner sur le contenu d'un paquet à partir du fichier d'exclusion — le vérifier sur la liste réelle, et sur une arborescence *après* un run de tests, pas sur un checkout propre.
**Règle instaurée** : `npm run check:vsix` dans la checklist pre-push, et un test unitaire interdit toute ligne `!` dans `.vscodeignore`.

### [2026-09-09] [equipe] WRONG-ASSUMPTION — 17 critères d'acceptation verts, produit inutilisable à l'installation
**Ce qui s'est passé** : la 0.1.0 satisfaisait AC-01..17 et 751 tests, mais le premier utilisateur n'a obtenu qu'une erreur « Chatterbox n'est pas installé », une page d'extension vide et une commande Play sans effet.
**Cause racine** : tous les tests, y compris les E2E, partaient d'une machine où les serveurs tournaient déjà. Le cahier des charges décrivait le pipeline, pas la première minute d'utilisation.
**Impact** : une release publique inutilisable pour un nouvel utilisateur, corrigée en 0.1.1.
**Leçon** : des critères d'acceptation complets ne valent pas un parcours de première utilisation. Le chemin par défaut doit fonctionner sans dépendance externe.
**Règle instaurée** : chaque release exige un test sur profil neuf, sans service tiers, et une commande d'installation guidée pour toute dépendance externe.

### [2026-09-12] [equipe] WRONG-ASSUMPTION — Aucun test ne partait d'une configuration héritée
**Ce qui s'est passé** : au premier test manuel de la version 0.2, l'utilisateur a choisi une voix puis obtenu « Aucune voix configurée ». Son `profiles.json`, écrit par une version antérieure, épinglait tous les profils sur un Chatterbox arrêté, et rien ne migrait ce fichier.
**Cause racine** : les 934 tests automatisés créaient toujours un état neuf. Aucun ne partait d'une configuration existante issue d'une version précédente.
**Impact** : bug bloquant trouvé en cinq minutes par un humain, invisible pour toute la suite de tests.
**Leçon** : un utilisateur qui met à jour n'est pas un utilisateur neuf. Le chemin de mise à jour est un cas de test à part entière.
**Règle instaurée** : toute évolution d'un format de configuration exige une fixture issue de la version précédente et un test de migration idempotent.
