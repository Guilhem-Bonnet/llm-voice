# Plan d'intégration UX — novembre 2026

Demande de guilhem-bonnet : voir où et comment tout s'intègre sur les planches.
Statut : proposition, non validée.

## 0. Ce qui a été lu et ce qui est déduit

Lu : `_grimoire-output/design/refonte-ux-2026-11.md` ; `vscode-extension/src/views/player/playerHtml.ts` (le panneau réel : bloc d'accueil, titre, barre de progression, statut, 4 boutons de transport, élément audio) ; la liste des fichiers de planches et de `media/player/` ; les extraits de code cités au §6.

Non lu, faute de tours : le contenu des planches `.dc.html` (Panneau-document, Panneau-lecture-detail, Panneau-preparation, Panneau-reprise, Lancer-lecture, Main, Galerie-etats, Style-lecture, Lexique, etc.). Les planches sont donc décrites d'après leur nom et d'après vos décisions. La fin de `decisions-log.md` et ADR-017 n'ont pas été lus. Aucun ADR-018 n'existe (le glob ne trouve que ADR-017).

Toute hauteur en px est une cible de conception, pas une mesure.

## 1. Architecture : cinq destinations

Principe : le panneau ne sert qu'à écouter et à lancer. Tout ce qui se règle se règle ailleurs, avec un seul lien depuis le panneau.

| Destination | Nom | Contenu | Comment on y arrive |
|---|---|---|---|
| Vue latérale | **LLM Voice** (le panneau) | Lecteur, document ouvert, reprise, attente, incidents, vitesse | Icône de la barre d'activité ; bouton « Lire » de la barre de titre de l'éditeur |
| Onglet d'éditeur | **Studio** | 4 sections : **Voix** (galerie des 36 voix), **Style** (préréglages, curseurs, consigne, rythme), **Distribution** (jeu d'acteurs), **Lexique** | Lien « Studio » en pied de panneau ; commande « LLM Voice : ouvrir le Studio » ; chaque lien contextuel du panneau ouvre la bonne section |
| Réglages VS Code | **Réglages** | Seulement l'technique : service distant, diagnostic, crédits, chemins, accessibilité | Roue du pied du Studio ; commande « LLM Voice : réglages » |
| Quick Pick | **Voix rapide** et **Mode** | Changer de voix ou de mode en 2 clics sans quitter l'éditeur | Clic sur la voix dans le panneau ; clic sur l'élément de barre d'état |
| Barre d'état | élément unique « LLM Voice » | État (prêt, attente, lecture) et ouverture du Quick Pick | Toujours visible |

