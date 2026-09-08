# Décisions de cadrage — réponses aux questions P0/P1 de la review

> Arbitrées par Marcel (concierge) le 2026-09-08 sur réponses de guilhem-bonnet.
> Chaque décision devient un ADR en phase 2 (Archie, Opus). Le point 7 dépend
> d'une vérification factuelle en cours (agent guide Claude Code).

## P0

### D1 — `extensionKind: ["ui"]` seul pour le MVP

- **Décision** : déclarer uniquement `ui`. L'extension tourne toujours sur la
  machine de l'utilisateur (GPU, haut-parleurs, Ollama, Chatterbox).
- **Pourquoi ça marche même en Remote** : une extension UI garde l'accès complet
  à l'API VS Code (`workspace.openTextDocument`, `activeTextEditor`,
  décorations). Elle lit donc le texte d'un document distant via l'API, sans
  accès filesystem distant. Seul l'accès direct aux fichiers distants est perdu,
  et le MVP n'en a pas besoin.
- **Conséquence** : Remote SSH / Dev Container / Codespaces passent de « non
  garanti » à « supporté en lecture de document, TTS local ». Un test manuel
  Remote SSH est ajouté à la phase 6.
- **Remplace** : CdC §56 (`["ui","workspace"]`).

### D2 — Flux progressif par chunk en 0.1, streaming intra-chunk en 0.2

- **Décision** : le MVP est progressif au sens utilisateur : chaque chunk
  (1 à 3 phrases) est un WAV complet, la lecture démarre dès le premier chunk,
  le prefetch de 2-3 chunks masque la latence des suivants. Latence perçue
  au premier son : durée de synthèse d'une phrase (typiquement < 1 s sur GPU).
- **Pourquoi pas le streaming intra-chunk tout de suite** : la balise
  `<audio>` d'une Webview ne lit pas un WAV en cours d'écriture ; il faudrait
  Web Audio API avec ordonnancement de buffers PCM ou MediaSource avec
  un codec fragmentable. Ça complique pause précise, seek, cache et highlight
  pour un gain de latence marginal quand les chunks sont courts.
- **Préparation 0.2** : le contrat `TtsProvider` reçoit dès la phase 2 une
  méthode optionnelle `synthesizeStream?(req): AsyncIterable<AudioFrame>`
  et `TtsCapabilities.streaming: boolean`. Le player 0.2 basculera sur Web
  Audio API pour les providers qui l'annoncent.
- **Précise** : CdC §9, §25, §32, §63.

### D3 — Le répertoire inbox est l'unique source de vérité

- **Décision** : `~/.llm-voice/inbox/` (surchargeable par `LLM_VOICE_INBOX`
  puis par le réglage `llmVoice.claude.inboxPath`, dans cet ordre) est la
  seule source de vérité. Un message = un fichier JSON. Pas d'index dans
  `globalStorageUri`.
- **Rôle de l'extension** : surveille le dossier (`fs.watch`, repli polling
  5 s), reconstruit la liste en mémoire au démarrage, stocke uniquement
  l'état lu/non-lu dans `globalState` sous la clé du nom de fichier.
  Supprimer = supprimer le fichier. Archivage = déplacer vers `inbox/archive/`.
