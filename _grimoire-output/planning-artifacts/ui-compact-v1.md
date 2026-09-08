# UI compacte — LLM Voice dans VS Code (v1)

> Frida (art-director) + Archie (platform-architect). Source : CdC §6-9, §42, §49-50, §69-70 ; décisions D4 (protocole Webview↔Extension), D5 (Profile Editor → 0.2). Objectif utilisateur : rester dans VS Code, UI qui ne prend pas de place.

## 1. Inventaire des surfaces VS Code

| Surface | Coût écran | Points forts | Limites | Guideline officielle |
|---|---|---|---|---|
| **Status bar item** + Quick Pick au clic | ~22 px de haut, texte court | Toujours visible, natif, 0 clic pour voir l'état | 1 seul item recommandé, pas de progress fin | [status-bar](https://code.visualstudio.com/api/ux-guidelines/status-bar) : « Limit the number of items added » ; « Use short text labels » ; « Place secondary (contextual) items on the right » |
| **Quick Pick / Quick Input** (profils, inbox) | Overlay temporaire, disparaît après choix | Clavier-first, filtrable, zéro espace permanent | Pas de contenu persistant (progress, transport) | [quick-picks](https://code.visualstudio.com/api/ux-guidelines/quick-picks) : « helpful when selecting a configuration option... or picking from a list of items » |
| **Notifications** avec boutons | Toast temporaire coin bas-droit | Bon pour un événement ponctuel (erreur provider) | Interrompt, jamais pour un flux répétitif | [notifications](https://code.visualstudio.com/api/ux-guidelines/notifications) : « only when absolutely necessary » ; **Don't** « Send repeated notifications » |
| **Éditeur** — decorations / gutter / hover | 0 px additionnel, inline dans le texte | S'intègre au flux de lecture, pas de vue à ouvrir | Décoratif seulement, pas de commande complexe | [Extension Capabilities → Theming](https://code.visualstudio.com/api/extension-capabilities/theming) (ThemeColor, `contributes.colors`) |
| **CodeLens** « ▶ Lire cette section » sur headings MD | ~18 px/heading, seulement en `.md` | Action contextuelle au bon endroit, découvrable | Coûteux si posé sur chaque ligne | [editor-actions](https://code.visualstudio.com/api/ux-guidelines/editor-actions) ; CodeLens : « lightweight version... CancellationToken » ([vscode wiki](https://github.com/microsoft/vscode/wiki/Extension-API-guidelines)) |
| **Tree View** sidebar (inbox, profils) | Largeur Sidebar (~300 px) | Natif, accessible, hiérarchique, peu coûteux | Pas de contrôles riches (slider, boutons inline) | [views](https://code.visualstudio.com/api/ux-guidelines/views) : « Keep the number of Views to a minimum » ; Welcome : « links instead of buttons » |
| **Webview View** Sidebar / Secondary Side Bar / Panel (player) | Hauteur variable, mini possible (~70-90 px) | Seule option pour `<audio>` + progress bar custom | « Only when absolutely necessary » ; coût perf si `retainContextWhenHidden` | [webviews](https://code.visualstudio.com/api/ux-guidelines/webviews) : « Only use webviews when absolutely necessary » ; [extension-guides/webview](https://code.visualstudio.com/api/extension-guides/webview) : « high memory overhead » |
| **Webview Panel** éditeur de profil (0.2, D5) | Plein onglet éditeur | Justifié : profil = champs structurés (CdC §49) | Différé en 0.2 — 0.1 = `profiles.json` + JSON Schema | idem webviews : réserver aux cas où les composants standards ne suffisent pas |
| **Commandes + keybindings + context menu** | 0 px permanent | Palette, raccourcis, clic droit éditeur (CdC §69) | Découvrabilité faible sans rappel visuel | [command-palette](https://code.visualstudio.com/api/ux-guidelines/command-palette), [context-menus](https://code.visualstudio.com/api/ux-guidelines/context-menus) |
| **`window.withProgress`** en status bar | ~22 px, remplace le texte du status bar | Feedback « préparation… » sans notification | Seulement tâche courte/déterminée | [notifications](https://code.visualstudio.com/api/ux-guidelines/notifications) : « show progress that is low priority in the status bar » |
| **`TextEditor.revealRange`** | 0 px, action de scroll | Ramène le segment lu dans le viewport | Doit rester discret (pas de saut brutal) | API programmatique — combinée à la decoration (§5) |

## 2. Trois propositions de layout

### A — « Invisible » (status bar + Quick Pick + CodeLens + decorations, 0 vue)

```
┌─────────────────────────────────────────────────┐
│ # Readiness Probe              ▶ Lire cette      │  ← CodeLens sur heading
│ section                                          │
│ Un probe Kubernetes vérifie... [texte surligné]  │  ← decoration inline
├─────────────────────────────────────────────────┤
│                                                   │  aucune vue ouverte
├─────────────────────────────────────────────────┤
│ $(debug-pause) 03:12 • Professeur                │  ← status bar, ~22px
└─────────────────────────────────────────────────┘
```

Place occupée : **0 px persistant** hors les 22 px de status bar déjà partagés avec le reste de VS Code. Parcours : `Speak Document` (palette/raccourci) → Quick Pick profil → lecture démarre, CodeLens/decoration suivent le texte → clic status bar → Quick Pick (Pause/Stop/Next/Prev/Profil) → `Open Inbox` → Quick Pick des messages → `▶ Speak`. Tout au clavier, zéro webview.

### B — « Mini-player » (A + 1 Webview View ~3 lignes, repliable)

```
┌─────────────────────────────────────────────────┐
│ # Readiness Probe              ▶ Lire cette      │
│ section                                          │
│ Un probe Kubernetes vérifie... [texte surligné]  │
├─────────────────────────────────────────────────┤
│ ▾ LLM VOICE                       Panel, ~70-90px│
│ Readiness Probe · Professeur      03:12 / 18:42  │
│ ━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│         ⏮      ▶/⏸      ⏭      ■                │
├─────────────────────────────────────────────────┤
│ $(debug-pause) 03:12 • Professeur                │
└─────────────────────────────────────────────────┘
```

Place occupée : **~70-90 px de haut** (≈ 8-10 % d'un écran 900 px), repliable à 0 (chevron), Panel masqué par défaut si rien ne joue. Parcours identique à A, sauf que Play/Pause/Prev/Next/Stop sont cliquables dans la mini-vue en plus des Quick Pick/clavier ; inbox et profils restent en Quick Pick (pas de vue dédiée).

### C — « Container complet » (View Container LLM Voice, CdC §6)

```
┌────┬────────────────────────────────────────────┐
│ 🔊 │ LLM VOICE                                   │
│    │ ──────────────────────────                  │  Sidebar entière,
│    │ NOW PLAYING                                 │  ~280-320 px large,
│    │ Readiness Probe — 03:12/18:42                │  hauteur = écran
│    │ ⏮  ▶/⏸  ⏭  ■        Profil ▾                │
│    │ ──────────────────────────                  │
│    │ INBOX (2)                                    │
│    │ Claude • backend-api  ✓ il y a 25 sec        │
│    │ Claude • k8s-lab      ✓ il y a 2 min         │
│    │ ──────────────────────────                  │
│    │ PROFILES                                     │
│    │ 🎓 Professeur  🎧 Fidèle  🤖 Résumé ⚡ Rapide │
└────┴────────────────────────────────────────────┘
```

Place occupée : **une colonne entière de la Sidebar** (~280-320 px, 15-20 % d'un écran 1600 px), plus une icône permanente dans l'Activity Bar. Parcours identique mais tout est cliquable sans Quick Pick : inbox et profils visibles en permanence.

### Comparaison

| Critère | A Invisible | B Mini-player | C Container complet |
|---|---|---|---|
| Place occupée | ~0 px | ~70-90 px, repliable | Colonne Sidebar + icône Activity Bar |
| Découvrabilité | Faible (commandes à connaître) | Bonne (mini-vue + CodeLens) | Excellente (tout visible) |
| Accessibilité clavier | Excellente (Quick Pick/commande) | Bonne (webview + fallback clavier) | Bonne, plus de tabulation |
| Accessibilité lecteur d'écran | Excellente (natif) | Correcte si aria labels soignés | Correcte, Tree View native |
| Complexité de dev | Faible | Moyenne (1 Webview View + D4) | Plus élevée (3 vues + synchro) |
| « Ne prend pas de place » | Idéale mais peu visible | **Bon compromis** | Contredit l'exigence par défaut |

## 3. Recommandation

**B par défaut, C activable via `llmVoice.ui.layout` (`"minimal" \| "full"`, défaut `"minimal"`).** Cette lecture confirme le pressenti : les guidelines webviews (« only when absolutely necessary ») et views (« keep the number of Views to a minimum ») poussent vers le plus petit composant qui couvre le besoin — mais l'audio (`<audio>`, progress bar, 5 boutons) dépasse ce qu'une Tree View native permet, donc *une* Webview View reste justifiée. Le container complet (CdC §6) n'est pas retiré : il devient un mode utilisateur, pas le défaut.

**Placement par défaut** : Panel, pas Secondary Side Bar — celle-ci n'est peuplée que par glisser-déposer utilisateur ([sidebars](https://code.visualstudio.com/api/ux-guidelines/sidebars) : « auxiliary location... users can drag Views to customize their layout »), une extension ne peut pas la cibler par défaut. Le [panel](https://code.visualstudio.com/api/ux-guidelines/panel) convient : « Render Views in the Panel that benefit from more horizontal space », « supporting functionality » — le mini-player complète l'éditeur, il n'est pas le point d'entrée.

**Contenu exact du mini-player** (3 lignes) :
```
Ligne 1  Readiness Probe · Professeur technique        03:12 / 18:42
Ligne 2  ━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ligne 3            ⏮        ▶/⏸        ⏭        ■
```

**États** (state machine côté Extension Host, D4) :

| État | Ligne 1 | Bouton central | Barre |
|---|---|---|---|
| `idle` (rien à lire) | message d'accueil une ligne | — | vue masquée par défaut |
| `preparing` | « Préparation… » + spinner | ⏸ désactivé, `■` actif | indéterminée |
| `playing` | titre · profil | ⏸ | temps réel, `timeupdate` throttlé 250 ms (D4) |
| `paused` | titre · profil | ▶ | figée à la position pausée |
| `stale` (D6) | « ⚠ Document modifié » | ▶ (relance sur `Speak From Cursor`) | figée, style atténué |
| `error` | message d'erreur court | ↻ Retry | masquée |

**Vue masquée** : `retainContextWhenHidden: true` sur le `WebviewView` (D4) — un seul `<audio>`, l'Extension Host garde l'état, la lecture continue Panel replié ; coût mémoire accepté car c'est le cas d'usage prévu par la guidance (« state that cannot be quickly saved and restored »).

**Rien à lire** : pas de vue vide — le Panel ne s'affiche pas tant qu'aucune session n'existe ; à la première commande `Speak *` il apparaît déjà en `preparing`. Ouvert manuellement sans session : une ligne « Aucune lecture en cours — clic droit sur un `.md` pour commencer. » (lien, pas de bouton, cf. Welcome View : « links instead of buttons »).

**Thème** : uniquement des variables `--vscode-*` (`--vscode-editor-foreground`, `--vscode-progressBar-background`, `--vscode-button-*`), jamais de couleur en dur, conforme à « Ensure all UI elements respect the current theme ». Transport en **Codicons** (`$(debug-start)`, `$(debug-pause)`, `$(debug-stop)`, `$(chevron-left)`/`$(chevron-right)`), pas d'émoji.

## 4. Status bar (un seul item, CdC §8)

| État | Texte exact | Longueur | Icône |
|---|---|---|---|
| Idle / profil sélectionné | `$(unmute) Professeur` | ≤ 20 car. | `$(unmute)` |
| Playing | `$(debug-pause) 03:12 • Professeur` | ≤ 28 car. | `$(debug-pause)` |
| Paused | `$(play) 03:12 • Professeur` | ≤ 28 car. | `$(play)` |
| Stale (D6) | `$(warning) Document modifié` | ≤ 24 car. | `$(warning)` |
| Provider local uniquement (D9 niveau 1) | `$(lock) Professeur` | ≤ 20 car. | `$(lock)` |

Priorité/alignement : un seul item, aligné **droite** (`StatusBarAlignment.Right`, priorité basse) — fonctionnalité contextuelle à l'éditeur actif, pas info globale de workspace (« Place secondary (contextual) items on the right »). Nom de profil tronqué à ~12 caractères (`…`) pour ne jamais dépasser ~30 caractères visibles.

**Menu au clic** (Quick Pick) :
```
▶ Reprendre / ⏸ Pause
■ Arrêter
🎙 Changer de profil
📥 Ouvrir l'inbox
```
Reprend le menu CdC §8, complété par l'accès inbox (évite de chercher la commande dans la palette).

## 5. Feedback dans l'éditeur

**Segment lu** : `TextEditorDecorationType` — `backgroundColor: new ThemeColor('llmVoice.segmentHighlightBackground')` (déclarée via `contributes.colors`, fallback `editor.findMatchHighlightBackground`), `overviewRulerColor` identique, `overviewRulerLane: OverviewRulerLane.Center`, `isWholeLine: false`. Fond translucide, sans bordure ni gras, lisible en clair et sombre.

**Segment `stale`** (D6) : décoration distincte — `textDecoration: 'underline dashed 1px'`, `color: new ThemeColor('editorWarning.foreground')` — signale « ce texte a changé » sans repeindre le bloc.

**CodeLens par heading Markdown** : une ligne `▶ Lire cette section` au-dessus de chaque `#`/`##`/`###`, seulement dans les `.md` (`documentSelector: { language: 'markdown' }`), léger (pas de résolution asynchrone coûteuse), retiré si aucune session n'est possible (Readiness Probe non prête).

**Auto-scroll** : `editor.revealRange(segmentRange, TextEditorRevealType.InCenterIfOutsideViewport)` — ne bouge la vue que si le segment sort du viewport, jamais de recentrage systématique.

## 6. Raccourcis par défaut

Préfixe de chord proposé : **`ctrl+alt+v`** (Voice). `ctrl+k` est déjà un préfixe natif massif (`ctrl+k ctrl+s`, `ctrl+k ctrl+c`…) et tout binding posé sur `ctrl+k` seul casserait ses propres chords ([issue #88488](https://github.com/microsoft/vscode/issues/88488)). `ctrl+alt+v` n'a pas d'usage par défaut connu (à la différence de `ctrl+alt+up/down`, réservés au multi-curseur) et reste libre sur les dispositions courantes.

```
ctrl+alt+v ctrl+alt+p   Speak Document (depuis le début)
ctrl+alt+v ctrl+alt+s   Speak Selection
ctrl+alt+v space        Play / Pause (toggle)
ctrl+alt+v ctrl+alt+x   Stop
ctrl+alt+v right        Next Segment
ctrl+alt+v left         Previous Segment
```

Aucun raccourci n'est imposé de force (CdC §7) : proposés comme « suggested keybindings » dans `package.json` (`when` limité à `editorTextFocus`/`llmVoice.sessionActive`), désactivables individuellement.

**Accessibilité** : chaque bouton de la Webview View porte un `aria-label` explicite (« Lecture », « Pause », « Segment précédent »…), focus visible via l'outline standard VS Code, `role="toolbar"` sur le conteneur des boutons. Annonce optionnelle du segment lu : réglage `llmVoice.a11y.announceSegment` (off par défaut) qui pousse un message dans une région `aria-live="polite"` cachée au changement de segment — off par défaut pour ne pas doubler la synthèse vocale pour les utilisateurs de lecteur d'écran qui ont déjà leur propre verbosité.

## 7. À éviter

1. Plus d'un item de status bar (« Limit the number of items added »).
2. Notification à chaque changement d'état du player — status bar / mini-vue uniquement, jamais de toast répété (« Don't send repeated notifications »).
3. Ouvrir une Webview quand un Quick Pick ou une Tree View suffit (profils, inbox restent en Quick Pick tant que le contenu est une simple liste).
4. Afficher le Panel/View Container complet ou une vue vide par défaut sans session active (« Use Welcome views only when necessary »).
5. `retainContextWhenHidden` par réflexe : seulement sur la Webview audio, pas sur le futur Profile Editor 0.2 (rechargeable depuis `profiles.json`).
6. CodeLens ou decorations trop denses (une entrée par ligne) — seulement sur les headings et le segment courant, jamais sur tout le document.
