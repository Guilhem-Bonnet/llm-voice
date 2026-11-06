# Revue indépendante — GAO-refonte-ux-0-005 (galerie de voix)

Relecteur : Kael (security-auditor), 2026-11-06. Périmètre : HEAD d8b2352, `vscode-extension/src/views/voiceGallery/`, `media/voiceGallery/`, appels dans `Pipeline.ts` (l. 1141-1340) et `commands/index.ts` (l. 124-125), tests listés dans le brief. Aucun code modifié.

## Verdict : READY (sous réserve de traiter ou d'accepter explicitement les 3 points « important »)

Aucun défaut bloquant : aucune exécution, aucune requête hors boucle locale, aucune lecture et aucun chemin contrôlé par la page n'ont pu être provoqués par un message hostile. Trois points importants sont à corriger ou à accepter par écrit avant le merge.

## Exécuté / non exécuté

- Exécuté : `npm run test:unit` dans `vscode-extension` : `Test Files 125 passed (125)`, `Tests 2617 passed (2617)`, exit 0 (7,78 s). Même chiffre que l'evidence-pack.
- Non exécuté : `test:integration-voice` et `vscode-test` (VS Code + xvfb + serveur factice, hors consigne « pas de banc audio ») ; ses chiffres (22 passing) ne sont pas vérifiés par moi. Aucun test de mutation lancé. macOS et Windows : non vérifié.

## Ce qui est tenu (vérifié par lecture du code et des tests)

1. Messages : `parseGalleryMessage` (galleryModel.ts:342-380) est une liste blanche stricte. `voiceId` doit être dans un `Set` figé (le `__proto__` ne passe pas), `requestId` entier sûr, `engine` et `target` en énumération, phrase `trim()` puis ≤ 300 (l. 358-359). Refus journalisé par son type seulement, nettoyé en `[a-zA-Z]{0,24}` (Controller.ts:286-291). Aucun champ chemin ou URL n'est accepté, sauf `openLink.url`, comparé en entier à 7 URL https figées (Controller.ts:124, galleryModel.ts:322), puis `Uri.parse(url, true)` (Pipeline.ts:1227). La page n'a aucun moyen de produire l'URI audio : `trialAudio.uri` vient de l'hôte.
2. trialAudioStore : nom = sha256 hex + extension d'une liste fermée de 4 (trialAudioStore.ts:18-24, 43-47). Aucune traversée possible depuis la page. Écriture atomique tmp + rename. Texte jamais écrit sur disque, seulement l'audio.
3. CSP (voiceGalleryHtml.ts:21-35) : `default-src 'none'`, `script-src 'nonce-…'` (24 octets aléatoires, playerHtml.ts:21), `media-src ${cspSource}` sans `blob:`, `connect-src 'none'`, pas d'`unsafe-*`. Le HTML n'interpole que nonce et 3 URI produites par VS Code. Aucun libellé, nom de voix ni phrase n'entre dans le HTML. Côté page, tout passe par `textContent` ; `style.width` reste permis sous `style-src`. `localResourceRoots` = `media/voiceGallery`, `media/voices`, `globalStorage/gallery-trials` (Panel.ts:38-42), rien d'autre. Le dossier de la galerie ne contient que `.js` et `.css`.
4. Lecture et requêtes sans clic : le JS n'appelle `audio.play()` que depuis `play()`, appelé par un clic ou par la réponse à une requête cliquée (`settlePending` ignore toute réponse dont le `requestId` n'est pas en attente, voiceGallery.js:452-457). Le seul trafic sans clic est `GET /health` sur boucle locale (`probe`, Controller.ts:220-243, garde `isLoopbackUrl`), à l'ouverture et au retour d'onglet.
5. Commande à copier : `copyCommand` ne fait que `writeClipboard` (Controller.ts:117-122). Aucun terminal, aucun `executeCommand` de démarrage. Le port inséré vient de `new URL().port`, donc des chiffres uniquement : pas d'injection dans la commande.
6. Serveur d'essai : l'URL vient de la voix enregistrée (`engineUrl`, galleryModel.ts:78-83), pas de la page. L'essai passe par `tts.synthesize` → `this.egress.fetch` (KyutaiPocketProvider.ts:173, OpenAICompatibleTtsProvider.ts:164). `EgressGuard` s'applique donc : hors boucle locale, refus en mode `local` (EgressGuard.ts:~188-194), DNS-rebinding vérifié. L'essai ne contourne pas la garde.
7. Choisir : `bindingForEntry` fabrique un binding neuf (galleryModel.ts:94-114) et `bindingForEngineVoice` retire `referenceAudio` (cause A) ; engine + voix + URL partent dans un seul `setGlobalVoice`. Le test d'intégration compare `global-voice.json` à `{providerId, baseUrl, voice, speed}` exact (voice-gallery.test.ts:138-152). Écriture qui échoue : notice, carte inchangée (test voiceGalleryController.test.ts:179).
8. Course Annuler / réponse tardive : côté page, une réponse sans requête en attente est ignorée (test behavior l. 394). Côté hôte, `if (!controller.signal.aborted)` avant `trialAudio` (Controller.ts:182) et pas de `trialError` sur abandon (l. 186).
9. Piper : le téléchargement passe par `llmVoice.installPiperVoice` qui demande un consentement (Pipeline.ts:1777-1807). Le texte part en stdin pour piper et après `--` pour espeak (SystemTtsProvider.ts:359, 382).

