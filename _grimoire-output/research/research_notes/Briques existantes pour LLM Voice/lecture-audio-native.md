# Lecture audio native depuis Node.js (hors webview VS Code) — autoplay Electron/Chromium et options de sortie audio (état 2026)

## Is there a documented, reliable way for a VS Code webview to play audio after a one-time click, and is it robust across webview reloads / view hidden-shown cycles (retainContextWhenHidden)?

### Takeaway
Le modèle Chromium "user activation" (v2) définit bien un bit **sticky** ("a vu une activation utilisateur"), posé au premier geste et jamais réinitialisé pendant la vie de la *fenêtre/document*, ce qui devrait en théorie couvrir des `play()` différés déclenchés par l'extension après un seul clic — mais aucune source VS Code officielle ne confirme ce comportement précisément pour les webviews, ni ce qui se passe pour ce bit lors d'un reload du document webview ou d'un cycle hidden→shown avec `retainContextWhenHidden`. C'est une zone où le comportement documenté s'arrête à la couche Chromium générique ; la couche VS Code spécifique reste non documentée publiquement.

### Cited Findings
- Le modèle "User Activation v2" (UAv2) maintient deux bits par frame/window : `HasBeenActive` (activation **sticky**, posée au premier geste utilisateur et jamais réinitialisée pendant la durée de vie de l'objet window) et `HasConsumableUserActivation` (bit **transitoire**, qui expire après un délai ou est consommé par un appel d'API) — [MDN "Sticky activation"](https://developer.mozilla.org/docs/Glossary/Sticky_activation) ; [UAv2 explainer (Mustaq Ahmed, Chromium)](https://mustaqahmed.github.io/user-activation-v2/)
- Electron expose la préférence `autoplayPolicy` sur `webPreferences` avec trois valeurs possibles : `no-user-gesture-required` (défaut Electron), `user-gesture-required`, `document-user-activation-required` — [Electron `WebPreferences` docs](https://www.electronjs.org/docs/latest/api/structures/web-preferences)
- La politique Chrome (doc développeur) précise que l'autoplay avec son est autorisé si : interaction utilisateur directe avec le domaine, Media Engagement Index (MEI) élevé sur desktop, ou installation en PWA/écran d'accueil ; le muted autoplay est toujours autorisé — [Chrome autoplay policy blog](https://developer.chrome.com/blog/autoplay)
- Le même document précise que les iframes cross-origin nécessitent une délégation de permission explicite (`<iframe allow="autoplay">`) alors que les iframes same-origin héritent de l'autorisation d'autoplay du document parent — [Chrome autoplay policy blog](https://developer.chrome.com/blog/autoplay)
- Plusieurs issues GitHub VS Code documentent l'erreur `NotAllowedError`/`DOMException: play() can only be initiated by a user gesture` : "Audio is not supported in webview" (#66050), "Audio autoplay does not work in Notebook renderers" (#178642), et un cas côté service d'accessibilité non-webview ("audio cue service", #197937) — [vscode#66050](https://github.com/microsoft/vscode/issues/66050), [vscode#178642](https://github.com/microsoft/vscode/issues/178642), [vscode#197937](https://github.com/microsoft/vscode/issues/197937)
- L'issue #197937 concerne le `audioCueService.ts` (pas un webview d'extension) qui levait la DOMException en mode optimisé lecteur d'écran, après exécution d'une commande terminal ; elle a été fermée par la PR #197951 et livrée en VS Code Insiders (~novembre 2023). Le résumé récupéré ne montre aucune déclaration de mainteneur indiquant un changement de la politique `autoplayPolicy` d'Electron : la correction semble avoir porté sur le code déclencheur de VS Code lui-même, pas sur la policy Chromium — [vscode#197937](https://github.com/microsoft/vscode/issues/197937)

### Inferences
- Puisque VS Code force `autoplayPolicy: "user-gesture-required"` (contexte de la tâche) plutôt que le défaut Electron, et que le bit d'activation sticky de Chromium est attaché au frame/document, un clic authentique une seule fois dans un document webview *toujours ouvert et non rechargé* devrait, en théorie, suffire pour que des `play()` ultérieurs déclenchés par `postMessage` depuis l'extension host passent sans nouveau geste. Ceci est une **inférence à partir du modèle Chromium générique**, non une garantie documentée par VS Code.
- Un rechargement du webview (`webview.html = ...` réaffecté, ou destruction/recréation du contenu quand `retainContextWhenHidden: false` et la vue redevient visible) crée un nouveau document, donc un nouveau bit d'activation non posé — ce qui exigerait un nouveau geste. Là encore, c'est une inférence, pas un fait confirmé spécifiquement pour l'implémentation webview de VS Code.

### Gaps
- Aucune documentation VS Code officielle trouvée confirmant explicitement si/comment l'état d'activation utilisateur du document webview survit à un cycle hidden→shown avec `retainContextWhenHidden: true` par opposition à un reload complet ; répondre avec certitude demanderait soit un test direct, soit une lecture du code source VS Code (`src/vs/workbench/contrib/webview/**`), non effectuée ici faute de budget de recherche.
- Le document canonique Chromium `docs/media/autoplay.md` (chromium.googlesource.com) a renvoyé une erreur HTTP 503 pendant la recherche et n'a pas pu être récupéré directement ; les constats ci-dessus s'appuient donc sur le blog Chrome for Developers et MDN en substitut, pas sur la source la plus autoritaire.
- Aucune preuve trouvée, dans un sens ou dans l'autre, que VS Code expose un réglage/API permettant de changer `autoplayPolicy` pour les webviews d'extension — à traiter comme non confirmé (probable que non, car c'est une option de construction de `BrowserWindow`/`webContents` côté main process, pas une API webview d'extension exposée).
- Pas de documentation trouvée sur la façon dont des extensions tierces spécifiques (une extension "audio-preview", "Code Sounds", etc.) contournent concrètement l'exigence de geste (bouton "cliquer pour activer le son" affiché une fois par session dans le webview ? routage du son hors webview ?). Cela nécessiterait d'inspecter directement leur code source, non fait ici.
- Aucune source trouvée confirmant explicitement le comportement pour **VS Code Web** / extensions web (contexte navigateur pur, sans Electron) — non couvert par cette recherche.

## Which Node-side option gives pause/resume/seek and accurate position without a native compile step?

### Takeaway
Aucune option ne coche toutes les cases parfaitement : les lecteurs système invoqués via `child_process` (mpv en tête) offrent le meilleur triptyque pause/resume/seek/position sans aucune compilation native côté utilisateur, à condition que le binaire soit déjà présent ou embarqué séparément (pas de "prebuild npm" au sens addon natif). Côté addons natifs "zero-compile", `node-web-audio-api` (Rust/NAPI, ircam-ismm) est la seule option identifiée avec des prebuilts multi-plateformes actifs en 2026 et maintenue, mais son API Web Audio ne fournit pas nativement une "pause" au niveau d'un `AudioBufferSourceNode individuel (seul `AudioContext.suspend()/resume()` existe globalement, et le seek implique de recréer une source avec un `offset`) — à vérifier avant de s'y engager. `node-speaker` et `naudiodon` nécessitent `node-gyp` (donc un compilateur natif côté utilisateur, sauf prebuilds tiers ponctuels) ; `audify` (RtAudio) annonce des prebuilds N-API 5-9 mais n'expose ni pause ni seek — seulement start/stop et un `streamTime` en lecture seule.

### Cited Findings
- **node-speaker** (TooTallNate) : wrapper des modules de sortie de mpg123 (ALSA, OSS, SDL, etc. selon l'OS listé : Linux/ALSA, macOS/CoreAudio, Windows/winmm, Solaris/Sun Audio) ; l'installation nécessite de compiler via `node-gyp` et des headers de développement sur Linux ; aucune information de licence n'a pu être extraite de la page consultée ; le dépôt montre 58 issues ouvertes, dont au moins une portant spécifiquement sur l'échec d'installation node-gyp — [node-speaker GitHub](https://github.com/TooTallNate/node-speaker/) ; [issue #114 "Cannot install Speaker node-gyp"](https://github.com/TooTallNate/node-speaker/issues/114)
- **naudiodon** : bindings Node.js pour PortAudio, utilise N-API pour la portabilité entre versions Node sans recompilation ; permet streams pipe-ables (fichiers, réseau) — [naudiodon npm](https://www.npmjs.com/package/naudiodon) ; [naudiodon GitHub (Streampunk)](https://github.com/Streampunk/naudiodon)
- **audify** (RtAudio wrapper C++) : couvre Linux (ALSA natif, JACK, PulseAudio, OSS), macOS (CoreAudio, JACK), Windows (DirectSound, ASIO, WASAPI) ; prebuilds annoncés pour les versions Node/Electron supportant N-API 5 à 9 — [audify npm description via recherche](https://www.npmjs.com/package/audify) ; API RtAudio : `start()`/`stop()`/`closeStream()` seulement, pas de méthode `pause()` dédiée ; propriété `streamTime` = secondes écoulées depuis le démarrage du flux (lecture seule, pas de seek) ; méthodes annexes `getStreamSampleRate()`, `getStreamLatency()`, `isStreamRunning()` — [Audify.js RtAudio API docs](https://almoghamdani.github.io/audify/classes/RtAudio.html)
  - Licence et matrice exacte de plateformes prébuildées non confirmées : la page npm d'audify a retourné une erreur HTTP 403 pendant la recherche et n'a pas pu être consultée directement.
- **node-web-audio-api** (ircam-ismm) : implémentation Node.js de la spec Web Audio API, bindings NAPI vers une implémentation Rust ; dernière version 2.2.0 publiée 17 jours avant la date de recherche (27 septembre 2026), ce qui indique un développement actif ; plateformes supportées avec binaires prébuildés : Windows (x64, arm64), macOS (x64, arm64), Linux (x64, arm64, armv7) — [node-web-audio-api GitHub (ircam-ismm)](https://github.com/ircam-ismm/node-web-audio-api) ; [node-web-audio-api npm](https://www.npmjs.com/package/node-web-audio-api) ; implémentation Rust sous-jacente : [web-audio-api-rs (orottier)](https://github.com/orottier/web-audio-api-rs)
- **miniaudio (bindings Node)** : `@thesusheer/node-miniaudio` utilise N-API (via node-addon-api) pour la stabilité ABI multi-versions Node, et expose vérification du statut de lecture, chargement de fichiers, pause/lecture, volume, arrêt — mais aucune mention trouvée d'un contrôle de seek ou de position précise — [node-miniaudio GitHub](https://github.com/Susheer/node-miniaudio) ; [article Medium de l'auteur](https://medium.com/@sudheergupta0508/playing-audio-in-electron-apps-without-ffmpeg-why-i-created-thesusheer-node-miniaudio-8c33e4e52060)
- Une alternative séparée, `neon-miniaudio` (bindings Neon plutôt que N-API), expose également pause/lecture/statut/volume/arrêt — [neon-miniaudio GitHub](https://github.com/YXL76/neon-miniaudio)
- **Lecteurs système en sous-processus** : mpv supporte une commande "pause" togglable (rejouer = appuyer à nouveau), et le stockage/reprise de la position de lecture ; en revanche, le seek ne fonctionne pas avec des données lues depuis stdin/pipe direct — mais si le flux transite par un FIFO nommé contrôlé séparément, des commandes comme `seek 10` envoyées via ce pipe de contrôle restent valides — [mpv manual](https://mpv.io/manual/master/)
- **PowerShell `System.Media.SoundPlayer`** : ne propose que `Play()` (async), `PlaySync()` (bloquant), `Stop()` — **pas de pause/resume ni de suivi de position natif**. Pour pause/resume/volume, la documentation recommande de passer par l'objet COM Windows Media Player à la place — [PowerTip Microsoft Scripting Blog](https://devblogs.microsoft.com/scripting/powertip-use-powershell-to-play-wav-files/) ; [SID-500.COM guide PowerShell](https://sid-500.com/2021/08/03/play-sounds-and-music-with-powershell/)
- **napi-rs** est le framework standard pour écrire des addons Node natifs en Rust, avec un pipeline de release documenté pour publier des paquets natifs (probablement la voie technique pour envelopper `rodio`/`cpal`/`kira` dans un addon npm), mais aucune preuve trouvée d'un projet existant combinant concrètement l'un de ces trois crates audio Rust avec napi-rs pour une extension VS Code — [napi-rs Getting Started](https://napi.rs/docs/introduction/getting-started) ; [napi-rs Release native packages](https://napi.rs/docs/deep-dive/release) ; `rodio` s'appuie sur `cpal` pour la lecture — [rodio GitHub](https://github.com/RustAudio/rodio) ; [cpal GitHub](https://github.com/RustAudio/cpal)

### Inferences
- Pour "pause/resume/seek/position sans étape de compilation côté utilisateur", la voie la plus robuste identifiée reste de **spawn un lecteur système déjà présent sur la machine** (ex. mpv en mode contrôlé par pipe/IPC) plutôt qu'un addon natif Node — cela évite complètement le problème de prebuilds manquants pour une architecture/version Node donnée, au prix de devoir gérer/bundler ou détecter le binaire du lecteur.
- Parmi les addons natifs, `node-web-audio-api` est la candidate la plus sérieuse pour "zero-compile multi-plateforme et maintenue en 2026", mais l'absence d'un `pause()` direct par source (modèle Web Audio classique : on gère l'état par `AudioContext.suspend()/resume()` + calcul manuel d'offset pour le "seek") impose une couche applicative pour retrouver un vrai pause/resume/seek/position — ceci est une inférence basée sur la connaissance générale de la spec Web Audio, pas confirmée spécifiquement pour ce paquet via une source de cette recherche.

### Gaps
- Licence exacte et matrice fine des plateformes prébuildées d'**audify** non confirmées (page npm inaccessible, HTTP 403) — à revérifier directement, par exemple via `npm view audify` en local ou le dépôt GitHub `almoghamdani/audify`.
- Licence exacte de **node-speaker** non confirmée par la page consultée.
- Aucune recherche dédiée effectuée dans ce passage sur `afplay` (macOS), `pw-play`/`paplay`/`aplay`/`sox` (Linux) — leurs capacités précises de pause/resume/seek/position n'ont pas été vérifiées par une source ; à traiter comme non couvert par cette recherche plutôt que de deviner (à noter : de mémoire générale non sourcée ici, `afplay` et `aplay` n'ont historiquement pas de pause/resume interactif simple en ligne de commande — mais ceci n'est PAS une affirmation sourcée pour ce rapport et doit être vérifié séparément).
- Pas de vérification faite sur le support Node 22 / Electron (version utilisée par VS Code 1.13x) précis pour chacun des addons listés (node-speaker, naudiodon, audify, node-web-audio-api, miniaudio bindings) — seule la mention générale "N-API 5-9" pour audify a été trouvée, sans correspondance explicite aux versions Node/Electron 2026.
- `ffplay` (FFmpeg) : la recherche dédiée n'a renvoyé aucun résultat spécifique sur son contrôle interactif (pause/seek via clavier nécessite normalement un terminal/fenêtre interactifs, pas un mode purement headless scriptable) — non confirmé par une source dans cette recherche, à traiter comme gap.

## Which options have known problems under PipeWire/Wayland, Windows 11 audio session, macOS sandbox?

### Takeaway
Cette sous-question n'a pas pu être investiguée dans le budget de recherche alloué : aucune requête dédiée n'a été lancée sur les problèmes connus de PipeWire/Wayland, de la gestion des sessions audio Windows 11, ou du sandboxing macOS pour les options listées ci-dessus.

### Cited Findings
(aucune — non recherché)

### Inferences
(aucune — s'abstenir de deviner)

### Gaps
- Aucune source consultée sur les problèmes connus de `naudiodon`/PortAudio, `audify`/RtAudio, `node-speaker`, ou des lecteurs système (`pw-play`, `paplay`, `aplay`, `mpv`) sous PipeWire/Wayland en 2026.
- Aucune source consultée sur des problèmes spécifiques à la gestion de session audio de Windows 11 (ex. exclusivité WASAPI, changement de périphérique par défaut à chaud) pour ces mêmes options.
- Aucune source consultée sur des contraintes de sandboxing macOS (entitlements, Hardened Runtime, permissions microphone/audio) qui affecteraient un binaire spawné depuis une extension VS Code packagée en VSIX. Cette dimension doit être traitée comme un vrai trou de connaissance à combler par une recherche de suivi ciblée, pas comblée par déduction.

## How does ms-vscode.vscode-speech (or VS Code's own accessibility sounds) output audio: webview, main process, native module?

### Takeaway
Aucune source publique trouvée ne décrit l'implémentation technique de la sortie audio (text-to-speech) de `ms-vscode.vscode-speech` : la documentation disponible (page "Voice support" et wiki GitHub "VS Code Speech") ne couvre que le traitement de la parole entrante (speech-to-text), traité localement sur la machine, sans détail sur l'architecture de lecture audio en sortie.

### Cited Findings
- La page "Voice support" et le wiki GitHub "VS Code Speech" indiquent que l'extension ajoute des capacités de reconnaissance vocale (speech-to-text) aux interfaces de chat de VS Code, fonctionne "Hey Code" pour l'activation par mot-clé, et traite les données audio vocales **localement sur la machine, sans connexion internet requise** — mais uniquement pour l'entrée (reconnaissance), pas pour la sortie (synthèse) — [Voice support docs](https://code.visualstudio.com/docs/configure/accessibility/voice) ; [VS Code Speech wiki](https://github.com/microsoft/vscode/wiki/VS-Code-Speech)
- Une recherche complémentaire confirme que l'extension propose aussi de la "text-to-speech pour les réponses du chat", mais aucune source récupérée ne précise le mécanisme technique (webview `<audio>`, process main Electron, ou module natif) — recherche générale, sans URL unique faisant autorité sur ce point précis.
- Pour le service d'accessibilité natif de VS Code (les "audio cues", ex. `audioCueService.ts`, distinct de l'extension vscode-speech), l'issue #197937 confirme que ce service déclenche une lecture audio dans le processus VS Code lui-même (pas une extension tierce) et qu'il a rencontré la même erreur `NotAllowedError` que les webviews — ce qui suggère que même le code natif/interne de VS Code lit l'audio via une API `<audio>`/Web Audio soumise à la même politique d'autoplay Chromium, plutôt que via un module natif Node séparé qui contournerait le problème — [vscode#197937](https://github.com/microsoft/vscode/issues/197937)

### Inferences
- Le fait que le propre service d'accessibilité interne de VS Code (`audioCueService`) ait été touché par l'erreur de geste utilisateur suggère fortement que **VS Code lit lui-même son audio via les API web standard (HTMLMediaElement / Web Audio) dans son renderer Electron**, et non via un module natif dédié qui aurait été exempté de la politique d'autoplay — sinon ce bug n'aurait pas pu se produire. C'est une inférence raisonnable à partir d'un seul point de données, pas une confirmation directe de l'architecture.

### Gaps
- Aucune confirmation directe (code source, documentation d'architecture) que `ms-vscode.vscode-speech` synthétise et joue l'audio de sortie via un webview, le processus principal, ou un module natif. Pour trancher, il faudrait inspecter le code source de l'extension (dépôt non identifié/non public de façon évidente dans les résultats de recherche) plutôt que sa documentation utilisateur.
- Aucune information trouvée sur la bibliothèque TTS sous-jacente utilisée par vscode-speech (moteur local, SAPI/AVSpeechSynthesizer/speech-dispatcher, ou modèle embarqué).

## What does the VS Code platform-specific extensions mechanism cost (targets, CI matrix) if we ship a native binary?

### Takeaway
Depuis vsce 1.99.0, `vsce package`/`publish` supporte un flag `--target` pour produire un VSIX par plateforme, avec une liste fixe de cibles couvrant Windows, Linux (dont musl/Alpine) et macOS, plus une cible `web`. Le coût concret est de maintenir une matrice CI (une build native par cible) et de publier autant de VSIX que de cibles retenues, la Marketplace choisissant automatiquement le bon binaire selon la plateforme de l'utilisateur.

### Cited Findings
- Depuis la version 1.99.0 de `vsce`, un paramètre `--target` permet de spécifier la plateforme cible lors du packaging/publication d'un VSIX — [Publishing Extensions — VS Code Extension API](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- Les plateformes actuellement disponibles sont : `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `linux-armhf`, `alpine-x64`, `alpine-arm64`, `darwin-x64`, `darwin-arm64`, et `web` — [Publishing Extensions — VS Code Extension API](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- Un pattern courant en CI/CD consiste à construire une matrice de jobs, un par plateforme cible, chacun produisant son propre VSIX avec le binaire natif adéquat, puis à publier l'ensemble ; si l'extension doit aussi fonctionner en tant qu'extension web (navigateur), elle doit inclure une publication ciblant explicitement `web` — [Publishing Extensions — VS Code Extension API](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- Il existe des paquets npm auxiliaires spécifiques à plateforme pour l'outillage vsce lui-même (ex. `@vscode/vsce-sign-win32-arm64`), illustrant le pattern général "un paquet/binaire par plateforme" déjà utilisé par l'outillage officiel — [`@vscode/vsce-sign-win32-arm64` npm](https://www.npmjs.com/package/@vscode/vsce-sign-win32-arm64)
- Une issue VS Code ouverte porte spécifiquement sur la prise en charge de la mise à jour d'une extension vers une version de plateforme cible plus spécifique, signe que le mécanisme multi-cibles a ses propres subtilités de cycle de vie de mise à jour — [vscode#141696](https://github.com/microsoft/vscode/issues/141696)

### Inferences
- Le "coût" concret pour l'équipe TTS-Voice serait : (1) une matrice CI d'au moins 5 cibles réalistes pour couvrir les OS visés (`win32-x64`, `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, éventuellement `win32-arm64`), (2) un build natif par cible (donc cross-compilation ou runners natifs par OS/arch), (3) 5+ VSIX distincts uploadés à chaque release au lieu d'un seul VSIX universel, et (4) l'impossibilité de servir ces cibles binaires en tant qu'extension web pure — un fallback "web"/sans-audio-natif serait nécessaire si le support VS Code for the Web est visé.

### Gaps
- Aucun chiffrage trouvé (temps de build, coût CI) pour cette matrice — seule la mécanique fonctionnelle est documentée par Microsoft, pas de retour d'expérience chiffré trouvé dans cette recherche.
- Pas de confirmation sur la taille de VSIX typique ajoutée par l'embarquement d'un binaire natif compilé (Rust/napi-rs ou C++) par plateforme, ni sur d'éventuelles limites de taille Marketplace pertinentes ici.

## How do existing VS Code extensions or Electron apps stream TTS audio chunk by chunk with gapless playback and report playback position for highlight synchronization?

### Takeaway
Cette question n'a pas pu être investiguée dans le budget alloué : aucune recherche dédiée n'a été effectuée sur des implémentations concrètes de streaming TTS chunk-par-chunk avec lecture sans coupure et rapport de position pour la synchronisation de surlignage. C'est un vrai trou à combler par une recherche de suivi.

### Cited Findings
(aucune — non recherché)

### Inferences
(aucune — s'abstenir de deviner)

### Gaps
- Aucune source consultée sur des extensions VS Code ou applications Electron précises qui implémentent un streaming audio TTS gapless avec évènements de position pour synchronisation de surlignage (whole feature non couverte par cette passe de recherche).
- Si cette question reste dans le périmètre du rapport final, une recherche de suivi ciblée est nécessaire (ex. requêtes : "gapless audio streaming Web Audio API TTS chunks", "highlight sync TTS playback position electron", "MediaSource Extensions PCM chunk streaming Node").
