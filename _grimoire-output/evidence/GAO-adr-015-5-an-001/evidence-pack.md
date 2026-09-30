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
