# Agentic Evidence Pack

- Task id: GAO-adr-015-3-bi-001
- Profile: controlled
- Owner: backend-engineer (Stack), mode non-interactif

## Livrables (tous sous `vscode-extension/`)

| Fichier | Rôle |
|---|---|
| `src/direction/bible/events.ts` | 10 événements (Zod strict), origines, bornes du journal, `parseBibleEvent` (un modèle : texte coupé à 200, `locked` retiré ; un utilisateur : refus) |
| `src/direction/bible/reducer.ts` | projection pure : `applyEntry`, `replay`, `authorize` (droits d'écriture), candidats, tombstones |
| `src/direction/bible/journal.ts` | format ligne (`event` / `checkpoint`), `parseJournal` tolérant (jamais d'exception) |
| `src/direction/bible/merge.ts` | bible effective user ⊂ series ⊂ document |
| `src/direction/bible/scopes.ts` | `ScopeRef`, hash de document, slug de série, `shouldPersistDocument` |
| `src/direction/bible/BibleStore.ts` | E/S : journal en ajout seul, 0600/0700, promotion, oubli, compactage, mémoire seule, journal des refus |
| `src/direction/bible/index.ts` | exports |
| `test/unit/direction/bible/{reducer,BibleStore,bible.properties,static}.test.ts`, `helpers.ts` | 109 tests |

## Vérifications exécutées

| Check | Commande | Résultat |
|---|---|---|
| Avant | `npm run test:unit` (début de tâche) | 1127/1127 |
| Après, mes tests | vitest ciblé `test/unit/direction/bible` | 4 fichiers, 109/109 |
| Après, suite complète | `npm run test:unit` | 95 fichiers, 1523/1523 (le reste de l'écart avec 1127 vient des agents parallèles, étapes 2 et 4 ; un échec transitoire de `direction/controller/fidelity.test.ts` vu en cours de route n'est plus présent) |
| Typecheck | `npx tsc -p ./ --noEmit` | 0 erreur |
| Lint | `npm run lint` (`--max-warnings=0`) | aucun problème |
| Mutation 1 : refus « modèle hors portée document » désactivé | vitest ciblé | 19 échecs |
| Mutation 2 : un fait de modèle contradictoire remplace au lieu d'être candidat | vitest ciblé | 2 échecs |
| Mutation 3 : fichiers créés en 0644, chmod retiré | vitest ciblé | 1 échec |
| Mutation 4 : tombstone ignoré par le modèle | vitest ciblé | 6 échecs |
| Mutation 5 : révision non déterministe | vitest ciblé | 8 échecs |
| Fichiers restaurés après mutation | copie de sauvegarde, suite verte ensuite | 109/109 |

## Test 9 de l'ADR, réponse point par point

- **Ajout seul** : propriété (5 graines x 400 événements, modèle + utilisateur + retraits) : après tout événement autre que `userRetract`, aucun chemin (rôle, nom, trait, descripteur, voix, état, analyse) n'a disparu ; projection valide (Zod + `checkBible`) à chaque pas.
- **Fait `user` ou `locked` jamais remplacé par un fait de modèle** : propriété (5 x 400), contenu comparé octet pour octet.
- **Aucun événement de modèle n'atteint `series` ou `user`** : propriété au niveau réducteur (300 événements, l'état est le même objet) et au niveau store (120 événements : tous `refused`, aucun fichier de journal créé) ; un flux de modèle dans le document ne change pas une série ni des préférences remplies par l'utilisateur ; un journal série/préférences trafiqué à la main (événements de modèle plantés, checkpoint de mauvaise portée ou contenant un fait de modèle) est rejoué mais ignoré.
- **Précédence** : test dédié (document `user` bat la série ; fait de modèle du document ne bat pas un fait `user` de la série).
- **« Oublier » supprime les fichiers** : `forget` (une portée, journal + projection) et `forgetAll` (tout, dont le journal des refus et la mémoire).
- **Non persisté sans opt-in** : un document `persist: false` n'écrit aucun fichier (arborescence vide), n'est pas relu après redémarrage ; `shouldPersistDocument` porte la règle (fichier oui ; inbox seulement avec opt-in ou « Conserver » ; sélection et presse-papiers seulement avec « Conserver »).
- **Rejeu déterministe** : le rejeu en direct, depuis le texte du fichier, à travers un checkpoint au milieu, et un second store lisant les fichiers (avant et après compactage) donnent le même état.

## Écarts avec l'ADR et décisions (à relire)

1. **Deux événements ajoutés** aux huit de l'ADR : `setDescriptor` (`voice.descriptor`) et `setAnalysis` (`analysis`), sans lesquels ces emplacements du contrat n'ont pas d'écrivain. `userRetract` a aussi un type `name`, `userEdit` sur `names` est additif.
2. **Oubli** : l'ADR dit « supprimer les fichiers » ; la carte demandait tombstone puis compactage. Les deux sont livrés : `userRetract` pose un tombstone (la valeur reste dans le journal), `compact()` réécrit le journal en un `checkpoint` qui n'a plus la valeur ; `forget`/`forgetAll` suppriment les fichiers. Le tombstone garde la clé (jamais la valeur) après compactage, pour que le modèle ne ramène pas le fait. Une clé de trait est donc un texte dérivé du contenu qui survit au compactage : seul `forget` l'efface.
3. **Préférences de la portée `user`** : l'ADR cite « voix préférée du narrateur, voix interdites, tempo de base », mais le schéma de bible n'a que narrateur et personnages. Ces préférences vivent en traits et voix du narrateur ; « voix interdites » et « tempo de base » n'ont pas de champ typé (manque du contrat, non traité ici, `core/direction.ts` interdit).
4. **Journal des refus** : `bibles/rejections.jsonl` (hors de l'arborescence de l'ADR), sans contenu du document (portée, hash ou slug, origine, type d'événement, code), plafonné (256 Kio, garde 500 lignes), non écrit pour un document en mémoire seule. Un refus n'est jamais ajouté au journal de la portée visée (sinon un document hostile ferait grossir une série).
5. **Candidat** (ADR : « conservé comme candidat signalé par le contrôleur ») : le store le conserve (`state.candidates`, borné à 100) ; le signalement par le contrôleur, la commande pour en accepter un et son abandon restent à faire (étape 4 et interface). `userEdit` sert à accepter.
6. **Limite de confiance** : le store ne peut pas authentifier l'appelant. `appendModelEvent` refuse l'origine `user` et `appendUserEvent`/`promote` fixent l'origine à `user` ; empêcher le code des rôles LLM d'appeler la porte utilisateur est un contrat d'appelant (seules les commandes d'interface l'utilisent).
7. **Bornes ajoutées** (hors ADR) : 200 rôles, 64 traits, 32 états, 16 noms par rôle, journal lisible jusqu'à 16 Mio, ligne jusqu'à 64 Ko ; un fichier trop gros, un lien symbolique ou un répertoire à la place du journal rend la portée illisible (aucune écriture, jamais écrasé).
8. **Couverture** : `vitest.config.ts` (`coverage.include`) ne liste pas encore `src/direction/**` ; hors périmètre de la carte, non modifié.
9. **Non vérifié** : Windows (les tests de droits 0600/0700 sont ignorés sous win32), plusieurs fenêtres VS Code en concurrence réelle (simulé par deux instances de store ; une course entre deux processus entre la lecture de la taille et l'écriture peut donner deux `seq` identiques, sans perte car le rejeu suit l'ordre du fichier), intégration à l'extension (aucun câblage, hors carte).

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