## Défauts

### IMPORTANT

I1. Commande Docker copiée qui publie Kokoro sur toutes les interfaces, alors que la page dit « il tourne uniquement sur votre machine ».
- galleryModel.ts:173 : `docker run --rm -p ${port ?? "8880"}:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest`. Sans `127.0.0.1:`, Docker publie sur `0.0.0.0` (et contourne souvent firewalld/ufw). Le bandeau voiceGallery.js:383-384 affirme le contraire. `deploy/docker-compose.tts.yml:92` utilise bien `"127.0.0.1:8004:8004"`, donc la politique du projet est connue.
- Scénario : l'utilisateur copie la commande du bandeau, un autre poste du réseau local interroge `:8880` sans authentification (CPU et service exposés), et l'invariant P0 « local-first » est faux dans le texte affiché.
- Correction : `-p 127.0.0.1:${port}:8880`, et un test sur `startCommand("kokoro", …)` (aucun test n'existe sur le contenu de cette commande ; `startCommand` n'est vérifié que pour kyutai, voiceGalleryController.test.ts:418).

I2. Texte de la phrase d'essai passé sans `--` à `say` (macOS), reçu de la page.
- SystemTtsProvider.ts:386-399 : `buildSayInvocation` met `ctx.text` en dernier argument sans `--`, contrairement à espeak (l. 359). Une phrase d'essai commençant par `-` est lue comme une option : `-o/chemin` redirigerait la sortie audio vers un fichier choisi (écrasement), `-f fichier` lirait un fichier. La nouvelle surface expose ce chemin à une chaîne venue de la page (≤ 300 caractères, aucun filtre).
- Non vérifié : pas de macOS ici, et le comportement exact de `getopt` de `say` est supposé. Défaut préexistant hors du diff, mais atteint par la galerie. Même famille : une phrase débutant par « - » (liste Markdown) fait échouer la lecture normale.
- Correction : `--` avant le texte, ou stdin (`-f -`) ; test d'invocation avec un texte `-o/tmp/x`. Si macOS n'est pas dans le périmètre de cette carte, l'accepter par écrit et ouvrir une carte.

