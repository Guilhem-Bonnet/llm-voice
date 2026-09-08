# ADR-002 — Synchronisation audio et surlignage dans l'éditeur

- Statut : accepté
- Date : 2026-09-08
- Décideurs : Archie (platform-architect), sur cadrage D4/D6/D12
- Références : CdC §14, §15, §16, §17, §61, §70 ; décisions D4, D6, D12

## Contexte

Pendant la lecture, l'utilisateur doit voir où il en est dans le document
source. Le CdC exige un surlignage au niveau phrase ou petit groupe de phrases
en MVP (§15.1), l'alignement mot à mot étant explicitement hors périmètre (§16).
Deux difficultés : la narration transformée casse la correspondance texte-audio
(§15.2), et le document peut être édité pendant la lecture (D6).

## Décision

### Chaîne de mapping

`SourceSegment.sourceRange` (posé par le parser Markdown depuis les positions
MDAST) est la seule ancre. Un `NarrationSegment` porte `sourceSegmentIds[]` et
`sourceRanges[]` ; un `AudioChunk` hérite de ces `sourceRanges`. La relation
N↔N du CdC §61 est donc préservée de bout en bout, et le highlight ne dépend
jamais du texte prononcé.

### Deux modes

- **Mode phrase** (lecture fidèle) : un chunk = 1 à 3 phrases = un `sourceRange`
  contigu. Le surlignage est ce range.
- **Mode bloc** (narration) : un chunk narré couvre un paragraphe entier ; on
  surligne l'union des `sourceRanges` d'origine pendant toute la narration
  (CdC §15.2). Aucune répartition proportionnelle en 0.1.

Le mode découle du profil (`chunking.unit`), pas d'un réglage séparé.

### Pilotage

Le highlight est piloté par les transitions de chunk, **pas** par `timeupdate` :
`load` pose la décoration, `ended` la retire (D4). `timeupdate` n'alimente que
la barre de progression. Motif : `timeupdate` est émis ~4×/s et son cumul dérive
par rapport à la durée réelle du fichier ; `ended` est la seule vérité.

### Décorations

Trois `TextEditorDecorationType` créés une fois et réutilisés :

| type | usage | style |
|---|---|---|
| `current` | segment en cours | `backgroundColor: var(--vscode-editor-findMatchHighlightBackground)`, `isWholeLine: false` |
| `upcoming` | prochain chunk préchargé (optionnel, réglage) | bordure gauche discrète |
| `stale` | segment invalidé par une édition (D6) | soulignement pointillé, pas de fond |

Uniquement des couleurs de thème `--vscode-*` / `ThemeColor`, jamais de valeur
en dur.

### Auto-scroll

`revealRange` **uniquement** si le range sort du viewport
(`TextEditor.visibleRanges`), avec `TextEditorRevealType.InCenterIfOutsideViewport`.
Un `revealRange` systématique ferait sauter l'éditeur à chaque phrase et
empêcherait l'utilisateur de lire ailleurs pendant l'écoute. Désactivable par
`llmVoice.ui.autoScroll`.

### Document modifié pendant la lecture (D6)

- Le texte lu est un **snapshot** pris au lancement ; une édition n'arrête
  jamais la lecture ni ne déclenche de re-synthèse.
- Les décorations VS Code suivent nativement insertions et suppressions : le
  highlight reste correct pour toute édition hors du segment courant.
- Si une édition intersecte un segment **pas encore lu**, la session passe en
  `stale` : status bar `$(warning) Document modifié`, décoration `stale` sur ce
  segment, aucune re-synthèse. `Stop` puis `Speak From Cursor` repart du texte
  à jour.
- Si le document est fermé, la lecture continue et le highlight est simplement
  absent ; il est reposé si le document est rouvert (recherche par `uri`).

## Conséquences

- Le surlignage est exact au chunk et robuste aux éditions, sans horloge partagée
  entre Webview et Extension Host.
- La granularité mot n'est pas atteignable avec ce design ; elle nécessitera des
  timings par mot du provider TTS (ou `onboundary` du Web Speech API, D9) et fera
  l'objet d'un ADR séparé en 0.2.
- Le parser doit garantir des `sourceRange` stables et non chevauchants : c'est
  la condition de correction du highlight, testée en amont du player.
- Un chunk sans `sourceRange` (source presse-papiers, inbox Claude) est légal :
  le highlight est simplement inactif, pas une erreur.

## Alternatives rejetées

- **Highlight piloté par `timeupdate` et durées cumulées** : dérive garantie
  (padding de silence des TTS, arrondis), et impose une horloge dans la Webview.
- **Alignement forcé mot à mot par WhisperX / aeneas** : coûteux en GPU, ajoute
  une dépendance lourde, hors périmètre MVP (§16).
- **`revealRange` systématique** : rend le document inutilisable pendant l'écoute.
- **Re-synthèse automatique à l'édition** : coût GPU non sollicité et
  comportement surprenant ; rejeté par D6.
- **Décorations à couleurs fixes** : illisible sur la moitié des thèmes.

## Tests qui prouvent la décision

- Unitaire : mapping — `SourceSegment[] → NarrationSegment[] → AudioChunk[]`
  conserve l'union des `sourceRanges` en mode bloc et l'identité en mode phrase.
- Unitaire : `HighlightController` — `load(c)` produit exactement une pose de
  décoration `current`, `ended(c)` exactement un retrait ; aucun appel n'est
  déclenché par `timeupdate`.
- Unitaire : `shouldReveal(range, visibleRanges)` (fonction pure) renvoie `false`
  quand le range est déjà visible, `true` sinon.
- Unitaire : invalidation — une édition qui intersecte un segment non lu fait
  passer la session en `stale` ; une édition hors segments ne la change pas.
- Intégration : lecture d'un fichier fixture, édition en cours de lecture, la
  lecture se poursuit et la status bar affiche l'état `stale`.
