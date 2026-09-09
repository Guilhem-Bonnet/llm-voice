# Guide utilisateur — LLM Voice

Extension VS Code de lecture vocale locale : Markdown, sélection, presse-papiers
et (bientôt) réponses de Claude Code, avec surlignage synchronisé et profils
de voix configurables. Voir `docs/install-linux.md` (installation détaillée
des serveurs), `docs/providers.md` (choix d'un moteur TTS/narrateur) et
`docs/voices.md` (clonage de voix).

## Installation rapide

1. Installer VS Code ≥ 1.95, puis l'extension (`.vsix`, `docs/install-linux.md`
   §1 pour les caveats Flatpak/Snap).
2. Installer et démarrer un serveur TTS local — Chatterbox (recommandé,
   `docker-compose.tts.yml`) ou Kokoro (léger, sans GPU) : `docs/providers.md`.
3. (Optionnel) Installer Ollama pour la narration transformée (résumé,
   pédagogie) : `docs/install-linux.md` §2.
4. Aucune clé, aucun compte requis en usage 100 % local — le badge
   **🔒 Local** de la status bar confirme qu'aucun contenu ne quitte la machine.

## Premier « Speak Document »

1. Ouvrir un fichier `.md` (ou tout fichier texte pour une sélection).
2. Palette de commandes → **LLM Voice: Speak Document** (ou raccourci
   `Ctrl+Alt+V D`).
3. Le segment en cours de lecture est surligné dans l'éditeur ; les contrôles
   Play/Pause/Stop/Précédent/Suivant sont dans le mini-player (vue « LLM
   Voice ») et dans le menu de la status bar.
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
| Serveur TTS injoignable | « Chatterbox is unavailable. » | **Retry** (relance seulement le passage en échec, sans tout redémarrer) / **Open provider settings** |
| Narrateur injoignable | « LLM Voice: Narrator unavailable » | **Retry** / **Read without narration** (bascule en lecture fidèle) / **Cancel** |
| Un passage échoue après plusieurs tentatives | « LLM Voice: audio chunk failed after N retries. » | **Skip** (passe au suivant) / **Stop** |

Un serveur qui charge encore son modèle (statut « Loading ») fait patienter
la première lecture quelques secondes au lieu d'échouer immédiatement.
Un provider complètement hors ligne n'empêche jamais l'extension de démarrer
— la status bar passe simplement à l'état `$(error)`.

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
