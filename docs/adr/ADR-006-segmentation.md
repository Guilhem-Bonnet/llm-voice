# ADR-006 — Segmentation du texte source

## Statut

Accepté (2026-09-08).

## Contexte

Le CdC §11-14 impose un pipeline `remark` (`unified` + `remark-parse`) qui
transforme le Markdown en MDAST plutôt que d'envoyer du texte brut au TTS,
et définit l'unité `SourceSegment` (id, `sourceUri`, `sourceRange`, `type`,
`rawText`, `spokenText?`) avec une politique de lecture par type de bloc
(§13). Le CdC §33 fixe la taille de chunk recommandée selon le profil :
1-3 phrases en lecture fidèle, 1 bloc logique par narration.

## Décision

- **Parsing** : `remark-parse` produit le MDAST ; chaque nœud garde sa
  `position` (`{line, column, offset}`, 1-indexed) convertie en
  `sourceRange` `vscode.Range` (0-indexed, donc `-1` sur ligne/colonne).
- **Découpage phrase FR/EN** : essayer d'abord la librairie npm
  `sentence-splitter`. Si elle ne couvre pas les cas nécessaires, fallback
  algorithme maison : protéger `inlineCode`/URLs/blocs `code` par
  placeholders, couper sur `[.!?]+(\s|$)` sauf abréviations connues
  (FR : `M.`, `Mme`, `Dr`, `etc.`, `n°`… ; EN : `e.g.`, `Mr.`…) ou suivi
  d'une minuscule/chiffre, puis fusionner les fragments < ~15 caractères.
- **Taille de chunk par profil** : 1 à 3 phrases en lecture fidèle ; 1 bloc
  logique/paragraphe en narration. Valeur modifiable par provider.
- **Politique par type de bloc** (défaut, configurable par profil) :
  - `code` : `skip` / `read` / `explain` / `summarize` (mode par défaut à
    trancher au niveau profil, jamais lu caractère par caractère).
  - `link` : `labelOnly` (lit le texte du lien, jamais l'URL).
  - `image` : `altText`.
  - `table` : `summarize`.
  - `frontmatter` : `skip`.
- **Mapping paragraphe → phrase** : le `sourceRange` par phrase est
  approximé par recherche du texte de la phrase dans le texte source du
  paragraphe (offset relatif à `position.start`), avec fallback sur le
  range complet du paragraphe si la recherche échoue.
- `code`, `table`, `list` ne sont pas sous-segmentés en phrases : un seul
  `SourceSegment` par nœud, `spokenText` déterminé par la politique de bloc.

## Conséquences

- Le highlight reste fidèle à la position source même après édition (D6),
  car chaque segment porte son `sourceRange`.
- Le contrat `SourceSegment` est stable dès 0.1 et réutilisable par tout
  parser futur (autre langage de balisage) sans changer le player.
- Risque résiduel : la recherche `indexOf` pour le sous-range de phrase
  peut échouer sur des guillemets typographiques ou un texte modifié entre
  temps ; le fallback au range du paragraphe absorbe ce cas sans crash.

## Alternatives rejetées

- **Envoyer le Markdown brut au TTS** : rejeté, produirait des artefacts
  audio (« dièse dièse », URLs épelées) — exclu explicitement par le CdC §11.
- **NLP lourde pour la segmentation de phrases** : rejeté pour le MVP, le
  CdC §33 note qu'« aucune vraie NLP n'est nécessaire » ; regex + liste
  d'abréviations suffit, `sentence-splitter` est essayé en premier avant
  tout code maison.

## Tests qui prouvent la décision

- Unit : MDAST → `SourceSegment[]` sur un document fixture couvrant heading,
  paragraph, code, link, image, table, frontmatter ; assertion sur `type`,
  `spokenText` selon la politique de bloc par défaut.
- Unit : découpage de phrases FR/EN sur un corpus de cas pièges
  (abréviations, décimales, initiales, URLs, `inlineCode`).
- Unit : fallback de `sourceRange` quand la recherche `indexOf` échoue.
- Intégration : édition du document pendant la lecture (D6) — le segment
  modifié passe `stale`, les autres conservent un `sourceRange` correct.
