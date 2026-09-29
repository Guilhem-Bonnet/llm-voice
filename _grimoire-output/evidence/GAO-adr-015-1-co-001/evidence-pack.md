# Agentic Evidence Pack

- Task id: GAO-adr-015-1-co-001
- Profile: controlled
- Owner: backend-engineer (Stack), mode non-interactif

## Livrables

| Fichier | Rôle |
|---|---|
| `contracts/direction-v1/partition.schema.json`, `bible.schema.json` | contrats JSON Schema 2020-12 (ADR-015 §3, §4, §7) |
| `contracts/direction-v1/README.md` | organisation, règles sémantiques, ajout d'un exemple |
| `contracts/direction-v1/examples/{valid,invalid}/*.json`, `examples/manifest.json` | 14 valides, 40 invalides |
| `vscode-extension/src/core/direction.ts` (+ export dans `src/core/index.ts`) | types, Zod, `boundPartition`, `checkPartition`/`checkBible`, cue neutre, conversions |
| `vscode-extension/test/unit/contracts/direction-v1.contract.test.ts` | ADR-015 test 1 (ajv ET Zod) |
| `vscode-extension/test/unit/core/direction.test.ts` | ADR-015 test 2 (doré) et tests de propriété du ramenage |

## Vérifications exécutées

| Check | Commande | Résultat |
|---|---|---|
| Avant | `npm run test:unit` (avant toute modification) | 1036/1036 |
| Après | `npm run test:unit` | 87 fichiers, 1127/1127 (+91 : 62 contrat, 29 direction) |
| Typecheck | `npm run typecheck` | 0 erreur |
| Lint | `npm run lint` (`--max-warnings=0`) | aucun problème |
| Mutation 1 : `tempo.max` 1.4 -> 1.5 | vitest ciblé | 8 tests en échec |
| Mutation 2 : `model` retiré de `baselineTtsRequest` | vitest ciblé | 2 tests en échec (test doré) |
| Mutation 3 : silence cumulé non appliqué | vitest ciblé | 6 tests en échec |
| Fichier restauré après mutation | `cmp` avec la sauvegarde | identique |

Chiffres 1036 -> 1127, typecheck, lint, 14 valides / 40 invalides : revérifiés par le coordinateur.

## Comment chaque test répond à l'ADR

- **Test 1** : chaque exemple du manifeste passe par ajv (les `.schema.json`) et par Zod, qui doivent
  donner le même verdict. Couche `schema` : rejeté par les deux. Couche `semantic` : structure
  acceptée par les deux, refusée par `checkPartition`/`checkBible`. Chaque `cueId` valide et les
  identifiants `-pre`/`-post` dérivés satisfont le motif `segmentId` de `contracts/core-v1/common.schema.json`.
  Un test lie les constantes de `direction.ts` aux nombres des schémas.
- **Test 2** : `AudioQueue` réel + `FakeTtsProvider` enregistrent les `TtsRequest` d'aujourd'hui pour une
  lecture fidèle et une lecture narrée (vrai `parseNarration` : fusion, reformulation, repli fidèle),
  avec trois liaisons dont un profil Chatterbox complet. La même liste passe par
  `narrationSegmentsToNeutralPartition` puis `partitionToNarrationSegments` : requêtes identiques,
  `NarrationSegment` égaux champ pour champ (sans `metadata`), aucune pause donc aucun silence.
- **Test 3 (propriété)** : 5 graines x 200 sorties brutes aléatoires (valeurs extrêmes, emoji, listes
  longues) : partition bornée valide pour Zod ET ajv, identité des champs d'identification conservée,
  silence cumulé <= 3 000 ms, idempotence, entrée déjà bornée rendue inchangée avec rapport vide.

## Décisions et écarts (à relire)

1. **Bible : `additionalProperties: false` partout**, l'esquisse de l'ADR n'en met que sur la partition.
   Resserrement volontaire (fichier stocké, clé inconnue = corruption ou injection), réversible.
2. **Règle d'écriture dans le schéma** : hors portée `document`, `by` = `user` seulement, attribution
   `casting` interdite, pas d'`analysis`. L'ADR dit « faits LLM » ; l'extension à `casting` et
   `analysis` est mon interprétation.
3. **Dates** : motif RFC 3339 au lieu de `format: date-time` (ajv-formats absent, mode strict).
4. **Longueurs en points de code** des deux côtés (test dédié avec emoji).
5. **Règles hors JSON Schema** (cueId uniques, locuteur dans la bible, id de rôle uniques, voix du
   narrateur non réutilisée) : code partagé, exemples `layer: semantic`.
6. **Non fait, volontairement** (cartes contrôleur/traducteur) : `spokenText` <= 2 x source, traduction
   par capacités d'une consigne dirigée, `DirectionProvider`.
7. La conversion narrateur -> partition lève `DirectionContractError` sur `sourceIds`/`spokenText` vide ;
   l'intégration devra la capturer (un repli ne doit pas lever).
8. `NarrationSegment.id` hors motif Core : `cueId` assaini et rendu unique ; l'id d'origine n'est pas
   restitué au retour (non envoyé au moteur).

## Non vérifié

- Aucun test contre un vrai moteur, un LLM ou le Core (interdit : mode jeu, pas de LLM/GPU).
- Respect des bornes par la grammaire `format` d'Ollama (ADR-015 §3, déjà « non vérifié »).

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | yes | carte `GAO-adr-015-1-co-001`, enveloppe, ce pack | — |
| Quality | yes | 91 nouveaux tests, 3 mutations détectées, typecheck, lint | pas de test sur moteur réel |
| Runtime | yes | commandes réellement exécutées | — |
| Knowledge | yes | README du contrat | — |
| Model/provider | yes | backend-engineer, sonnet ; aucun appel LLM local | — |

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