I3. Pas de coordination avec une lecture en cours : sons superposés.
- Le `<audio>` de la page (voiceGallery.js:241-261) est indépendant du Core natif et du lecteur ; rien dans Pipeline.ts:1205-1234 ni dans le contrôleur ne met en pause ou n'atténue la lecture. Scénario courant : une lecture longue joue, Guilhem ouvre la galerie pour changer de voix et clique Écouter ; les deux voix parlent ensemble pendant la durée de l'échantillon (≈ 5 à 20 s). Réversible (Arrêter), mais c'est précisément le geste que la galerie sert.
- Je le classe « important » plutôt que « mineur » pour l'usage, pas pour la sécurité. À décider avec l'utilisateur (pause de la lecture au clic Écouter, ou assumer et documenter dans l'écoute AC-003).

### MINEUR

M1. Audio qui continue onglet masqué. `retainContextWhenHidden: true` (Panel.ts:36) et aucun `visibilitychange` côté page. Un échantillon lancé puis un changement d'onglet continuent jusqu'à la fin ; pire, une génération en attente joue à l'arrivée même si l'onglet est caché. Durée bornée (≤ ~20 s), initié par un clic. Correction simple : `silence()` au masquage, ou annuler le pending.

M2. Texte de la phrase potentiellement dans le journal et la page via le corps d'erreur du serveur. Controller.ts:187-188 journalise `messageOf(error)` (Output) et le renvoie à la page ; KyutaiPocketProvider.ts:190-203 `errorDetail` renvoie le corps brut quand `detail` n'est pas une chaîne. Un 422 de type FastAPI qui renvoie `input` recopierait la phrase. Non vérifié sur le vrai `pocket-tts` ; le logger ne masque que des secrets (`core/redact.ts`), pas du texte libre. Correction : tronquer et ne pas inclure le corps, ou n'afficher que le statut HTTP pour l'essai.

M3. Rétention sur disque. `gallery-trials` garde 30 fichiers audio de phrases saisies, sans purge à la fermeture ni à la désactivation (trialAudioStore.ts:15, 55-64). Rien ne quitte la machine, mais l'audio d'un texte tapé (éventuellement sensible) survit à la session. Pas de plafond de taille d'un fichier (`arrayBuffer()` non borné, l. 49 ; borné en pratique par 300 caractères et un serveur local de confiance). Purge à la fermeture de l'onglet ou à l'activation suggérée.

M4. Course d'écriture dans le magasin d'essais. `tmp-${process.pid}` identique pour deux écritures de la même clé (trialAudioStore.ts:48) : deux essais identiques qui se chevauchent peuvent faire échouer le second `rename` (ENOENT). `prune` fait `stat` sur chaque nom listé (l. 59-61) : un fichier renommé ou supprimé entre `readdir` et `stat` lève ENOENT après que l'audio a été écrit, et l'essai affiche une erreur alors que le fichier existe. Fenêtre étroite ; corriger avec un nom tmp aléatoire et un `stat` tolérant.

M5. `findTrial`/`storeTrial` n'imposent pas que la clé soit un hexadécimal de 64 caractères (trialAudioStore.ts:27, 41). Sûr aujourd'hui (seul `trialKey` les appelle), mais la protection contre la traversée tient à l'appelant ; les tests passent `"k"`, `"old"`. Défense en profondeur : valider `/^[0-9a-f]{64}$/`.

M6. Annulation perdue pendant la préparation d'un essai. Controller.ts:153 annule l'ancien essai, mais `this.trial` n'est posé qu'en l. 165, après `await getGlobalVoice` et `isPiperInstalled`. Un `cancelTrial` reçu entre-temps ne correspond à rien et l'essai part quand même vers le moteur. La page ignore la réponse (pas de son), donc seule une requête est gaspillée.

M7. État de la carte si l'effet de bord échoue après l'écriture. `applyBinding` = `setGlobalVoice` puis `afterGlobalVoiceChange` (Pipeline.ts:1212-1215, 1313-1321). Si `refreshLocalModeBadge` ou `resolveReading` lève après l'écriture réussie, le contrôleur envoie une notice d'erreur, ne rediffuse pas l'état (`notifyVoiceChanged` n'est pas atteint) et la carte montre l'ancienne voix alors que le fichier a changé. Cas non couvert par les tests (celui testé rejette `applyBinding` avant toute écriture). Correction : `sendState()` dans un `finally` de `choose`.

M8. L'hôte ne revérifie pas `canChoose` pour Chatterbox. `choose chatterbox` est accepté serveur arrêté (Controller.ts:138-150 ne contrôle que `own-voice` et Piper). Conséquence : voix réglée sur un moteur injoignable, depuis un message forgé uniquement. Pas d'exécution ni de sortie réseau.

M9. Commentaire inexact. Controller.ts:7-9 : « No process is started here ». Un essai sur `system`/`piper` lance espeak/piper (SystemTtsProvider, `spawn` sans shell) au clic. Comportement voulu, commentaire à corriger ; le test « no process » (voice-gallery.test.ts:184) ne vise que le serveur.

M10. Si le serveur configuré n'est pas en boucle locale, `probe` renvoie `unknown` et l'essai continue vers `EgressGuard` (Controller.ts:170-181). Sans danger en mode `local` (refus), mais en mode `trusted`/`open` la phrase tapée part vers ce serveur au clic, sans que la page le dise (« envoyée au moteur au clic »). Choix explicite de l'utilisateur ; à mentionner dans le libellé.

M11. Nit : `notice` n'est jamais masqué (voiceGallery.js:494-497) ; une erreur ancienne reste affichée.

## 7. Tests à vide, code mort

