# Revue indépendante — GAO-moteur-kyuta-001 (Kael, security-auditor)

Verdict : **NOT READY** (1 bloquant, 4 importants, 6 mineurs). Revue interrompue par la limite de tours : les points non couverts sont listés en fin de document.

## Exécutions réelles
- `python3 deploy/kyutai16/test_server.py` : 36 tests, OK (16,5 s). Faux moteur, aucun GPU.
- `npm run test:unit` (vscode-extension) : 128 fichiers, 2657 tests, tous passés.
- Sondes écrites dans le scratchpad, sans GPU, sans conteneur, sur un serveur local à port éphémère (le service kyutai16 en cours n'a pas été touché) :
  `.../scratchpad/probe_release.py` et `.../scratchpad/probe_http.py`.

## BLOQUANT

### B1. La mémoire GPU n'est pas libérée quand le mode jeu ou une saturation interrompt une synthèse ou un chargement
- `deploy/kyutai16/server.py:303-314` appelle `_release_model()` à l'intérieur du bloc `except`. L'exception tient encore la trace de la pile, donc la variable locale `model` de `MoshiEngine.synthesize` (`server.py:511`), donc les poids.
- `unload()` (`server.py:499-505`) fait `gc.collect()` puis `torch.cuda.empty_cache()` pendant que les poids sont encore référencés. Rien ne libère après la sortie du `except`.
- `maintain()` (`server.py:321`) ne repasse pas : `engine.loaded` est déjà faux.
- Cas du chargement (OOM pendant `load()`, `server.py:296-297`) : `_release_model` sort tôt (`server.py:272`, `loaded` est faux). Aucun `empty_cache` n'est appelé, les poids partiellement chargés restent dans le cache de l'allocateur.
- Scénario : le jeu démarre au milieu d'une lecture. Le serveur répond 503 mais garde environ 4,3 Go réservés pendant tout le jeu. C'est exactement ce que le mode jeu doit éviter, et `server.py:16-17` plus le README affirment le contraire.
- Preuve (CPU, structure identique à `MoshiEngine`) : `probe_release.py` montre `modèle libérable au moment de unload() : [False]` pour les scénarios yield et OOM en cours de synthèse, et `unload/empty_cache appelé : 0` pour l'OOM au chargement.
- Non mesuré : l'effet VRAM réel sur ROCm, faute de GPU autorisé. Le mécanisme Python est prouvé ; que l'allocateur garde bien les blocs est le comportement documenté de torch, pas une mesure.
- Les tests ne le voient pas : `FakeEngine.unload` (`test_server.py:45-70`) ne détient aucune référence.
- Correctif attendu : sortir du `except` avant de libérer (positionner un drapeau, libérer dans le `finally` après avoir levé la trace), appeler `empty_cache` même si `loaded` est faux, et mettre `model = None` / `del result` dans `MoshiEngine.synthesize` avant de lever. Ajouter un test avec un moteur qui garde un `weakref`.

## IMPORTANT

### I1. La carte « Prête » ne dit rien du mode jeu ni des voix absentes
- `vscode-extension/src/views/voiceGallery/galleryModel.ts:255` : `ready` = `/health` répond. Le serveur renvoie pourtant `gpu_yield` et `voices` (`server.py:238-244`), et l'extension ne les lit pas (`KyutaiPocketProvider.ts:120` ne regarde que `status`).
- Scénario : jeu en cours ou cache sans voix, cartes « Prête » et choisissables, premier essai en 503. Les cartes « Non prête » ne couvrent que le serveur arrêté.
- Rien n'est cassé en sécurité, mais la promesse « cartes Non prête » est partielle.

### I2. Le 503 est réessayé avec backoff, y compris le mode jeu et l'OOM
- `playback/AudioQueue.ts:478-481` : toute erreur passe par `scheduleRetry`, sans distinguer 503 mode jeu (`Retry-After: 60`, `server.py:450`).
- Chaque nouvel essai après OOM recharge le modèle (le serveur le libère puis le recharge, `server.py:312-314`), donc des chargements GPU répétés sur un GPU saturé. Le nombre de reprises par défaut n'a pas été vérifié.
- Le message arrive bien jusqu'à l'utilisateur : `KyutaiPocketProvider.ts:190-195` affiche `HTTP 503 … — <detail>` avec le texte français du serveur (`server.py:61, 87`). Le texte est compris ; c'est la répétition qui pose question.

### I3. Une synthèse est un WAV entier renvoyé d'un coup, sans plafond de durée côté serveur
- `server.py:301-302, 444` : pas de streaming. `max_gen_length` du modèle est 30000 pas (`moshi/models/tts.py:382`), soit des dizaines de minutes d'audio possibles, et `MAX_TEXT_CHARS` = 5000 (`server.py:49`) n'est pas dimensionné pour une lecture segmentée. Aucun délai maximal côté serveur.
- Gravité pour une lecture réelle : latence jusqu'au premier son égale au temps de synthèse du segment (facteur temps réel 0,92 annoncé au README, non remesuré ici). Acceptable si le segmenteur de l'extension garde des segments courts ; non vérifié. L'annulation fonctionne : le serveur détecte la déconnexion à chaque trame (`server.py:333-340, 285-289`). Un segment de plus de 5000 caractères reçoit 413 propre (`server.py:205-206`).

### I4. Durcissement du conteneur incomplet
- `deploy/docker-compose.tts.yml` service `kyutai16` (≈ l.209-270) : `user` non root (bien), montages en lecture seule (bien), `HF_HUB_OFFLINE=1` (bien), `restart: "no"` (bien). Mais :
  - pas de `cap_drop: [ALL]`, pas de `no-new-privileges`, système de fichiers racine inscriptible (`HOME=/tmp`) ;
  - `ipc: host` (≈ l.241) expose les segments partagés de l'hôte, et rend `shm_size: 8g` (≈ l.242) sans effet. Hérité de `chatterbox` (l.123-126), non justifié pour ce service ;
  - `seccomp=unconfined` (≈ l.244) : même héritage, non justifié ;
  - écoute `0.0.0.0` dans le conteneur : tout autre conteneur du même réseau Compose peut joindre le port en forgeant `Host: localhost`. Le port hôte n'est publié que sur `127.0.0.1` (bien).
- Test à faire : retirer `ipc: host` et `seccomp=unconfined` et vérifier que ROCm démarre. Non essayé (pas de conteneur autorisé).

## MINEUR
- M1. Imbrication multipart profonde : un corps de 171 Ko avec 3000 niveaux provoque `RecursionError`, non rattrapé par `parse_form` (`server.py:197` n'attrape que `UnicodeError`/`ValueError`). Résultat : connexion coupée sans réponse, ligne `connection_error` avec le nom du type seulement (pas de fuite). Mesuré par `probe_http.py`.
- M2. Connexions lentes : 300 connexions muettes donnent 300 threads (`Server`, `server.py:464`, aucun plafond). Le délai de 30 s est par lecture (`server.py:54, 359`), pas global : un goutte-à-goutte tient un thread indéfiniment. Seul un processus local peut le faire (le navigateur ne peut pas).
- M3. Chunked : `_read_chunked` (`server.py:385-396`) accepte un morceau tronqué sans le détecter. Taille négative : refusée en 400, vérifié (ma crainte d'une lecture sans fin est infirmée).
- M4. OOM détecté par le nom du type (`server.py:312`) : une erreur ROCm `RuntimeError: HIP out of memory` donnerait un 500 générique au lieu du 503 explicite.
- M5. Filtrage Origin/Host (`server.py:343-351, 380-383`) : Host liste correcte (rebinding refusé, `localhost.`/`127.1`/`0.0.0.0` refusés, double Host ambigu : le premier gagne). Seul angle restant : un GET cross-origin `no-cors` (sans en-tête Origin) atteint `/health` et `/voices`, sans effet ni lecture possible. Option : exiger `Sec-Fetch-Site` absent ou `none`/`same-origin`. `OPTIONS` répond 501, sans en-têtes CORS.
- M6. `yield_flag.exists()` (`server.py:234`) peut lever `PermissionError` sur Python 3.10 (EACCES non ignoré) : synthèse refusée (échec fermé), mais le thread `maintain` meurt. Peu probable avec le montage actuel.

## Points vérifiés sans défaut
- `voice_url` : appartenance au dictionnaire du catalogue (`server.py:207-209`), fichiers issus du cache et filtrés par le catalogue (`server.py:150-162`). Pas de traversée ni d'URL (test `Refusals`).
- Texte absent des journaux : `emit` ne reçoit que des longueurs (`server.py:126-129, 459`), `log_message` muet (`361`), `handle_error` ne journalise que le nom du type (`468-470`), `raise … from None` (`314-315`). `probe_http.py` (cas 6) : ligne de journal sans texte ni valeur de `voice_url`. Les bibliothèques moshi n'appellent pas de logger dans `tts.py`.
- Mode jeu : vérifié avant la file, dans la file, après le chargement, à chaque trame et au décodage (`server.py:285-300, 513-524`). Le drapeau est lu dans un dossier monté qui n'est jamais supprimé par l'outil `gpu-yield` (lu : `~/.local/bin/gpu-yield:193-199`), donc pas de montage périmé. Reste B1 pour la libération.
- Extension : l'`egress` du garde est passé au fournisseur (`presets.ts:271-310`, `Pipeline.ts:2090-2095`) ; l'identifiant d'instance `kyutai-1-6b@http://localhost:8020` est distinct de Pocket (`resolveProviderConfig.ts:95-99`), donc clés de cache séparées ; `resolveProviderConfig.ts:73-74` garde le port 8020 ; licences et attribution CC BY 4.0 + clause (`galleryModel.ts:346-400`, `kyutai16VoiceCatalog.ts`) ; aucun `sample` pour ces voix (`galleryModel.ts:50-57`, pas de preview) ; le préchauffage est sauté en mode jeu (`Pipeline.ts:2625`).

## Tests à vide (point 8)
- Les 36 tests Python passent mais tous contre un `FakeEngine` : aucun ne détecte B1, aucun ne vérifie la libération réelle, l'OOM réel, ni le message de l'extension. Le test `RealAdapter` (`test_server.py:471-581`) ne vérifie que des réglages par lecture de code.
- Côté extension, la suite passe ; je n'ai pas lu de test qui vérifie un 503 mode jeu de bout en bout dans l'interface.
- Aucune campagne de fuzzing avec corpus de graines versionné n'existe pour ce serveur : les cas M1-M3 ci-dessus sont des sondes ponctuelles, pas une couverture chiffrée. Je ne les ai pas ajoutés au dépôt (revue sans modification de code).

## Non couvert (limite de tours)
- Mesure VRAM réelle (B1), OOM réel 503 et rétablissement sans redémarrage, durée des synthèses.
- Vérification que le VSIX ne contient aucun échantillon (commande `vsce ls` non lancée ; seul le code du catalogue a été lu).
- Valeurs par défaut de `maxRetries`, du délai de synthèse et de la taille des segments.
- Lecture détaillée de `voiceGalleryHtml.ts`, `VoiceGalleryPanel.ts` (CSP, échappement) et `test/unit/tts/kyutai16.test.ts`.
- Décision de `gpu-yield` d'arrêter ou non le conteneur `kyutai16` lui-même (le config `~/.config/gpu-yield/exclude` n'a pas été lu).

## Suites données par le concierge (2026-11-06)

B1 corrigé et mesuré sur la carte réelle. I4 corrigé pour `ipc`, `seccomp`, `shm_size` et les capacités ; écoute 0.0.0.0 dans le conteneur conservée, protégée par le filtrage Host et Origin. Détection OOM par message HIP ajoutée, drapeau illisible traité comme mode jeu. I1, I2, I3 et les autres mineurs restent ouverts.
