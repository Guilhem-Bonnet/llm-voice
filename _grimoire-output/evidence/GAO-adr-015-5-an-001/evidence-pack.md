# Evidence Pack — GAO-adr-015-5-an-001 (ADR-015 étape 5)

## Partie 5a — analyste, metteur en scène, anticipation, cache, repli (faux LLM)

### Livrables (`vscode-extension/`)

- `src/direction/director/llm.ts` : interface `DirectionLlm` (`analyze`, `direct`, `model`, `promptVersion`), `DirectionLlmError`, raisons de dégradation (`DirectionDegradedReason` : celles du narrateur + `egress-denied`, `late`, `gpu-yield`, `resend-budget-exhausted`), `classifyLlmFailure`, `callWithDeadline` (échéance indépendante de la coopération du client).
- `src/direction/director/FakeDirectionLlm.ts` : réponses scriptées, latence et pannes injectables (dont `hang`), journal des appels, passage optionnel par un `EgressGuardHandle`.
- `src/direction/director/Analyst.ts` : une fois par document, analyse et distribution initiale écrites via `BibleStore.appendModelEvent(…, "analyst", …)` sur un `DocumentScope`, chapitrage au-delà du budget, jamais de rejet.
- `src/direction/director/StageDirector.ts` : une fenêtre, passe par `PartitionController.run` (≤ 2 renvois puis partition neutre), faits proposés appliqués seulement si la fenêtre est acceptée (origine `director`, portée document).
- `src/direction/director/PartitionCache.ts` : clé par fenêtre, empreinte de bible (`cacheBibleStamp`), fichiers `partitions/<sha256>.json` 0600/0700, tmp+rename, LRU par taille, mode mémoire.
- `src/direction/director/gpuYield.ts` : sonde `$XDG_RUNTIME_DIR/gpu-yield/active` injectable, synchrone, sans attente.
- `src/direction/director/DirectionPipeline.ts` : sessions, anticipation N segments, une fenêtre à la fois, budgets d'attente, repli `late` / `gpu-yield` / panne, disjoncteur, trace sans contenu.
- Tests : `test/unit/direction/director/{llm,gpuYield,static,analyst,stageDirector,cache,pipeline}.test.ts` + `support.ts`.
- Non modifiés : `src/core/direction.ts`, `src/direction/{bible,controller,translator}/`, `src/narrator/`, `src/net/`.

### Commandes exécutées (sortie réelle)

| Commande | Résultat |
|---|---|
| `npm run test:unit` avant (début de tâche) | 97 fichiers, 1 662 tests verts |
| `npm run test:unit` après | 104 fichiers, 1 775 tests verts (+7 fichiers, +113 tests) |
| dossier `direction/director` seul, 3 passages consécutifs | 113 verts à chaque passage (pas de test instable observé) |
| `npm run typecheck` | sans erreur |
| `npm run lint` | `ESLint: No issues found` |
| Mutations manuelles (production modifiée puis restaurée, retest vert 113/113) | 5 mutants tués : mode jeu ignoré (4 échecs), écriture du cache désactivée (5), refus EgressGuard sans suspension (4), faits d'une réponse rejetée appliqués (14), empreinte de bible incluant les faits du metteur en scène (3) |
| `grimoire task context GAO-adr-015-5-an-001` | context-bundle écrit |
| `grimoire standard decision trace --task-id GAO-adr-015-5-an-001` | decision-trace écrit |

Aucun LLM réel, aucun GPU, aucune requête réseau : `FakeDirectionLlm` seul ; `fetch` de l'`EgressGuard` remplacé par un enregistreur ; mode jeu simulé par un dossier temporaire.

### Couverture des tests de l'ADR