- Vacuité confirmée : `webview-injection-voice-gallery.test.ts:60-72` (« interpolates nothing but the nonce and the URIs »). Les `PAYLOADS` ne sont jamais passés à `buildVoiceGalleryHtml` ; l'assertion de longueur `blank < other + 10` est vraie quoi qu'il arrive. Si le HTML se mettait à interpoler un libellé, ce test resterait vert. Les autres tests de ce fichier (CSP, un seul script, `innerHTML` interdit, libellé hostile écrit en `textContent` avec un setter `innerHTML` qui lève) sont réels. Je n'ai pas lancé de mutation.
- Trou d'une mutation survivante probable : « Annuler » côté hôte (voiceGalleryController.test.ts:302-321) n'utilise qu'un `synthesize` qui rejette à l'abandon. Aucun test où `synthesize` aboutit après `abort` : retirer le garde `!controller.signal.aborted` (Controller.ts:182) laisserait les tests verts (non exécuté).
- `handleVoiceTier` (handleVoiceTier.ts:86) : confirmé sans appelant de production ; seuls `handleVoiceTier.test.ts` l'appellent. Pipeline.ts:147 n'importe que `showChatterboxInstructions`, du même fichier. `VOICE_TIER_OPTIONS` (voiceTiers.ts:36) : confirmé sans appelant, seul `voiceTiers.test.ts` le lit. Conséquence : leurs tests verts ne protègent aucun comportement livré. Retirer, ou les garder avec un commentaire qui le dit.
- Test d'intégration `an unknown id changes nothing` : réel, il compare le fichier avant/après.

## Recommandation de merge

READY pour la carte, avec : I1 corrigé (une ligne + test) ; I2 corrigé ou accepté par écrit ; I3 tranché avec l'utilisateur à l'écoute AC-003. Les mineurs peuvent former une carte de suite.

```grimoire-uncertainties
[
  {"where": "vscode-extension/src/tts/SystemTtsProvider.ts:386-399", "what": "Une phrase d'essai commençant par -o ou -f serait interprétée comme option par `say` sur macOS", "why": "Aucune machine macOS ici et comportement de getopt de `say` supposé ; défaut jugé plausible, non reproduit"},
  {"where": "vscode-extension/src/tts/KyutaiPocketProvider.ts:190-203", "what": "Le corps d'erreur du serveur pocket-tts pourrait recopier la phrase d'essai dans le journal et la page", "why": "Format réel des erreurs 4xx de `pocket-tts serve` non observé ; seul le code de recopie du corps brut est lu"},
  {"where": "vscode-extension/test/integration-voice/voice-gallery.test.ts", "what": "Résultat des 22 tests d'intégration voix et des 66 tests vscode-test non revérifié", "why": "Hors consigne (banc audio, VS Code + xvfb) ; je ne cite que l'evidence-pack"},
  {"where": "vscode-extension/test/unit/views/voiceGalleryController.test.ts:302-321", "what": "Mutation survivante supposée : retrait du garde `aborted` avant `trialAudio`", "why": "Raisonné par lecture du test, aucune mutation exécutée (interdiction de modifier le code)"},
  {"where": "docker run kokoro (galleryModel.ts:173)", "what": "Exposition réelle sur le réseau local de `-p PORT:8880`", "why": "Comportement Docker standard (bind 0.0.0.0) non testé sur la machine ; dépend du pare-feu de l'hôte"},
  {"where": "Kokoro / Kyutai / Piper lancés par un essai en mode jeu", "what": "Un essai au clic n'est pas conditionné par le drapeau gpu-yield", "why": "Les moteurs essayables sont CPU (Chatterbox exclu de l'essai) ; si l'utilisateur fait tourner Kokoro sur GPU, la règle « pas de charge IA pendant le jeu » n'est pas appliquée ici ; non mesuré"},
  {"where": "vscode-extension/src/views/voiceGallery/VoiceGalleryPanel.ts:36", "what": "Comportement exact de l'audio d'un webview masqué avec retainContextWhenHidden selon la version de VS Code", "why": "Lu dans le code, non observé dans un VS Code réel"}
]
```

## Suites données par le concierge (2026-11-06)

- I1 corrigé : commande Docker limitée à 127.0.0.1, test ajouté.
- Test à vide de `webview-injection-voice-gallery.test.ts` remplacé par une comparaison de rendus.
- I2 (`say` sur macOS) reporté à la carte macOS `GAO-s3-macos-por-001`, non reproduit ici.
- I3 (son superposé) soumis à guilhem-bonnet. Mineurs non traités, à reprendre selon l'usage.
- Hors revue : tests d'intégration rendus stables en vidant le dossier de test à chaque exécution (8 passes sur 8).