Décisions de regroupement :
- Voix, Style, Distribution et Lexique se regroupent dans un seul onglet **Studio**, car chacun demande plus de 500 px de large (galerie, curseurs, tableau de distribution). Ils ne tiennent pas dans un panneau de 260 à 500 px.
- Le Studio s'ouvre dans l'éditeur, donc il se place à côté du document, ce qui permet d'écouter un échantillon en regardant le texte.
- La galerie reste une section du Studio, pas un onglet à part. La planche Main devient la section Voix.
- Le Studio est une page de webview sans appel à l'API `vscode` dans son rendu : même HTML pour l'application future (§5).
- Les modes (planches Modes-liste, Mode-edition) : liste dans le Quick Pick « Mode », édition dans la section Style (le style est rattaché au mode, donc le nom du mode est l'en-tête de la section).

Placement final par élément :

| Élément | Place |
|---|---|
| Lecture, pause, segment précédent/suivant, arrêt, progression | Panneau, toujours visible |
| Vitesse immédiate | Panneau, état lecture et pause (puce « 1,0x ») |
| Bouton « Lire » | Barre de titre de l'éditeur |
| Document ouvert | Panneau, selon l'état |
| Clic droit « Lire à voix haute », sélections multiples | Menu contextuel (éditeur et explorateur) |
| Reprise | Panneau, selon l'état (une ligne) |
| Barre d'attente et Annuler | Panneau, état attente |
| Préparer à l'avance | Panneau, bloc Document ouvert (action secondaire) |
| Choix de voix | Quick Pick (rapide) ; Studio > Voix (écoute et comparaison) |
| Style, préréglages, curseurs, consigne | Studio > Style |
| Distribution des voix | Studio > Distribution |
| Lexique | Studio > Lexique ; ajout rapide par clic droit « Corriger la prononciation » |
| Bouton des blocs de code | Panneau, état lecture, une puce à bascule (« Code : lu / ignoré ») ; défaut dans Style |
| Incidents | Panneau, état incident |
| Crédits, diagnostic, service distant | Réglages |
| Dernière réponse et deux lignes | Panneau, sous le lecteur (planche Reponses-liste) |
| Toutes les réponses, tous outils | Vue « Réponses » (remplace « Inbox » et « Réponses de Claude ») |
| Ce qu'on lit, arrivée, outils connectés | Studio > Réponses, 5e section (planche Reponses-options) |
| Accueil | Inchangé ; gagne un lien Studio |

## 2. Anatomie du panneau par état (largeur 320 px)

Règle : le lecteur (titre, progression, transport) a une hauteur réservée d'environ 112 px et ne se déplace jamais. Les autres blocs s'ajoutent sous lui, et le total des blocs hors lecteur ne dépasse pas 140 px à 320 px. Tout bloc secondaire est repliable.

Hauteurs de bloc : en-tête voix/mode 32, titre 24, progression 28, transport 36, statut 20, document ouvert 72, reprise 48, attente 56, incident 64, pied Studio 28, puce vitesse/code 28.

| État | Blocs dans l'ordre | Masqué | Total à 320 px | Repli à 260 px |
|---|---|---|---|---|
| Rien d'ouvert | texte d'accueil 40 ; bouton « Choisir une voix » 32 ; pied Studio 28 | lecteur, document | 100 | texte d'accueil sur 1 ligne |
| Document ouvert | en-tête voix/mode 32 ; Document ouvert 72 (nom, durée estimée, « Lire », « Préparer ») ; pied 28 | transport actif | 132 | « Préparer » passe en icône seule |
| Reprise proposée | Document ouvert 72 ; reprise 48 (« Reprendre à 12:30 » et « Depuis le début ») ; pied 28 | en-tête voix | 148 | libellé de reprise raccourci, heure gardée |
| Attente | en-tête 32 ; barre d'attente 56 (« Lecture dans environ 12 s », Annuler) ; transport grisé | Document ouvert, reprise | 88 + lecteur | le texte passe à « ~12 s » |
| Lecture | lecteur 112 ; ligne puces 28 (vitesse, code) ; pied 28 | Document ouvert, reprise | 168 | les puces deviennent icônes ; le pied disparaît |
| Pause | lecteur 112 ; ligne puces 28 ; reprise de position 20 | attente | 160 | idem lecture |
| Incident | lecteur 112 (gelé) ; incident 64 (cause, « Réessayer », « Détails ») | puces | 176 | « Détails » en icône |
| Jeu d'acteurs actif | lecteur 112 ; ligne personnage courant 28 (icône, prénom de voix, nom du rôle) ; puces 28 | pied | 168 | puces et personnage fusionnent sur une ligne |

Notes :
- L'attente reprend la planche Panneau-preparation, qui montre encore une barre indéterminée. À revoir : barre déterminée sur durée estimée, plafonnée à 95 % jusqu'au premier son, sans recul ; « Encore un instant… » au-delà de l'estimation ; « Plus lent que d'habitude » au double du temps ; Annuler toujours présent. Aucune lecture ne démarre seule : la fin de la barre déclenche seulement le son déjà demandé par un clic.
- Aucun état ne propose de régler la voix ou le style dans le panneau. Le seul lien est le pied « Studio ».
- Boutons : largeur fixe, `white-space: nowrap`, jamais étirés ; à 260 px les libellés longs passent en icône (Codicons), jamais à la ligne. Vérifier à 260, 320 et 500 px.
- Couleurs `--vscode-*` ; pas de glyphes provisoires (⏮ ▶ ⏭ ⏹ du code actuel sont à remplacer par `codicon-debug-reverse-continue`, `codicon-play`, `codicon-debug-continue`, `codicon-debug-stop`).

## 3. Cinq parcours (clics, sans compter la frappe)

| Tâche | Chemin | Clics |
|---|---|---|
| Première lecture | Ouvrir un fichier ; clic sur « Lire » de la barre de titre ; attente ; écoute. Si aucune voix choisie, le panneau propose « Choisir une voix » (voix par défaut Camille, voix système en repli) | 1 (2 avec le choix de voix) |
| Changer de voix | Clic sur la voix dans le panneau ; Quick Pick ; sélection | 2 (3 pour écouter d'abord dans Studio > Voix) |
| Régler un style | Pied « Studio » ; onglet Style ; préréglage | 3 (4 avec un curseur ; la consigne libre ajoute la saisie) |
| Distribuer des voix sur une pièce | Document ouvert ; « Distribuer » (menu du bloc) ; Studio > Distribution ; une voix par rôle (N rôles) ; « Lire » | 3 + N |
| Corriger une prononciation | Sélectionner le mot ; clic droit « Corriger la prononciation » ; saisie ; « Enregistrer » | 3 |

Le bouton « Distribuer » n'apparaît que si le document est détecté comme théâtre ou roman. Sans détection, l'accès reste par le Studio.

## 4. Planches : garder, modifier, supprimer, créer

Le contenu des planches existantes n'a pas été relu ; les « modifier » ci-dessous sont des consignes issues des décisions, à confirmer en ouvrant chaque planche.

| Planche | Action | Détail | Taille |
|---|---|---|---|
| Main | Modifier | Devient Studio > Voix : 36 voix françaises prénommées, Camille en tête, voix système en repli ; retirer Pocket, Piper, Kokoro, Chatterbox | 900x640 |
| Galerie-etats | Modifier | Mêmes retraits ; états : écoute, préparation, indisponible | 900x640 |
| Clair-galerie | Modifier | Version claire de Main | 900x640 |
| Credits | Modifier | Ne garder que Kyutai et les 36 voix | 600x480 |
| Preparer-voix | Modifier | Un seul moteur ; plus de choix de moteur | 600x480 |
| Panneau-preparation | Modifier | Barre déterminée, durée estimée, plafond 95 %, « Encore un instant… », « Plus lent que d'habitude », Annuler | 320x240 |
| Panneau-attente-incidents | Modifier | Aligner sur la nouvelle attente | 320x300 |
| Panneau-document | Modifier | Bloc Document ouvert avec « Lire » et « Préparer » ; hauteurs du §2 | 320x300 |
| Panneau-reprise | Modifier | Ligne « Reprendre à … » et « Depuis le début » | 320x220 |
| Panneau-lecture, Panneau-lecture-detail | Modifier | Ajouter puces vitesse et code ; état jeu d'acteurs avec personnage courant | 320x420 |
| Panneau-pause, Panneau-erreur, Panneau-incidents, Panneau-systeme, Panneau-vide, Panneau-depart | Garder | Vérifier seulement les hauteurs et le pied Studio | inchangées |
| Panneau-tailles, Clair-panneau | Modifier | Rejouer 260, 320 et 500 px avec les nouveaux blocs | 3 largeurs |
| Lancer-lecture, Menus, Actions | Modifier | Bouton « Lire » de la barre de titre, clic droit « Lire à voix haute » et « Corriger la prononciation », sélections multiples, tout fichier texte, aperçu Markdown | 900x560 |
| Style-lecture | Modifier | Section du Studio ; préréglages, curseurs, consigne libre, rythme (§6), rattachés au mode | 900x640 |
| Lexique | Modifier | Section du Studio ; tableau mot, prononciation, bouton d'écoute | 900x560 |
| Modes-liste, Mode-edition | Modifier | Liste dans le Quick Pick ; édition fusionnée dans Style | 600x420 |
| Reglages, Clair-reglages | Modifier | Retirer ce qui passe au Studio ; garder service distant, diagnostic, crédits | 600x520 |
| Reponses-claude, Accueil, Editeur-lecture | Garder | Ajouter un lien Studio à l'accueil | inchangées |
| Ma-voix, Ma-voix-erreurs | Garder | À confirmer : dépend d'une voix personnelle, non tranché par les décisions | inchangées |
| Diagnostic, Services-distants, Systeme | Garder | Rattachés aux Réglages | inchangées |
| Reserve-futur | Modifier | Retirer ce qui est livré ; garder l'application hors VS Code | 600x400 |
| **Studio-structure** | Créer | Onglet à 4 sections, navigation latérale, pied avec roue Réglages | 900x640 |
| **Distribution** | Créer | Colonne rôles, colonne voix, écoute par rôle, case « narrateur » ; exemple de pièce | 900x640 |
| **Rythme** | Créer, ou intégrer à Style-lecture | Voir §6 | 900x520 |
| **Quick-pick-voix** | Créer | Liste de voix avec Camille en tête, bouton d'écoute, lien « Plus de voix » | 480x360 |
| **Bloc-code** | Créer | Puce « Code : lu / ignoré » à 260 et 320 px | 320x120 |

Rien d'autre à créer : pas de planche séparée pour la barre d'état.

## 5. Conflits, écartés, indépendance de VS Code

Conflits :
- Un panneau de 260 px ne peut pas accueillir le style : tranché, le style va au Studio.
- Reprise et Document ouvert veulent la même place : la reprise remplace l'en-tête voix, jamais le lecteur.
- « Préparer à l'avance » et « Lire » : deux boutons dans le bloc ; à 260 px, « Préparer » devient une icône.
- Les modes portent le style (décision) et la voix globale est séparée du mode (refonte précédente) : la section Style affiche le mode ; la voix reste dans Voix.
- Le 3e clic du changement de voix n'existe que pour comparer ; le chemin court reste à 2 clics.

Écarté :
- Un onglet par fonction (Voix, Style, Lexique séparés) : trois onglets pour peu de contenu chacun.
- Des curseurs dans le panneau : prendraient la place du lecteur.
- Un menu de moteurs : un seul moteur.
- Lecture automatique à l'ouverture ou à la fin de la préparation : interdit.

Indépendant de VS Code pour l'application future : Studio (HTML, données par messages), schéma des voix, des styles, de la distribution et du lexique, estimation de durée et états d'attente. Propre à VS Code : barre de titre, clic droit, Quick Pick, barre d'état, Réglages natifs. Le panneau devient la fenêtre principale de l'application ; le Studio, sa page de réglages.

## 6. Rythme de lecture

> **Correction du concierge (2026-11-06)** : le moteur a de vrais réglages de rythme, contrairement à ce que dit la suite de cette section. `padding_bonus` allonge ou raccourcit la parole à la génération (`moshi/models/tts.py:360`), `padding_between` détache les mots. Mesures sur Camille : `scripts/voice-lab/rythme.py`, `ecoute-rythme/results.json`. Environ 3,5 à 4 mots par seconde à -1 ou -2, 3,1 à 0, 2 à +1, et au-delà de +2 la parole se morcelle (plus de 30 pauses). Ces réglages demandent une nouvelle génération. La maquette retient trois cadences et une articulation.

Ce que le code permet réellement (vérifié par recherche, sans lecture complète) :
- `deploy/kyutai16/server.py` ligne 617 et `scripts/voice-lab/kyutai16.py` ligne 131 : `model.prepare_script([text], padding_between=1)`, valeur fixe, non exposée au client. `cfg_coef=2.0` est aussi fixe. Aucun paramètre de vitesse ni de pause n'est passé au moteur.
- `player.js` ligne 144 : `audio.playbackRate = message.value`. La vitesse est donc un étirement du lecteur, après synthèse.
- `profile.schema.ts` : `playback.rate` borné entre 0,5 et 3 ; `speed` de la voix entre 0,5 et 2, multiplié par `rate` du mode (`profile.ts`, ligne 63).

Réglage :

| Réglage | Où | Réalisable aujourd'hui |
|---|---|---|
| Vitesse immédiate | Puce du panneau (état lecture et pause), valeurs 0,75 / 1 / 1,25 / 1,5 | Oui, via `playbackRate` |
| Vitesse par défaut | Studio > Style, curseur | Oui |
| Pause entre phrases | Studio > Style > Rythme | Non tel quel : `padding_between` est fixe à 1 côté moteur. Possible seulement si le serveur accepte le paramètre, ou en insérant du silence entre segments côté lecteur (hors moteur) |
| Pause entre passages (paragraphes, scènes) | Studio > Style > Rythme | Oui par silence ajouté côté lecteur entre segments ; non vérifié dans le code |
| Respirations de narration | Studio > Style > Rythme | Même mécanisme que ci-dessus ; une vraie respiration synthétisée n'est pas réglable |

À signaler plutôt qu'à promettre :
- Vitesse : `playbackRate` accélère aussi la hauteur, sauf conservation du ton activée par le navigateur. Non vérifié ici. Au-delà de 1,5 et en dessous de 0,75, la voix risque de se dégrader : borner l'interface à 0,75-1,5 tant que ce n'est pas écouté. Le schéma accepte 0,5 à 3 ; l'interface n'a pas à l'exposer.
- Pauses : tout ce qui touche le rythme réel de la voix (cadence interne, hésitations) n'est pas réglable sans modifier la synthèse ; ne pas montrer de curseur de « cadence de la voix ».
- La consigne libre ne pilote pas le rythme de façon garantie : Kyutai ne documente pas ce contrôle dans le code lu.

Écoute avant et après : bouton « Écouter un extrait » dans Rythme, qui joue un passage fixe de 2 à 3 phrases avec les réglages courants (un clic, jamais automatique) et un second bouton « Écouter l'ancien réglage » pour comparer. Dans le panneau, la vitesse s'entend immédiatement.

Global et personnage :
- Rythme global : appartient au mode (vitesse, pauses entre phrases et passages, respirations).
- Rythme d'un personnage : seule la vitesse peut varier par rôle, comme multiplicateur de la vitesse globale, dans Studio > Distribution (colonne « Vitesse », défaut 1,0). Pauses et respirations restent globales : le moteur ne les distingue pas par voix. Les respirations de narration ne s'appliquent qu'au narrateur.
- Dans le jeu d'acteurs, une vitesse par rôle impose de segmenter par rôle : la vitesse de lecture est alors celle du segment, la puce du panneau se compose avec elle (non vérifié dans `player.js`).

## Résumé du plan

Le panneau ne garde que l'écoute et le lancement ; tous les réglages vont dans un onglet Studio (Voix, Style, Distribution, Lexique) accessible par un lien de pied, et les changements rapides passent par un Quick Pick et la barre d'état. Les huit états du panneau ont une hauteur chiffrée à 320 px (au plus 176 px au total) avec repli à 260 px. Les cinq parcours coûtent de 2 à 3 clics (plus un par rôle pour la distribution). Une vingtaine de planches sont à modifier, cinq à créer. Le rythme est réglable en vitesse seulement ; les pauses dépendent d'un silence ajouté côté lecteur ou d'un paramètre moteur aujourd'hui fixe.

```grimoire-uncertainties
[
  {"where": "§0, §4", "what": "Le contenu des planches .dc.html n'a pas été lu", "why": "Les actions garder/modifier sont déduites des noms et des décisions ; à confirmer planche par planche"},
  {"where": "§0", "what": "decisions-log.md et ADR-017 non lus ; ADR-018 absent", "why": "Une décision récente pourrait contredire une consigne du plan"},
  {"where": "§2", "what": "Hauteurs en px non mesurées", "why": "Ce sont des cibles ; le rendu réel n'a pas été contrôlé"},
  {"where": "§6", "what": "La signification de padding_between=1 n'est pas établie", "why": "Le paramètre est fixe dans le code ; son unité et son effet sur les pauses n'ont pas été vérifiés"},
  {"where": "§6", "what": "Conservation du ton sous playbackRate et plage de vitesse acceptable non écoutées", "why": "Aucun test audio réalisé ; les bornes 0,75-1,5 sont prudentes"},
  {"where": "§6", "what": "Ajout de silences côté lecteur non vérifié dans player.js", "why": "Seule la ligne playbackRate a été vue"},
  {"where": "§4", "what": "Sort de Ma-voix et Ma-voix-erreurs", "why": "Les décisions ne disent pas si les voix personnelles subsistent avec 36 voix"},
  {"where": "§3", "what": "Détection théâtre ou roman pour afficher « Distribuer »", "why": "Aucune source lue ne confirme que la détection existe"}
]
```
