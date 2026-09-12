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

## Révision du 2026-09-12

### Statut

Accepté (2026-09-12). Révise la section « Décision » ci-dessus ; ne
réécrit pas l'historique.

### Contexte

Retour utilisateur après test réel de la disposition `minimal` (0.1) :
« le raccourci `ctrl+alt+v` n'est pas intuitif en procédure de démarrage,
je préfère avoir une fenêtre dédiée à l'outil dans VS Code, comme Claude
avec son chat ou GitFlow avec sa vue de flow ». Le pari initial de cette
ADR — un chord clavier + Quick Picks comme point d'entrée principal,
`minimal` par défaut — supposait une découvrabilité suffisante via le
parcours guidé et le CodeLens. En usage réel, un raccourci à deux touches
sans rappel visuel permanent ne suffit pas : l'utilisateur cherche un
point d'entrée cliquable et persistant, exactement ce que les guidelines
citées en Contexte (« Views... keep the number to a minimum ») avaient fait
écarter par défaut.

### Décision

- **`llmVoice.ui.layout` : `"full"` (nouveau défaut) | `"minimal"`.** Le
  View Container complet (CdC §6) devient le point d'entrée principal ;
  `minimal` reste disponible pour qui préfère le lecteur dans le Panel
  (raccourci `ctrl+alt+v` inchangé, toujours actif dans les deux modes).
- **Icône dédiée dans la barre d'activité** (`media/activity-icon.svg`,
  24×24, `currentColor`, trait simple — haut-parleur + onde), au même
  emplacement que le point d'entrée du chat de Claude ou de la vue GitFlow
  : cliquer dessus ouvre directement la vue `llmVoice`.
- **Contenu de la vue dédiée, dans l'ordre du CdC §6** :
  1. **Lecture en cours** — la même `WebviewView` que le mini-player du
     Panel (`PlayerViewProvider`, non réécrite), enregistrée une seconde
     fois sous l'id `llmVoice.playerView` pour ce nouveau conteneur ;
     invite d'une ligne (« Lire le document actuel » / « Choisir une
     voix ») quand rien ne joue.
  2. **Inbox** — le même Tree View qu'en `full` avant cette révision
     (`llmVoice.inboxView`), avec le compteur de non-lus désormais visible
     en badge sur l'icône du conteneur (`vscode.TreeView.badge`).
  3. **Profils** — nouveau Tree View (`llmVoice.profilesView`,
     `ProfilesTreeProvider`) : profil actif marqué (icône `check`),
     actions au survol (activer, éditer, dupliquer, supprimer), bouton
     « Nouveau profil » dans le titre de la vue.
  - **Actions dans la barre de titre** (portées par la vue « Lecture en
    cours », qui est la première du conteneur) : lire le document actuel,
    parcourir les voix, réglages.
- **Découvrabilité au premier lancement** : la vue dédiée s'ouvre une
  seule fois, en même temps que le parcours guidé
  (`workbench.view.extension.llmVoice`, même drapeau persistant
  `globalState` que `openWalkthroughOnFirstActivation` — jamais une
  deuxième fois sans action de l'utilisateur, CdC §52).
- Le Panel `minimal` (`llmVoice.player`, status bar, CodeLens) n'est pas
  retiré : il reste enregistré tel quel, sans condition sur
  `llmVoice.ui.layout`, pour que la bascule vers `minimal` continue de
  fonctionner sans recharger de vue.

### Conséquences

- Le View Container complet cesse d'être un mode secondaire opt-in : il
  devient la disposition par défaut, `minimal` devenant l'option pour qui
  veut « ne pas prendre de place ». Aucune fonctionnalité perdue dans un
  sens ou dans l'autre.
- `PlayerViewProvider`/`InboxTreeProvider` sont réutilisés sans
  modification ; seul `package.json` (conteneur, vues, menus) et un nouveau
  `ProfilesTreeProvider` changent la surface UI.
- Limite connue : `PlayerViewProvider` ne gère qu'un seul `WebviewView`
  actif à la fois (son unique `WebviewAudioSink`) ; si un utilisateur ouvre
  simultanément le Panel *et* la vue dédiée, seul le dernier résolu reste
  connecté aux contrôles. Cas marginal (les deux dispositions ne sont
  normalement pas ouvertes en même temps) — à corriger si des rapports
  d'usage le justifient.

### Tests qui prouvent la révision

- Intégration : le conteneur `llmVoice` et ses trois vues sont bien
  enregistrés (id, ordre, type) ; `llmVoice.ui.layout` vaut `"full"` par
  défaut ; la vue Profils liste `profiles.json` et marque exactement un
  profil actif ; le badge de l'inbox se met à jour après un dépôt réel.
- Unit : construction des lignes de la vue Profils (icône, description,
  marquage actif) et calcul du badge de non-lus, tous deux vscode-free
  (`profileTreeItems.ts`, `inboxFormat.ts`).
- La décision « ouverture unique au premier lancement » réutilise
  `shouldOpenWalkthroughOnActivation`, déjà couverte par
  `test/unit/onboarding/Walkthrough.test.ts` (jamais sous
  `ExtensionMode.Test`, jamais deux fois).
