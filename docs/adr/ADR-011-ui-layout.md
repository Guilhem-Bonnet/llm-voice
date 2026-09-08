# ADR-011 — Layout UI : `minimal` par défaut, `full` en option

## Statut

Accepté (2026-09-08).

## Contexte

`ui-compact-v1.md` étudie les surfaces VS Code disponibles vis-à-vis des
guidelines officielles (Webviews « only when absolutely necessary »,
Views « keep the number of Views to a minimum », Sidebars « auxiliary,
peuplée par glisser-déposer utilisateur, pas ciblable par défaut »). D12
tranche entre le View Container complet du CdC §6 et une surface plus
compacte.

## Décision

- **`llmVoice.ui.layout` : `"minimal"` (défaut) | `"full"`.** `full` active
  le View Container complet du CdC §6 ; `minimal` reste le défaut.
- **Layout `minimal`** :
  - **Un seul item de status bar** (CdC §8), aligné à droite, priorité
    basse. Textes exacts : `$(unmute) Professeur` (idle), `$(debug-pause)
    03:12 • Professeur` (playing), `$(play) 03:12 • Professeur` (paused),
    `$(warning) Document modifié` (stale, D6), `$(lock) Professeur`
    (provider local uniquement, ADR-009 niveau 1). Menu au clic : Quick
    Pick reprendre/pause, arrêter, changer de profil, ouvrir l'inbox.
  - **Quick Picks** pour la sélection de profil et l'inbox.
  - **CodeLens** « ▶ Lire cette section » au-dessus de chaque heading
    Markdown (`documentSelector: markdown` uniquement), retiré si aucune
    session n'est possible.
  - **Décorations éditeur** : segment lu en fond translucide
    (`ThemeColor('llmVoice.segmentHighlightBackground')`) ; segment
    `stale` (D6) en soulignement pointillé `editorWarning.foreground`.
    Auto-scroll uniquement si le segment sort du viewport.
  - **Mini-player** : une `WebviewView` de trois lignes dans le **Panel**
    (~80 px, repliable, `retainContextWhenHidden: true`) — titre + profil
    + temps, barre de progression, cinq boutons (précédent, play/pause,
    suivant, stop). **Jamais affichée vide** : le Panel ne s'ouvre pas
    tant qu'aucune session n'existe ; ouvert manuellement sans session, un
    lien « Aucune lecture en cours… » (pas de bouton).
  - **Placement Panel, pas Secondary Side Bar** : celle-ci n'est peuplée
    que par glisser-déposer utilisateur, une extension ne peut pas la
    cibler par défaut ; le Panel est prévu pour les vues de support
    (« benefit from more horizontal space », « supporting functionality »).
- **États** (state machine côté Extension Host) : `idle`, `preparing`,
  `playing`, `paused`, `stale` (D6), `error` — chacun avec son texte de
  status bar et son bouton central dédié (ex. `error` → `↻ Retry`).
- **Raccourcis** : chord `ctrl+alt+v` puis une touche libre (contrairement
  à `ctrl+k`, préfixe natif massif) ; ex. `ctrl+alt+v space` = Play/Pause.
  Proposés comme « suggested keybindings », désactivables individuellement,
  jamais imposés (CdC §7).
- **Theming strict** : Codicons uniquement (`$(debug-start)`,
  `$(debug-pause)`…), jamais d'émoji dans l'UI native ; variables
  `--vscode-*` uniquement, jamais de couleur en dur.
- **Accessibilité** : `aria-label` sur chaque bouton, `role="toolbar"`,
  annonce optionnelle du segment (`llmVoice.a11y.announceSegment`, off par
  défaut pour ne pas doubler la synthèse pour les lecteurs d'écran).

## Conséquences

- Le View Container complet (CdC §6) n'est pas retiré du produit : il
  devient un mode utilisateur (`full`), pas le défaut — aucune perte de
  fonctionnalité prévue au CdC.
- `minimal` réduit fortement l'empreinte visuelle par défaut, conforme aux
  guidelines VS Code citées, tout en couvrant l'audio (`<audio>`, barre de
  progression, 5 boutons) qu'une Tree View native ne permettrait pas.
- Impact CdC : §6 devient le mode « full » ; §8 inchangé ; §69 gagne les
  CodeLens.

## Alternatives rejetées

- **View Container complet par défaut (CdC §6 initial)** : rejeté comme
  défaut, trop lourd au regard des guidelines « keep Views to a minimum » ;
  conservé en option `full`.
- **Secondary Side Bar par défaut** : rejeté, une extension ne peut pas la
  cibler par défaut, elle n'est peuplée que par action utilisateur.
- **Tree View native seule (sans Webview)** : rejeté, insuffisante pour
  `<audio>` + barre de progression + boutons de transport.

## Tests qui prouvent la décision

- Intégration : chaque état (`idle`→`preparing`→`playing`→`paused`→
  `stale`→`error`) produit le texte de status bar et le bouton central
  attendus.
- Intégration : le Panel mini-player ne s'affiche jamais vide (assertion
  sur l'absence d'ouverture sans session, puis apparition en `preparing`
  dès `Speak *`).
- Unit : CodeLens présent uniquement sur `.md` avec headings, absent si
  Readiness Probe non prête.
- Unit : `llmVoice.ui.layout = "full"` monte le View Container complet ;
  `"minimal"` (défaut) ne monte que status bar + Panel + CodeLens.
- Accessibilité : test automatisé de présence des `aria-label` sur les
  cinq boutons du mini-player.