- Test 8 (même chemin) : trois fixtures (roman, documentation, réponse d'IA), séquence d'appels identique `analyze, direct`, même partition acceptée ; test statique : aucune comparaison sur le genre dans tout `src/direction/`.
- Test 10 (mode dégradé) : modèle absent, en retard, qui ne répond jamais, JSON invalide, `EgressDeniedError` → consignes neutres identiques à `neutralPartitionForSource`, lecture non bloquée (durées mesurées dans les tests), disjoncteur, annulation.
- Test 12 (local-first) : lecture complète avec le garde en `local` → toutes les requêtes vers 127.0.0.1 et seulement elles ; adresse publique, hôte distant nommé, rebinding, schéma `file:` → zéro requête émise ; chaîne sentinelle (texte, note de jeu, trait) absente de la trace, des journaux du garde et des événements du store.
- Test 14 (mode jeu) : drapeau présent → zéro appel LLM, neutre immédiat malgré 5 s de latence simulée ; partition en cache jouée ; drapeau apparaissant en cours d'anticipation → plus d'appel ; drapeau levé → reprise à la fenêtre suivante ; aucune attente.
- §8 cache et anticipation : N segments d'avance, une fenêtre à la fois ; relecture = zéro appel malgré les faits ajoutés par le metteur en scène ; modification d'un paragraphe = seules les fenêtres touchées (elle-même et le voisin dont le contexte l'inclut) ; édition utilisateur d'un fait = tout recalculé ; jamais de repli neutre en cache ; document non persisté = mémoire seulement.
- Test 9 côté 5a : aucune écriture LLM hors portée document (aucun journal série ou utilisateur créé), faits interdits (`setAnalysis`, événements utilisateur, `assignVoice`) ignorés.
- Test « zéro autoplay » (ADR n° 11) côté 5a : test statique, aucune référence au player ni à `CoreClient` dans `src/direction/director/`.

### Écarts avec l'ADR-015

1. **Clé de cache** : l'ADR met la « révision de la bible effective » dans la clé. Les faits que le metteur en scène ajoute en lisant font monter cette révision : relire un document ne toucherait jamais son propre cache. La clé utilise donc `cacheBibleStamp` (analyse, faits non `director`, affectations de voix) ; les rôles, faits et états créés par le metteur en scène en sont exclus. Une édition utilisateur ou une nouvelle analyse invalide bien. Limite connue : renommer par action utilisateur un rôle qui ne contient que des faits du metteur en scène n'invalide pas.
2. **Clé de cache** : ajout de l'identifiant du document et du drapeau `faithful` (plus strict que l'ADR : deux documents identiques ne partagent pas de partition).
3. **`setAnalysis` refusé au metteur en scène** (l'ADR le permet à l'analyste et au metteur en scène) : l'analyse est le contexte de toutes les fenêtres ; la modifier en cours de lecture changerait la clé des fenêtres déjà dirigées.
4. **Budget de premier son** : l'ADR ne donne pas de valeur (« plusieurs secondes, non mesuré »). Choix : 10 s (`DEFAULT_FIRST_SOUND_BUDGET_MS`), à fixer par les mesures. Le budget établi reste 1,5 s. « Régime établi » = toute demande après la première de la session.
5. **Disjoncteur** (absent de l'ADR) : refus d'`EgressGuard` = direction suspendue pour la session ; 3 fenêtres neutres de suite pour une raison de modèle = idem. Seuil 3 non mesuré.
6. **Une fenêtre en retard n'est attendue qu'une fois** : les segments suivants de la même fenêtre passent en neutre sans attente.
7. **Pas de `DirectionProvider`** dans `src/core/direction.ts` (fichier en lecture seule pour cette partie) : l'interface est `DirectionLlm`, locale à `src/direction/director/`. Elle renvoie du JSON déjà analysé mais non validé ; c'est l'analyste et le contrôleur qui valident.
8. Une consigne couvrant plusieurs segments est remise avec son premier segment ; un segment déjà lu en neutre (retard) dont la consigne arrive ensuite est lu en neutre.

### Non fait en 5a (renvoyé à 5b ou plus tard, à ne pas compter comme couvert)

- **Client Ollama réel** (`OllamaDirectionLlm`) et **prompts versionnés** : non écrits. Le test 12 prouve le comportement du pipeline et du garde avec un faux qui passe par `EgressGuard`, pas celui d'un vrai client HTTP.
- Branchement dans `Pipeline.ts` / `AudioQueue`, badge « mode jeu », choix du moteur CPU (Test 14 : « zéro synthèse par un moteur `usesGpu` », « lecture démarrée sur le moteur CPU ») : non couverts, il n'y a pas de TTS dans ce périmètre.
- Choix de voix (`casting`, `DecisionProvider`, ADR-013) et « Préparer la lecture » (carte 7) : non faits ; `DirectionSession.idle()` en est le point d'appui.
- Latences p50/p95 et bilan de débit : non mesurés (aucun LLM réel autorisé dans cette partie). Valeurs K=4, W=6, L=4, N=8, 1,5 s, 10 s, seuil 3 : proposées, non mesurées.
- Un appel LLM déjà en vol quand le drapeau `gpu-yield` apparaît n'est pas interrompu (seuls les nouveaux appels sont refusés) ; à décider avec la mesure.
- Numérotation : les « tests 8, 10, 11, 12, 14 » du brief ne suivent pas celle de l'ADR (11 = zéro autoplay, 14 = mode jeu) ; ils sont couverts selon le sens décrit dans le brief et selon l'ADR (voir ci-dessus).

## Partie 5b — client Ollama, prompts versionnés, mesure réelle (qwen2.5:7b)

### Livrables (`vscode-extension/`)

- `src/direction/director/OllamaDirectionLlm.ts` : `DirectionLlm` sur `EgressGuardHandle` (jamais de `fetch` global), `POST /api/chat`, `stream:false`, `format` = JSON Schema, modèle par défaut `qwen2.5:7b`, `keep_alive` `"10m"`, `num_ctx` 8192 explicite, température 0,2, délai 60 s ; rejette en `DirectionLlmError` (HTTP, injoignable, non-JSON, sans contenu, timeout, annulation) ou en `EgressDeniedError` (passée telle quelle) ; rapport par appel (`onCall`) sans aucun texte : durées, jetons, `totalMs`, réponse coupée, contexte saturé. Les `traits` de l'analyste voyagent en paires `{key,value}` (plus sûr pour un décodage contraint) et sont repliés en enregistrement.
- `src/direction/director/prompts/{analyst,director,render,schemas,index}.ts` : prompts versionnés (`analyst-1.director-2`, `DIRECTION_PROMPT_VERSION` = `promptVersion` = clé de cache), schémas de sortie, règles de fidélité reprises mot pour mot de `narrator-eval/styles-v2.json` (nombres avec unité, versions, fichiers, commandes, identifiants, noms propres, négations, aucun ajout). Aucune règle de style ni de genre. Aucune voix n'est jamais montrée au modèle.
- `test/unit/direction/director/ollama.test.ts` (33 tests) ; `static.test.ts` mis à jour (nouveau module, second utilisateur de `EgressGuard`).
- `scripts/direction-eval/run-direction-eval.mjs` + `texts.json` (trois textes originaux, sans donnée personnelle).
- Non modifiés : `src/core/direction.ts`, `src/direction/{bible,controller,translator}/`, `src/narrator/`, `src/net/`, `Pipeline.ts`.

### Commandes exécutées (sortie réelle)

| Commande | Résultat |
|---|---|
| `npm run test:unit` avant (début de 5b) | 104 fichiers, 1 775 verts |
| `npm run test:unit` après | 105 fichiers, 1 809 verts (+1 fichier, +34 tests : 33 client, 1 statique) |
| `npm run typecheck` / `npm run lint` | sans erreur (un premier lint a échoué sur un accent grave dans le script, corrigé) |
| Mutants (production modifiée puis restaurée, `cmp` identique) | « refus du garde traité comme panne ordinaire » : 6 tests échouent ; « `keep_alive` retiré de la requête » : 2 échouent |
| `node scripts/direction-eval/run-direction-eval.mjs --repeat 2 --label baseline-qwen2.5-7b` | rapport complet ; drapeau `gpu-yield` absent juste avant (vérifié) ; 28 appels, 0 échec |
| `grimoire task context` / `grimoire standard decision trace --task-id GAO-adr-015-5-an-001` | voir fin de section |

Tests du client : format de requête (modèle, `stream`, `keep_alive`, `format`, `options`), contenu du message (fenêtre, contexte, bible, consignes déjà données, renvoi), aucune voix envoyée, parse (JSON, bloc Markdown, valeurs hors bornes laissées au contrôleur), pliage des traits, bout en bout avec `Analyst` et `StageDirector`, erreurs (500, serveur absent, non-JSON, sans contenu, timeout, annulation avant et pendant), pas de requête non loopback (IP publique, hôte distant, `file:`, `localhost.evil`, rebinding, redirection croisée : zéro requête, `egress-denied`), défaut = `127.0.0.1:11434` seul, dérive schéma de cue / contrat `partition.schema.json`, faits autorisés = `DIRECTOR_FACT_TYPES`, phrases de fidélité identiques à `styles-v2.json`.

### Mesure réelle (rapport : `direction-eval/baseline-qwen2.5-7b.{json,md}`)

Conditions : `qwen2.5:7b` local (Q4_K_M), K=4 W=6 L=4 N=8, budgets 1,5 s / 10 s, lecture estimée 15 caractères/s, **2 répétitions par texte** (document neuf à chaque fois, modèle chaud), TTS absent (le GPU n'est pas partagé). Échantillon faible : le p95 de 6 mesures est quasiment le maximum.

| Texte | Fenêtres dirigées | Repli neutre | Fenêtres avec renvoi | 1re réponse acceptée (normal / faithful) | « À conserver » | Premier dirigé p50 / p95 | Direction / lecture (seg/s) |
|---|---|---|---|---|---|---|---|
| conte (10 seg.) | 5/6 | 1/6 (`resend-budget-exhausted`) | 2/6 | 4/6 / 2/6 | 5/5 | 26,9 s / 28,9 s | 0,085 / 0,070 |
| doc technique (8 seg.) | 6/6 | 0 | 1/6 | 5/6 / 5/6 | 12/12 | 19,2 s / 22,0 s | 0,241 / 0,082 |
| réponse d'IA (6 seg.) | 4/4 | 0 | 1/4 | 3/4 / 3/4 | 10/10 | 19,6 s / 22,1 s | 0,216 / 0,071 |
| Total | 15/16 (94 %) | 1/16 (6 %) | 4/16 (25 %) | 12/16 (75 %) / 10/16 | 27/27 | 22,3 s / 28,0 s (min 16,0 ; max 29,1) | 0,216 / 0,071 (×3) |

- Appels : analyse p50 4,1 s (p95 7,8 s) ; direction d'une fenêtre p50 12,7 s (p95 21,9 s) ; prompt p50 1 552 jetons (max 2 015, jamais saturé sur 8 192) ; 402 jetons générés p50 à 93 jetons/s ; aucune réponse coupée. Le temps serveur (`total_duration`, p50 12,7 s) explique tout le temps client ; l'évaluation du prompt ne pèse que 0,23 s, la génération de 402 jetons à 93 jetons/s devrait durer ~4,3 s : **l'écart (~8 s) n'est pas expliqué** (hypothèses non testées : décodage contraint par grammaire, partage du GPU).
- Première réponse refusée : `uncovered-source` 3, `number-lost` 1, `negation-lost` 1 (le contrôleur fait son travail : aucune dérive de nombre ou de commande ne passe).
- Relecture : 0 appel sur 3 relectures, 8/8 fenêtres servies par le cache.
- Avant la correction du prompt (v1, un seul passage du conte, non comparable statistiquement) : 0/3 premières réponses acceptées, 2 fenêtres sur 3 en repli, le modèle oubliant le dernier segment. La v2 nomme les segments à couvrir dans la fenêtre.

### Constats sur la qualité des partitions

- Conte : analyse plausible (« Conte pour enfants », personnages `maelys` et `renard` trouvés), locuteurs distribués (narrator 9, maelys 4, renard 3) mais **une seule consigne par segment** : un segment mêlant récit et réplique est lu d'un seul locuteur (la formule « dit-il » part avec la voix du personnage). Émotions : 5 libellés, dominant « dubitative » (56 %), intensité quasi constante (0,73 ± 0,08), **tempo > 1,1 dans 8 des 9 consignes qui en portent un** : biais du modèle vers l'accélération, non corrigé. Un libellé en anglais apparaît (« joyful and relieved »). Verdict monotonie : non, mais la variation est faible.
- Documentation et réponse d'IA : un seul locuteur (attendu), **aucune émotion, aucun tempo, aucune pause** : partition « monotone » selon les critères du script. C'est peut-être légitime pour un texte neutre (aucune règle de style n'est imposée) mais cela signifie que la direction n'apporte rien sur ces deux genres avec ce modèle et ces prompts ; à trancher par écoute (carte 6), pas par le script.
- Contenu fidèle : 27/27 éléments à conserver (nombres, commandes, versions, négations) retrouvés dans les segments dirigés.

### Valeurs proposées confrontées à la mesure

| Valeur | Constat | Suite |
|---|---|---|
| Budget de premier son 10 s | **Non tenu** : premier segment dirigé 16,0 à 29,1 s (analyse ~4 s + première fenêtre ~12 s, jusqu'à 25 s avec renvois). Toute lecture mesurée aurait démarré en neutre (simulation) | choisir : budget ≥ 30 s, première fenêtre plus courte (K=1 ou 2), ou démarrage neutre assumé ; décision à prendre avec 5c/6 |
| Budget établi 1,5 s, N=8, K=4 | Tient en régime établi : direction 3 fois plus rapide que la lecture ; la simulation donne les mêmes retards pour N ∈ {4, 8, 12} et budget ∈ {1,5 ; 3 ; 5 s} (le retard se limite à la première fenêtre, ~30 % des segments d'un texte de 6 à 10 segments) | garder ; à revalider avec le TTS sur le même GPU (non mesuré) |
| W=6, L=4 | Prompt max 2 015 jetons sur 8 192 : marge ×4 ; l'effet de W et L sur la qualité n'est pas mesuré | non tranché |
| `num_ctx` 8192 | jamais saturé | garder |
| Disjoncteur seuil 3 | jamais déclenché (0 échec d'appel) ; 1 repli sur 16 fenêtres | non vérifié |
| Renvois ≤ 2 | 4/16 fenêtres renvoyées, 1 repli après 2 renvois ; 1,35 appel par fenêtre | garder |

Limite du script : la simulation plafonne l'attente du premier son au budget (10 s) ; la « part de lectures où le premier segment dépasse 10 s : 0 » du rapport est donc trompeuse, la vraie latence est la ligne « Premier segment dirigé ». Le « chargement à froid » (153 ms) n'est pas un vrai froid (modèle déjà résident) ; un froid isolé de 6,1 s a été observé lors d'un essai préliminaire.

### Écarts avec l'ADR-015 et le brief

1. **Numéro de version « dans la partition »** : non fait tel quel. Le contrat `partition.schema.json` est strict (`additionalProperties: false`) et `src/core/direction.ts` est intouchable ici. La version des prompts est dans la clé de cache (`promptVersion`), dans le rapport de mesure et exposée par `OllamaDirectionLlm.promptVersion`.
2. Version des prompts passée à `director-2` en cours de partie (liste des segments à couvrir) ; toutes les mesures du tableau sont en v2.
3. `num_ctx` explicite (8192) : Ollama abandonne sinon silencieusement le début d'un prompt trop long.
4. Tests du client en un fichier unique `ollama.test.ts`, avec le serveur simulé existant (réponse constante) plus un garde à `fetch` enregistreur.

### Diagnostic de latence (`direction-eval/latency-diagnosis.md`, 2026-09-29)

- Décomposition (médiane) : appel du metteur en scène 13,1 s = 0,08 s de chargement + 0,18 s de préremplissage + 4,5 s de `eval_duration` + 8,3 s hors `eval_duration`. Coût réel 30 ms par jeton généré (10,7 ms comptés), le « 93 jetons/s » de la baseline est trompeur (environ 33 jetons/s réels). Cause : la contrainte `format` (grammaire JSON Schema) ; `format: "json"` seul ne change rien (32,7 ms/jeton).
- Remèdes mesurés (1re fenêtre du conte, 3 répétitions) : sans `format` 12 ms/jeton (22,9 s vers 11,8 s), mais valide 2/3 ; fenêtre de 2 segments avec format 7,4 s (-68 %), valide 3/3 ; `num_ctx` réduit et qwen2.5:3b sans effet notable ; fusion analyste + fenêtre 15,3 s (équivalent à analyste + fenêtre de 2 : 14,0 s) ; à froid le chargement coûte 1,7 s (préchargement 1,85 s) ; prompt allégé sans format 4,7 s mais partitions sans émotion, tempo ni pause (rejeté).
- Stratégie recommandée : premier segment en lecture neutre à t = 0, préchargement à l'ouverture, analyse + fenêtre de 2 segments prête à environ 14 s sur le conte (10 s avec analyste sans format), soit avant la fin de la lecture neutre des segments 1 et 2 (18,5 s) : premier segment dirigé à environ 18,5 s sans trou, contre 22 s p50 (27 s sur le conte). Piste suivante : retrait de la grammaire avec analyseur tolérant, à mesurer dans le pipeline.

### Non fait / non vérifié

- Branchement dans `Pipeline.ts` (5c), badge mode jeu, moteur CPU, choix de voix.
- Aucune écoute des partitions : la qualité « sonore » n'est pas jugée, seulement structurelle.
- Un seul modèle mesuré (`qwen2.5:7b`) ; pas de `qwen2.5:3b` ni `gpt-oss:20b` (installé).
- Cause des ~8 s de génération inexpliqués ; TTS et LLM sur le même GPU ; coût du renvoi quand le drapeau `gpu-yield` apparaît en plein appel.

## Partie 5b-bis — démarrage neutre puis relais, analyste sans grammaire, prompts director-3 (2026-09-29)

### Livrables (`vscode-extension/`)

- `src/direction/director/DirectionPipeline.ts` : `leadSegments` (défaut 2 : lus en neutre sans attente, jamais dirigés), `firstWindowSize` (défaut 2), fenêtres suivantes à `windowSize` ; pendant le démarrage (avant le premier règlement d'une fenêtre) un segment dont la fenêtre n'est pas prête attend au plus `startupGraceMs` (150 ms, le temps qu'une partition en cache revienne du disque) puis est lu en neutre ; relais transparent dès que la fenêtre existe (une fenêtre déjà « late » reste servie quand elle est résolue) ; préchargement `llm.warmup` à `open()` (jamais attendu, jamais en mode jeu, refus du garde = suspension). `llm.ts`/`FakeDirectionLlm.ts` : `warmup?` optionnel.
- `OllamaDirectionLlm.ts` : analyste **sans `format`** (`analystFormat: true` le rétablit), lecture tolérante (`tolerantJson.ts`, premier objet JSON, accolades dans les chaînes, fences, prose autour), validation Zod (`RawAnalysisSchema` + présence de `analysis` ou `characters`), **un seul renvoi** avec la raison puis `invalid-structured-output` (l'analyste se replie) ; metteur en scène toujours avec `format` ; `warmup()` = chat vide avec le même `num_ctx` et `keep_alive` (pas de rechargement), rapporté `kind: "warmup"`.
- Prompts : `analyst-2` (forme de la réponse, JSON seul), `director-3` (partition expressive quel que soit le genre ; documentation, réponse d'assistant, récit : consignes du brief, tempo « pas systématiquement supérieur à 1 »). Aucune valeur de style dans le code ; seuls les nombres des bornes figurent dans le prompt (test). `DIRECTION_PROMPT_VERSION` = `analyst-2.director-3`, dans la clé de cache.
- Tests : `startup.test.ts` (15), `tolerantJson.test.ts` (8), `ollama.test.ts` (+13 : analyse sans grammaire, renvoi unique, préchargement, prompt director-3, nombres du prompt), `static.test.ts`, `support.ts` (disposition historique par défaut du banc : `leadSegments: 0`, `warmup: false`), mock Ollama (`chatContentSequence`). Script `run-direction-eval.mjs` : lecture en temps réel, budgets de production, deuxième passe sur le cache pour juger les partitions, indicateurs de démarrage et de séparation récit/réplique.

### Commandes exécutées

| Commande | Résultat |
|---|---|
| `npm run test:unit` avant (fin de 5b) / après | 105 fichiers, 1 809 verts / 107 fichiers, 1 845 verts (+2 fichiers, +36 tests) |
| `npm run typecheck`, `npm run lint` | sans erreur (un premier typecheck a échoué sur `undefined` avec `exactOptionalPropertyTypes` dans un test, corrigé) |
| Mutants (production modifiée puis restaurée, `cmp` identique) | attente de démarrage retirée : 2 tests échouent ; renvoi de l'analyste retiré : 3 ; préchargement en mode jeu : 1 ; `format` du metteur en scène retiré : 2 |
| `node scripts/direction-eval/run-direction-eval.mjs --model qwen2.5:7b --repeat 2 --label director-3-qwen2.5-7b` | drapeau `gpu-yield` absent juste avant (vérifié) ; 34 appels, 1 échec ; rapport `direction-eval/director-3-qwen2.5-7b.{json,md}` |

Première mesure archivée : `direction-eval/director-3-lead1-qwen2.5-7b.{json,md}` (segment de tête = 1, attente de démarrage nulle). Elle a révélé un défaut, corrigé avant la mesure finale : avec une attente nulle, une partition déjà en cache n'avait pas le temps de revenir du disque et une relecture était lue en neutre (section qualité vide, 0 cue) ; premier segment dirigé 48,7 à 71,0 s. Seules ses valeurs de latence sont citées ci-dessous.

### Avant / après (qwen2.5:7b, 2 répétitions par texte, modèle chaud, lecture en temps réel à 15 caractères/s pour « après »)

| Mesure | Baseline (director-2) | 5b-bis (director-3, tête = 2) |
|---|---|---|
| Premier son | après l'attente du premier segment (budget 10 s dépassé) | 0,2 à 0,7 ms (segment 1 neutre) |
| Premier segment dirigé p50 (min-max) | 22,3 s (16,0-29,1) | **34,4 s (32,2-41,2)** : plus lent |
| Direction prête (analyse + 1re fenêtre de 2), p50 par texte | 16 à 29 s (fenêtre de 4) | conte 33,1 ; doc 19,9 ; IA 27,2 s |
| Appel d'analyse p50 | 4,1 s | 2,0 s (-51 %) |
| Fenêtres dirigées / repli | 15/16 (94 %) / 1 | 14/16 (88 %) / 2 (`resend-budget-exhausted`) |
| Fenêtres renvoyées ; 1re réponse acceptée | 25 % ; 12/16 | 56 % (9/16) ; 7/16 |
| Analyses valides (sans `format`) | 6/6 avec format | 6/6 |
| « À conserver » retrouvés | 27/27 | 22/22 |
| Doc / IA : émotion, tempo, pause | 0 %, 0 %, 0-17 % | 100 %, 100 %, 100 % (doc : 4 libellés ; IA : 3, dont « neutral » en anglais) |
| Doc / IA : intensité | — | 0,52 ± 0,06 / 0,62 ± 0,13 ; insistance 33 % / 83 % |
| Conte : libellés (dominant) | 5 (56 %) | 10 (25 %) |
| Conte : intensité | 0,73 ± 0,08 | 0,74 ± 0,12 |
| Conte : tempo > 1,1 parmi les cues avec tempo | 8/9 (89 %) | 25 % (5/20) ; 15 cues entre 0,9 et 1,1 |
| Conte : cues par segment ; segments à plusieurs locuteurs | 1,0 ; 0 | 1,25 ; 12,5 % |

### Constats

- L'expressivité est acquise : plus aucune partition plate, tempo du conte non biaisé. La séparation récit/réplique reste faible (12,5 % des segments). Une majorité de tempos restent entre 0,9 et 1,1 : variation modeste, à juger à l'écoute (carte 6).
- L'objectif de latence n'est **pas atteint** : le premier segment dirigé arrive plus tard qu'en baseline (34,4 contre 22,3 s p50), même si le premier son est immédiat. Cause mesurée : la direction demandée est plus riche (325 jetons p50 par appel, 1 916 de prompt) et la fenêtre de 2 met 20 à 33 s à être prête (14 s prévus par le diagnostic avec le prompt d'origine) ; la lecture neutre de 2 segments couvre environ 18 s. Avec 1 segment de tête, 48,7 à 71,0 s (la fenêtre suivante de 4, environ 30 s, arrive trop tard). Segments lus en neutre : 4 à 7 sur 9 ou 10 par lecture.
- La validité recule avec le prompt long : 1re réponse acceptée 44 % (75 % en baseline), 2 replis sur 16 (`uncovered-source` domine : 9 des refus). Aucune dérive de nombre ou de négation.
- Relecture : 1 appel modèle sur 3 relectures (la fenêtre en repli de la lecture 1 n'est pas en cache, attendu).

### Écarts et non vérifié

1. ADR-015 §2 « aucune règle de style dans les prompts » : levé par la consigne de la carte pour director-3 (les valeurs viennent de la consigne au modèle, le code ne branche sur aucun genre, la garde statique passe). Le test « aucun genre dans les prompts » ne vaut plus que pour l'analyste.
2. Tête de 2 segments (défaut) choisie sur la mesure ci-dessus, pas sur la recommandation du diagnostic (1 segment) ; elle reste insuffisante. Pistes non essayées : tête de 3, fenêtres de 2 segments au démarrage, fenêtre suivante plus courte, retrait de `format` du metteur en scène avec analyseur tolérant (non prouvé), prompt plus court.
3. Non mesuré : préchargement à froid (le banc charge le modèle avant), TTS et LLM sur le même GPU, écoute, autres modèles, plus de 2 répétitions.
4. Modules non modifiés : `src/core/direction.ts`, bible, controller, translator, `Pipeline.ts`. Carte non déplacée, rien commité.