- **Pourquoi** : le hook (script externe, sans accès à l'API VS Code) ne peut
  écrire que dans un chemin connu ; deux sources désynchronisées est la cause
  classique de « message fantôme ». Ça ouvre aussi l'inbox à d'autres agents
  (voir D8).
- **Remplace** : CdC §38 (« index inbox » dans `globalStorageUri`).

### D4 — Protocole Webview ↔ Extension Host pour l'audio

- **Principe** : l'Extension Host possède la state machine (`PlaybackController`).
  La Webview est un lecteur passif : un seul élément `<audio>`, aucune logique
  de file. `retainContextWhenHidden: true`.
- **Messages Extension → Webview**

  | type | payload | rôle |
  |---|---|---|
  | `load` | `{chunkId, src, durationMs?, autoplay}` | charge un chunk (`src` = `webview.asWebviewUri` d'un fichier du cache) |
  | `play` / `pause` / `stop` | `{}` | contrôle |
  | `seek` | `{positionMs}` | reprise intra-chunk après pause |
  | `setRate` / `setVolume` | `{value}` | réglages live |
  | `state` | `{session, index, total, profile, title}` | ce que le player affiche |

- **Messages Webview → Extension**

  | type | payload | rôle |
  |---|---|---|
  | `ready` | `{}` | Webview initialisée, l'extension peut envoyer `load` |
  | `timeupdate` | `{chunkId, positionMs}` | throttlé à 250 ms, sert à la barre de progression et à la reprise |
  | `ended` | `{chunkId}` | déclenche le passage au chunk suivant et au highlight suivant |
  | `error` | `{chunkId, message}` | retry/skip côté extension |
  | `userAction` | `{action: play\|pause\|stop\|next\|prev\|selectProfile}` | boutons du player |

- **Sécurité** : CSP stricte avec nonce, `localResourceRoots` limité au
  dossier cache, aucun `innerHTML` sur du texte non fiable (AC-SEC-02).
- **Highlight** : piloté par l'extension sur `load` (pose la décoration du
  chunk) et `ended` (la retire). Pas de dépendance à `timeupdate` en 0.1.
- **Précise** : CdC §9, §29, §34 ; manque n°1 de la review.

## P1

### D5 — Profile Editor reporté en 0.2

- **Décision** : en 0.1, quatre profils par défaut + `Select Profile`
  (Quick Pick) + `Open Profiles` qui ouvre `profiles.json` dans l'éditeur
  avec un JSON Schema attaché (validation et autocomplétion natives VS Code).
  Créer/dupliquer/supprimer = éditer ce fichier. `Test Voice` reste une
  commande simple (lit la phrase de référence avec le profil courant).
- **Pourquoi** : UC-06 et UC-07 (P0) sont couverts sans Webview d'édition ;
  le Profile Editor riche (§49) arrive en 0.2 comme prévu §72.

### D6 — Document modifié pendant la lecture

- **Décision** : la lecture ne s'arrête jamais à cause d'une édition. Le texte
  lu est celui capturé au lancement (snapshot). Les décorations VS Code suivent
  automatiquement les insertions/suppressions, donc le highlight reste
  cohérent pour les éditions hors du segment courant.
- **Si l'édition touche un segment pas encore lu** : la session passe en
  `stale`, la status bar affiche `$(warning) Document modifié`, le highlight
  de ce segment est remplacé par un soulignement pointillé, et `Stop` puis
  `Speak From Cursor` relance sur le texte à jour. Pas de re-synthèse
  automatique (coût GPU, surprise utilisateur).
- **Si le document est fermé** : la lecture continue (audio déjà généré),
  le highlight est simplement absent.

### D7 — Installation du hook Claude Code (vérifié)

- **Faits vérifiés** (détail dans `claude-hook-verification-v1.md`) :
  `last_assistant_message` est officiel et recommandé ; l'extension VS Code
  Claude Code lit les mêmes fichiers que le CLI ; les hooks de plusieurs
  fichiers s'additionnent ; `Stop` ne concerne que l'agent principal ;
  aucun hook `Stop` n'existe aujourd'hui sur ta machine.
- **Décision** : deux voies, la première recommandée.
  1. **Plugin Claude Code `llm-voice`** embarquant `hooks/hooks.json` et le
     collector Node : voie officielle, activable/désactivable sans toucher
     à `settings.json`. Publié dans le repo sous `integrations/claude-code/plugin/`.
  2. **Commande `LLM Voice: Install Claude Code Hook`** pour ceux qui ne
     veulent pas de plugin : après consentement explicite, ajoute une entrée
     `Stop` contenant `llm-voice-capture` dans `~/.claude/settings.json`,
     après avoir vérifié son absence dans les trois fichiers de settings.
     `Uninstall` retire uniquement cette entrée. Jamais d'édition silencieuse.
- **Collector** : un seul script Node cross-platform (`llm-voice-capture.js`),
  lit stdin, écrit `inbox/<ts>-<session>-<rand>.json` en tmp+rename, 0600,
  timeout 15 s, exit 0 dans tous les cas. Remplace les trois variantes
  bash/python/powershell du CdC §59.

### D8 — Les LLM tiers sont des sources de contenu, jamais des voix (corrigé)

Correction du 2026-09-08 : la première version de D8 ajoutait à tort des
narrateurs cloud. Ce que tu veux : lire avec **notre** TTS les réponses ou
résumés produits par Copilot, Gemini, Kimi, Qwen, DeepSeek, Grok, Codex, etc.
Ces outils ne parlent jamais eux-mêmes et ne transforment rien. Le narrateur
reste celui du CdC (Ollama, llama.cpp, compatible OpenAI), optionnel.

**Un seul mécanisme commun : l'Inbox ouverte.** N'importe quel outil dépose un
fichier JSON `{schemaVersion, provider, sessionId, capturedAt, cwd, title?,
message}` dans `~/.llm-voice/inbox/`. L'extension l'affiche avec l'icône du
provider et le lit à la demande, avec n'importe quel profil. Zéro autoplay,
quelle que soit la source. Trois façons d'alimenter l'inbox, selon ce que
l'outil offre :

| Outil | Ce qu'il offre | Mécanisme LLM Voice | Version |
|---|---|---|---|
| Claude Code (CLI + extension VS Code) | hook `Stop` avec `last_assistant_message` | plugin/hook → collector Node → inbox | 0.1 |
| Codex CLI | `notify` (commande appelée en fin de tour, JSON en argument) | même collector, mode `--from codex` | 0.2, à vérifier |
| Gemini CLI | hooks de cycle de vie (à vérifier : nom de l'événement de fin de tour et présence du texte final) | même collector | 0.2, à vérifier |
| Kimi, Qwen Code, DeepSeek, Grok, autres CLI | variable selon l'outil | CLI `llm-voice-inbox add --provider <nom>` qui lit stdin : tout outil capable de lancer une commande ou de piper sa sortie peut déposer | 0.2 |
| **GitHub Copilot Chat** (VS Code) | pas d'accès à l'historique natif (CdC §45) | 0.1 : sélection ou copier → `Speak Clipboard`. 0.2 : participant `@voice` : `@voice résume ce que tu viens de faire` → la réponse est produite par le modèle Copilot via `vscode.lm`, déposée dans l'inbox, lue par notre TTS | 0.1 / 0.2 |
| Extensions VS Code tierces (Gemini Code Assist, Kimi, Qwen…) | aucune API publique de lecture du chat | sélection / presse-papiers ; pas de scraping (CdC §45) | 0.1 |
| Sortie de terminal (agents lancés dans le terminal intégré) | sélection du terminal | commande `Speak Terminal Selection` (API `Terminal.selection`, à vérifier) sinon copier → `Speak Clipboard` | 0.2 |
| Fichiers produits par un agent (rapport `.md`, `NOTES.md`) | fichier sur disque | source `WatchedFileSource` : dossier surveillé, chaque nouveau `.md` devient une entrée d'inbox | 0.2 |

**Ce qui change dans le plan** : ADR-007 devient « protocole d'inbox ouvert et
CLI `llm-voice-inbox` » ; ADR-008 « participant `@voice` ». UC-17 passe en P1.
Aucun provider narrateur cloud n'est ajouté. Le MVP 0.1 est inchangé.

### D9 — Offre TTS à trois niveaux : local, entreprise, API (proposition)

Contexte : en entreprise, on ne peut pas toujours installer Chatterbox ni un
GPU. Le CdC prévoit déjà un provider cloud en P2 (UC-16) via
`/v1/audio/speech`. Proposition d'une grille claire, même contrat
`TtsProvider`, choisie dans le profil :

| Niveau | Badge | Provider | Installation | Confidentialité | Version |
|---|---|---|---|---|---|
| 1. Local | 🔒 Local | Chatterbox, Kokoro sur `localhost` | serveur TTS sur le poste | rien ne sort | 0.1 |
| 1b. Local sans installation | 🔒 Local (système) | `SystemTtsProvider` : `say` (macOS), SAPI via PowerShell (Windows), `spd-say`/`espeak-ng` (Linux) | aucune, voix de l'OS | rien ne sort | 0.2 |
| 2. Entreprise | 🏢 Réseau interne | même provider compatible OpenAI, pointé sur un serveur TTS hébergé par la DSI (Chatterbox/Kokoro sur un GPU interne), HTTPS + jeton | zéro sur le poste | reste dans le réseau de l'entreprise | 0.2 |
| 3. API cloud | ☁ Remote provider | `OpenAICompatibleTtsProvider` (OpenAI TTS natif, tout service compatible) ; puis providers dédiés ElevenLabs, Azure Speech | clé en `SecretStorage` | le texte est envoyé au fournisseur, consentement explicite par profil | 0.2 (compatible OpenAI), 0.3 (dédiés) |

Points de conception :

- **Un seul code pour 1, 2 et 3** : `OpenAICompatibleTtsProvider` avec `baseUrl`,
  `apiKey?`, `voice`, `model`. Chatterbox-TTS-Server, un serveur d'entreprise et
  OpenAI parlent le même endpoint. Seul le niveau 1b a un code propre.
- **Garde réseau à trois listes** : `localhost` toujours autorisé ; hôtes
  d'entreprise déclarés dans `llmVoice.network.trustedHosts` (verrouillable par
  la DSI via les politiques de settings VS Code) ; tout le reste demande un
  consentement explicite et affiche ☁. TLS obligatoire hors localhost (AC-SEC-01
  étendu).
- **Voix système** : qualité inférieure, mais zéro installation, zéro réseau et
  utilisable par tous. Piste à vérifier en phase 2 : `speechSynthesis` (Web Speech
  API) dans la Webview VS Code fournit des événements `onboundary` par mot, ce qui
  donnerait le surlignage mot à mot gratuitement sur Windows et macOS.
- **Même logique pour le narrateur** (optionnel) : Ollama local, ou un endpoint
  compatible OpenAI hébergé par l'entreprise (vLLM, LiteLLM). Pas de LLM cloud
  ajouté au périmètre.
- **Profils fournis** : « Lecture fidèle (local) », « Lecture fidèle (voix
  système) », « Lecture fidèle (entreprise) » avec l'hôte à remplir.

**Recommandation** : niveau 1 en 0.1 comme prévu ; 1b, 2 et 3 (compatible
OpenAI) ensemble en 0.2, car c'est le même provider plus un petit
`SystemTtsProvider` ; providers cloud dédiés en 0.3 seulement si demandés.

## Garanties demandées le 2026-09-08 (validées « tout »)

### D10 — Garantie « rien ne sort » : prouvée, pas promise

Étude : `local-guarantee-v1.md` (18 points de sortie recensés, sources officielles).

- **Ce qui sort réellement par défaut** : `ollama pull` (volontaire), le
  téléchargement HuggingFace au premier lancement de Chatterbox ou Kokoro
  (volontaire, une fois), et l'auto-update du client desktop Ollama sur
  macOS/Windows (pas Linux). Rien d'autre dans la chaîne LLM Voice.
- **Décision** : un module unique `net/EgressGuard.ts` par lequel passe tout
  appel réseau : résolution DNS avant connexion, IP obligatoirement dans
  127.0.0.0/8 ou ::1 en mode local, refus des redirections vers un autre
  hôte, journal hôte + chemin sans jamais le corps. Webview avec
  `default-src 'none'; connect-src 'none'`. Aucune dépendance de télémétrie
  dans le VSIX. Variable `LLM_VOICE_STRICT_LOCAL=1` = mode bunker qui ignore
  même les hôtes de confiance.
- **Preuve à trois niveaux** : tests unitaires du guard ; test d'intégration
  qui intercepte la couche HTTP et prouve zéro requête sortante sur un
  scénario complet ; recette pare-feu Linux (nftables/firewalld par uid)
  fournie dans l'étude pour que tu vérifies toi-même sur ta machine.
- **Commande `LLM Voice: Verify Local Mode`** : dix contrôles, badge 🔒 Local
  seulement si tout est vert, « non vérifiable » affiché tel quel plutôt
  qu'un faux vert.
- **Honnêteté** : l'extension ne contrôle pas la télémétrie de VS Code lui-même
  ni les autres extensions ; l'étude §4 donne le réglage pour chacun. Côté
  serveur TTS, `HF_HUB_OFFLINE=1` et `HF_HUB_DISABLE_TELEMETRY=1` après le
  premier téléchargement, inscrits dans le `docker-compose.tts.yml`.

### D11 — Linux first : validé, avec deux points d'attention

Étude : `linux-first-v1.md`.

- **RDNA4** : ROCm 7.2 + PyTorch 2.9 supportent nativement gfx1201, sans
  `HSA_OVERRIDE_GFX_VERSION`. Chatterbox-TTS-Server fournit `Dockerfile.rdna4`
  et `docker-compose-rdna4.yml` avec `ROCBLAS_USE_HIPBLASLT=0` obligatoire.
  C'est le chemin retenu pour ta machine, en conteneur (`/dev/kfd`, `/dev/dri`).
- **TTS léger sans GPU, français** : Piper (voix fr_FR siwis/tom) derrière un
  petit serveur compatible `/v1/audio/speech`. Attention : `openedai-speech`
  est archivé depuis janvier 2026 ; utiliser un wrapper actif ou un wrapper
  maison d'une centaine de lignes. Kokoro reste le fallback n°2. Le niveau
  « local sans installation » de D9 devient : Piper en premier choix,
  voix système `spd-say` en dernier recours.
- **Flatpak** : audio et localhost fonctionnent ; l'exécution de binaires hôte
  (`spd-say`, `piper`) nécessite `flatpak-spawn --host`. À documenter et à
  tester ; le serveur HTTP local n'a pas ce problème, ce qui renforce le choix
  « tout passe par HTTP localhost ».
- **CI** : `xvfb-run -a` sur ubuntu-latest avec les paquets listés en §5 de
  l'étude. Déjà en place dans le squelette de phase 1.
- **Definition of Done 1.0** : la checklist §6 de l'étude (Fedora, Ubuntu LTS,
  Arch ; RPM/deb, Flatpak, Snap ; PipeWire, PulseAudio ; Wayland, X11 ;
  ROCm, CUDA, CPU seul) remplace la ligne « Linux validé » du CdC §83.

### D12 — UI : mini-player dans le Panel, container complet en option

Étude : `ui-compact-v1.md` (guidelines VS Code citées).

- **Décision** : layout « minimal » par défaut : un seul item de status bar,
  Quick Picks pour profils et inbox, CodeLens « ▶ Lire cette section » sur
  chaque heading Markdown, décorations dans l'éditeur, et une seule Webview
  View de trois lignes dans le Panel (titre et profil, barre de progression,
  cinq boutons), environ 80 px, repliable à zéro, jamais affichée vide.
  `llmVoice.ui.layout = "full"` active le container complet du CdC §6.
- **Pourquoi le Panel** : une extension ne peut pas cibler la Secondary Side
  Bar par défaut ; le Panel est prévu pour les vues de support qui
  accompagnent l'éditeur.
- **Statuts** : idle, preparing, playing, paused, stale, error, chacun avec
  son texte de status bar et son bouton central. Codicons uniquement,
  variables `--vscode-*` uniquement.
- **Raccourcis** : chord `ctrl+alt+v` puis une touche (libre, contrairement à
  `ctrl+k`), désactivables.
- **Impact CdC** : §6 (View Container) devient le mode « full » ; §8 inchangé ;
  §69 gagne les CodeLens.
