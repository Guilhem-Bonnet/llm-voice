# Guide utilisateur — LLM Voice

Extension VS Code de lecture vocale locale : Markdown, sélection, presse-papiers
et (bientôt) réponses de Claude Code, avec surlignage synchronisé et profils
de voix configurables. Voir `docs/install-linux.md` (installation détaillée
des serveurs), `docs/providers.md` (choix d'un moteur TTS/narrateur) et
`docs/voices.md` (clonage de voix).

## Première utilisation

Dès l'installation, l'**icône LLM Voice de la barre d'activité** (à gauche de
VS Code, comme le chat de Claude ou la vue GitFlow) s'ouvre automatiquement
une seule fois, en même temps qu'un parcours guidé (**Démarrer avec LLM
Voice**) — jamais ensuite sans action de votre part (icône cliquable à tout
moment ; parcours relançable via la palette de commandes → **Welcome: Open
Walkthrough**). C'est le point d'entrée principal de l'extension : cliquer
dessus ouvre la vue dédiée (lecture en cours, inbox, profils). Le parcours
correspond exactement à ce qui suit :

1. **Choisir une voix** — rien à faire : le premier `Speak` fonctionne déjà
   (voix système), et s'il n'y a encore aucune voix locale, une seule
   notification propose « Installer la voix française » (~60 Mo, une fois) ;
   accepter télécharge, vérifie et enchaîne automatiquement sur la lecture
   demandée. `LLM Voice: Setup Voice` reste disponible pour choisir
   explicitement, à tout moment, entre trois niveaux honnêtes — jamais un
   blocage sur « Chatterbox n'est pas installé » :
   - **Voix système** : disponible tout de suite, qualité correcte, rien à
     installer.
   - **Voix française autonome (Piper, recommandé)** : meilleure qualité,
     100 % locale, un téléchargement unique d'environ 60 Mo — aucun Docker,
     aucun serveur, aucun terminal.
   - **Qualité maximale (avancé — nécessite Docker)** : clonage de voix, la
     plus naturelle, au prix d'une installation Docker — la commande à
     lancer (`docker compose -f deploy/docker-compose.tts.yml up -d
     chatterbox`) est proposée avec un bouton « Copier la commande » et un
     lien vers la documentation ; jamais proposée par défaut.
2. **Lire un document** — ouvrir un fichier `.md` (l'extension livre un
   exemple pour tester sans avoir le vôtre sous la main) puis
   `Ctrl+Alt+V` **puis** `D` (ou palette de commandes → **LLM Voice: Speak
   Document**). Le segment en cours est surligné, les contrôles de lecture
   apparaissent dans le mini-player.
3. **Choisir un profil** — `LLM Voice: Select Profile` (voir « Profils »
   ci-dessous).
4. **Optionnel : connecter Claude Code** — `LLM Voice: Install Claude Hook`
   capture automatiquement les réponses dans une inbox dédiée (voir « Inbox
   Claude Code » ci-dessous).

Le player (« Lecture en cours » dans la vue dédiée, ou vue « LLM Voice » du
Panel en disposition `minimal`) et l'inbox affichent un texte d'accueil avec
des boutons d'action tant qu'ils sont vides — jamais un panneau vide sans
indication. Sur tout document Markdown, un bouton haut-parleur dans le titre
de l'éditeur lance directement **Speak Document**.

## Installation rapide

1. Installer VS Code ≥ 1.95, puis l'extension (`.vsix`, `docs/install-linux.md`
   §1 pour les caveats Flatpak/Snap).
2. C'est tout — le premier `Speak` fonctionne sans rien installer de plus
   (voix système, puis proposition automatique de la voix française
   autonome). Docker/un serveur TTS ne sont utiles que pour le niveau
   « Qualité maximale » (`docs/providers.md`), jamais requis par défaut.
3. (Optionnel) Installer Ollama pour la narration transformée (résumé,
   pédagogie) : `docs/install-linux.md` §2.
4. Aucune clé, aucun compte requis en usage 100 % local — le badge
   **🔒 Local** de la status bar confirme qu'aucun contenu ne quitte la machine.

## Premier « Speak Document »

1. Ouvrir un fichier `.md` (ou tout fichier texte pour une sélection).
2. Palette de commandes → **LLM Voice: Speak Document** (ou raccourci
   `Ctrl+Alt+V D`).
