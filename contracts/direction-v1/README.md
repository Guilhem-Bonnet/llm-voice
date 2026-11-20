# Direction de lecture v1 (ADR-015)

Contrat de la **partition** (consignes de jeu par segment, indépendantes du
moteur) et de la **bible** (distribution et mémoire des personnages). Source
normative : `docs/adr/ADR-015-reading-direction.md` (§3 partition, §4 bible,
§7 garde-fous, §9 compatibilité).

```
contracts/direction-v1/
  partition.schema.json     # partition validée (bornes de l'ADR-015 §7)
  bible.schema.json         # projection de la bible pour une portée
  examples/valid/*.json     # acceptés
  examples/invalid/*.json   # rejetés (un défaut précis chacun, `reason` dans le manifeste)
  examples/manifest.json    # exemple -> genre de document -> verdict attendu
```

JSON Schema draft 2020-12. Jumeau Zod : `vscode-extension/src/core/direction.ts`.
`vscode-extension/test/unit/contracts/direction-v1.contract.test.ts` rejoue chaque
exemple par **ajv** (ces fichiers) **et** par **Zod**, et exige qu'ils soient
d'accord ; il vérifie aussi que bornes et motifs des deux côtés sont identiques.

## Ce que dit le contrat

- **Partition** : `schemaVersion`, `documentKey` (sha256), `bibleRevision`, `cues[]`.
  Une consigne : `cueId` (même motif que le `segmentId` du Core v1), `sourceIds`,
  `speakerId`, `spokenText`, puis optionnellement émotion, `tempo` (0,7 à 1,4),
  `pauseBeforeMs`/`pauseAfterMs` (0 à 3 000), `emphasis` (5 max), `direction`
  (280 caractères max, jamais synthétisée), `states` (4), `nonverbal` (2).
- **Bible** : une portée (`document`, `series`, `user`), un narrateur (`id` =
  `narrator`), des personnages (jamais l'id `narrator`). **Règle d'écriture
  structurelle** : hors portée `document`, seuls les faits `by: user` sont
  valides ; ni attribution `casting`, ni `analysis`. Un fait proposé par un LLM
  ne peut donc pas atteindre `series` ou `user` (ADR-015 §4).
- La **sortie brute du LLM** n'a pas de schéma JSON : elle est validée par
  `RawDirectionOutputSchema` (Zod, mêmes champs sans bornes) puis ramenée dans les
  bornes par `boundPartition` (une valeur hors borne est **ramenée et comptée**,
  jamais rejetée).

## Ce que JSON Schema ne sait pas dire (vérifié par le code)

`checkPartition` : `cueId` uniques, `speakerId` présent dans la bible.
`checkBible` : `id` de rôle uniques, voix du narrateur jamais attribuée à un
personnage. Le manifeste marque ces cas `layer: "semantic"` : les deux schémas
les acceptent, le code les refuse. Les exemples `pair.*` sont des couples
`{ bible, partition }`.

## Ajouter un exemple

Déposer le fichier sous `examples/valid/` ou `examples/invalid/` et l'inscrire au
manifeste (`kind` : `partition`, `bible` ou `pair` ; `layer` et `reason` pour un
invalide). Un test refuse un fichier absent du manifeste.