3. Le segment en cours de lecture est surligné dans l'éditeur ; les contrôles
   Play/Pause/Stop/Précédent/Suivant sont dans « Lecture en cours »
   (icône LLM Voice de la barre d'activité) et dans le menu de la status bar.
4. **Speak Selection** (`Ctrl+Alt+V S`) ne lit que le texte sélectionné ;
   **Speak Clipboard** (`Ctrl+Alt+V C`) lit le presse-papiers — utile pour une
   réponse copiée depuis un agent qui n'a pas encore d'inbox câblée (voir plus
   bas).

## Profils

Un profil fixe la voix, le provider TTS, le narrateur (facultatif) et la
politique de segmentation. Quatre profils sont fournis par défaut : Lecture
fidèle, Professeur technique, Résumé LLM, Révision rapide.

- **LLM Voice: Select Profile** : changer de profil pour la prochaine lecture.
- **LLM Voice: Open Profiles** : éditer `profiles.json` (validé par un schéma
  JSON généré depuis `VoiceProfileSchema`, `docs/providers.md`).
- Un profil « narré » (résumé, pédagogie) reformule le texte via un LLM local
  avant synthèse ; en cas d'échec du narrateur, la lecture reste **fidèle**
  automatiquement (mode dégradé, jamais de silence).

## Inbox Claude Code

La capture automatique des réponses de Claude Code dans une inbox dédiée
(**LLM Voice: Open Inbox**, **LLM Voice: Speak Latest Claude Response**) est
prévue par le cahier des charges (§10.4, AC-12..15) mais pas encore câblée
dans cette version — les commandes existent déjà dans la palette et
répondent « pas encore câblée » sans planter. En attendant, **Speak
Clipboard** permet de lire une réponse copiée manuellement.

## Erreurs courantes et leurs boutons

Toute erreur de provider passe par une notification VS Code avec des choix
explicites — jamais de plantage silencieux, jamais plus d'une notification du
même type par session de lecture :

| Situation | Message | Boutons |
|---|---|---|
| Aucun TTS disponible (provider injoignable ou rien de configuré) | « LLM Voice : aucune voix configurée. » | **Choisir une voix** (assistant de configuration si disponible, sinon la doc providers) / **Voir les réglages** / **Réessayer** (relance seulement le passage en échec, sans tout redémarrer) |
| Narrateur injoignable | « LLM Voice: Narrator unavailable » | **Retry** / **Read without narration** (bascule en lecture fidèle) / **Cancel** |
| Un passage échoue après plusieurs tentatives | « LLM Voice: audio chunk failed after N retries. » | **Skip** (passe au suivant) / **Stop** |

Un serveur qui charge encore son modèle (statut « Loading ») fait patienter
la première lecture quelques secondes au lieu d'échouer immédiatement.
Un provider complètement hors ligne n'empêche jamais l'extension de démarrer
— la status bar passe simplement à l'état `$(error)`.

## Aucune commande silencieuse

Chaque commande de la palette produit toujours un effet visible ou un
message expliquant pourquoi elle ne fait rien — jamais un clic qui ne
produit rien d'observable :

- **Play** (`Ctrl+Alt+V Espace`, en réalité **Play/Pause**, une vraie
  bascule) : sans lecture en cours, démarre la sélection si elle n'est pas
  vide, sinon le document actif ; sans éditeur ouvert, propose « Ouvrir un
  document » ; en pause, reprend ; en lecture, met en pause (bascule) — la
  commande **LLM Voice: Play** de la palette, elle, ne fait jamais que
  démarrer/reprendre (jamais pause, `Pause` reste une commande séparée).
- **Pause** / **Stop** / **Segment suivant/précédent** sans lecture en
  cours : notification expliquant qu'il n'y a rien à faire (grisées dans la
  palette de commandes, `llmVoice.state`).
- **Speak Selection** sans sélection : propose de lire le document entier.
- **Clear Highlight** sans surlignage actif : notification, pas de no-op muet.
- **Clear Audio Cache** : confirmation puis rapport de l'espace libéré (ou
  « déjà vide » si le cache était vide).

## Aucun raccourci capturé dans le terminal

Le chord `Ctrl+Alt+V` ne s'active jamais quand le focus est dans le terminal
intégré (`!terminalFocus`) — utile pour garder `Ctrl+Alt+V` disponible pour
d'autres usages shell sans conflit.

## Mode local et badge 🔒

- **🔒 Local** : tout (texte, audio, prompts) reste sur `localhost`.
- **☁ Remote provider** : un profil pointe vers un hôte distant — affiché
  clairement avant tout envoi.
- **LLM Voice: Verify Local Mode** exécute une dizaine de vérifications
  (résolution DNS des hôtes narrator/TTS, CSP de la webview, dépendances de
  production…) et affiche le détail ; un point non vérifiable est marqué
  « à vérifier », jamais un faux vert.

## Journalisation

L'Output Channel **LLM Voice** (menu « Vue → Output ») journalise par niveau
(`error`/`warn`/`info`/`debug`, réglage `llmVoice.log.level`, défaut `info`).
Aucun niveau, y compris `debug`, ne journalise jamais une clé API, le contenu
intégral d'un document, une réponse Claude ou de l'audio — les champs longs
sont tronqués et les champs sensibles supprimés avant écriture.

## Raccourcis clavier

| Action | Raccourci |
|---|---|
| Speak Document | `Ctrl+Alt+V D` |
| Speak Selection | `Ctrl+Alt+V S` |
| Speak Clipboard | `Ctrl+Alt+V C` |
| Play/Pause | `Ctrl+Alt+V Espace` |
| Stop | `Ctrl+Alt+V X` |
| Segment suivant / précédent | `Ctrl+Alt+V N` / `Ctrl+Alt+V P` |

Tous les raccourcis sont personnalisables (`Ctrl+K Ctrl+S` puis rechercher
« LLM Voice »).
