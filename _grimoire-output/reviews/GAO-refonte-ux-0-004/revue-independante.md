# Revue indépendante GAO-refonte-ux-0-004 (ADR-017, modèle voix / mode)

Revue de lecture seule. **Rien n'a été exécuté** : cette session n'avait ni Bash ni vitest. Tout ci-dessous est un constat de lecture (fichier:ligne), sauf mention contraire. Les tests que je cite n'ont pas été relancés par moi.

Fichiers lus : `src/profiles/{voiceResolution,globalVoiceStore,profileStore,migrations,ProfileRepository}.ts`, `src/pipeline/Pipeline.ts` (lignes 590-700, 895-1440, 1500-1670, 1985-2060, 2195-2285, 2556), `src/playback/{AudioQueue,AudioCache,PlaybackController}.ts` (parties citées), `media/profileEditor/profileEditor.js` 145-220, `test/integration-voice/voice-causes.test.ts`, `test/unit/profiles/voiceMigration.test.ts`, `test/unit/invariants/*`, `.vscode-test.mjs:289`, ADR-017 §1.4, §1.5, §2.

## Verdict : READY, avec 4 réserves « important » à tracer

Aucun bloquant trouvé par lecture. Pas de chemin d'écrasement silencieux d'un `global-voice.json` ou `profiles.json` invalide : les deux lèvent une erreur nommant le fichier (`globalVoiceStore.ts:119-124`, `profileStore.ts:100`). Les réserves ci-dessous sont à ouvrir en cartes ou à assumer par écrit.

## Important

### I1. Cache : la langue du mode n'entre pas dans la clé (item 4)
- `AudioQueue.ts:409-418` et `AudioCache.ts:86-96` : clé = moteur, model, voice, parameters, speed, texte. `language` est absente.
- Or `language` part dans la requête (`AudioQueue.ts:559-561`) et change le son : `ChatterboxProvider.ts:296` l'envoie, `SystemTtsProvider.ts:209` choisit la voix par sous-tag.
- Scénario : tous les modes héritent maintenant d'une même voix globale. Un mode `fr-FR` et un mode `en-US` lisent le même texte, avec la même voix. Le second reçoit l'audio du premier, dans la mauvaise langue, sans aucun appel moteur.
- Défaut antérieur à l'ADR, mais il devient le cas courant avec une voix unique. V3 prétend couvrir « deux voix, une clé » et ne le teste pas.
- Correction : `language` dans `AudioCacheKeyMaterial` et `computeCacheKey`. Test unitaire : même texte, même voix, deux langues, deux clés.

### I2. Ouvrir « Choisir la voix » déclenche le préchauffage du moteur, et le test ne peut pas le voir (items 3 et 5)
- `chooseVoice` appelle `globalVoiceCandidate`, puis `listVoicesQuietly` (`Pipeline.ts:1204`), puis `ttsFor` (`Pipeline.ts:2045`), puis `warmupIfEnabled` (`Pipeline.ts:2556-2561`). Cela lance `warmupProvider`, une vraie synthèse (health puis synthèse, `warmup.ts`), avant tout choix. Option `llmVoice.tts.warmup`, défaut `true` (`package.json:743`).
- Aucun son n'est joué, donc le test statique V14 (`no-autoplay-voice.test.ts`) ne le voit pas. Mais c'est une charge moteur, potentiellement GPU, sans geste de lecture. Cela touche la consigne mode jeu gpu-yield. Je n'ai pas trouvé de garde gpu-yield dans `Pipeline.ts` (grep sans résultat).
- Le test d'intégration V8 (`voice-causes.test.ts:364`, « nothing of this reaches the engine's synthesis ») passe à vide sur ce point : `.vscode-test.mjs:289` force `"llmVoice.tts.warmup": false`. L'assertion `ttsBodies(main).length === 0` ne peut donc jamais voir un préchauffage.
- Un moteur déjà préchauffé dans la session ne rejoue pas le préchauffage (`warmedProviderIds`) : l'effet est « une fois par moteur et par session », ce qui le rend d'autant plus difficile à repérer.
- Correction : ne pas préchauffer depuis `listVoicesQuietly` / `pickVoiceForProfile` (le préchauffage appartient à `start`), ou passer un drapeau à `ttsFor`. Et ajouter un test de V8 avec warmup activé.

### I3. Éditeur de mode : une voix propre garde l'échantillon et la clé d'un autre moteur (item 2)
- `media/profileEditor/profileEditor.js:184-190` : `{...base.tts, providerId, baseUrl, voice, parameters}`. `referenceAudio`, `apiKeyRef`, `model` et `format` sont conservés tels quels (commentaire ligne 39-40).
- Scénario : mode avec voix propre `chatterbox` + `referenceAudio`. L'utilisateur clique « Parcourir les voix » dans l'éditeur et choisit `Emily`. L'aperçu (`previewVoice`, `Pipeline.ts:1378`) passe par `bindingForEngineVoice`, qui supprime l'échantillon : on entend Emily. Le formulaire enregistre `voice: Emily` en gardant `referenceAudio`. À la lecture, l'échantillon l'emporte sur la voix (`voiceResolution.ts:71-74`, `ChatterboxProvider`). On entend l'échantillon, et la vue affiche « Votre échantillon ». C'est la cause A, sur le seul chemin d'écriture de voix par mode qui subsiste.
- ADR-017 range cette écriture dans « Toute écriture de voix dans un profil », hors de 0-004 (ligne 474 de l'ADR). Je ne la classe donc pas bloquante, mais la carte 1-002 doit la prendre explicitement. À défaut, l'aperçu et la lecture divergent.

### I4. Mises à jour perdues sur `global-voice.json` (item 1, deux fenêtres)
- `profileStore.ts:224-236` : `setGlobalVoice` lit la vitesse puis écrit ; `setGlobalSpeed` lit la voix puis écrit. Lecture, puis écriture, sans verrou.
- Scénario : fenêtre A choisit une voix pendant que fenêtre B (ou le curseur de vitesse de la même fenêtre) règle la vitesse. Les deux lisent l'ancien état, le dernier écrivant gagne : soit la voix choisie revient à l'ancienne, soit la vitesse est perdue. Aucune erreur, aucun message.
- Même schéma pour `update`, `setDefault` et `delete` (`profileStore.ts:244-312`), que l'ADR déclare accepté (ligne 289 de l'ADR) pour la migration. Rien ne dit que c'est accepté pour la voix, qui est maintenant un fichier à champs multiples. Aucun test V17 n'y touche (`globalVoiceStore.test.ts` : pas de cas `setGlobalSpeed` contre `setGlobalVoice`).
- Correction minimale : relire juste avant l'écriture et refuser/rejouer si le contenu a changé, ou assumer par écrit. Probabilité faible, perte invisible.

## Mineur

- **M1. Fenêtre TOCTOU de la migration, étape 3.** `globalVoiceStore.ts:224-231` : relecture de `profiles.json`, puis écriture, sans rien d'atomique entre les deux. Une fenêtre B qui a terminé sa migration puis enregistré un mode entre la relecture de A et le rename de A voit sa modification écrasée par le classement de A. L'ADR l'accepte (ligne 289). Le test `globalVoiceStore.test.ts:198` crée la marque *avant* l'étape 3, donc il ne couvre pas cette fenêtre (constat de lecture du titre du test seulement, je n'ai pas lu son corps).
- **M2. `createDefaults` n'est pas exclusif.** `profileStore.ts:143` : deux fenêtres qui lisent ENOENT en même temps écrivent chacune les valeurs par défaut. La voix est protégée (création exclusive), pas `profiles.json`. Une modification faite dans A entre-temps peut être écrasée par le second `write`. Fenêtre très étroite, installation neuve seulement.
- **M3. Pas de `fsync` avant le rename.** `globalVoiceStore.ts:68-72`. Après une coupure de courant, un fichier vide ou tronqué est possible. `global-voice.json` illisible donne alors une erreur nommant le fichier (bien), mais la voix est perdue. Même motif que `profiles.json` avant la carte. Les `.tmp-*` orphelins après panne ne sont jamais nettoyés.
- **M4. `engineSpeedFor` : requête de capacités à chaque démarrage et aperçu dès que la vitesse ≠ 1** (`Pipeline.ts:2241-2263`). Pas d'appel avec vitesse exactement 1 (bien). Constats :
  - Le GET passe par `egress` (`OpenAICompatibleTtsProvider.ts:120-121` via `listVoices`), donc la garde de destination s'applique, avec la même clé API et le même hôte que la synthèse. Je n'y vois pas de fuite nouvelle.
  - Pour un moteur distant générique, `parameters: []` est fixe : le GET ne sert à rien, il coûte jusqu'à `ENGINE_CAPABILITIES_TIMEOUT_MS` avant la première phrase, à chaque lecture.
  - Pour `system`, cela relance l'énumération des voix à chaque lecture.
  - `speakTestText` l'appelle sans signal (`Pipeline.ts:1098`) : Stop n'annule pas ce GET.
  - Pas de cache par moteur. Mettre la capacité `speed` en cache sur l'identité du moteur (`ttsInstanceKey`) règle les trois points.
- **M5. Quelques lectures ignorent `modes.bySource`.** `testVoice` (`Pipeline.ts:1112`), `probeProviderHealth` (1509) et `refreshLocalModeBadge` (1661) appellent `resolveReading()` sans type de source. Le badge cadenas / nuage et le test de voix décrivent le mode choisi, pas celui qu'une réponse Claude ou un document utiliserait si `bySource` en désigne un autre. La voix, elle, est bien la même partout (voix globale, un seul `resolveReading`). Cela ne contourne pas la résolution unique, mais le badge peut afficher « local » pour une lecture qui sort vers un mode distant.
- **M6. `listEffective` et `resolveReading` lèvent si `global-voice.json` est invalide** (`globalVoiceStore.ts:119-124`, `profileStore.ts:179-194`). Le message nomme le fichier, rien n'est écrasé : conforme au principe. Mais `extension.ts:163` alimente la vue des modes avec `listEffective` : je n'ai pas vérifié que la vue affiche une erreur et non une liste vide. Non vérifié.
- **M7. Zod retire les clés inconnues** de `global-voice.json` à la prochaine écriture de vitesse (`profile.schema.ts:188-200`, `profileStore.ts:233`). Un fichier écrit par une version plus récente perdrait ses champs en passant par celle-ci. Pas d'incident aujourd'hui, à noter.

## Items demandés, par numéro

1. **Perte de données** : voir I4, M1, M2, M3. Fichiers invalides : jamais écrasés (lecture). Marque absente, voix absente : la sauvegarde `profiles.pre-adr-017.json` est créée en exclusif avant toute modification (`globalVoiceStore.ts:192`). Rejeu après panne : cohérent par lecture, et c'est ce que `voiceMigration.test.ts` « idempotence, stops included » vise (non relancé).
2. **Bug d'origine** : `startInternal`, `testVoice`, `speakTestText`, `chooseVoice`, `useOwnVoice` (`Pipeline.ts:1393-1406`), l'aperçu et l'éditeur passent tous par `resolveReading` ou `effectiveOf`. Réponses Claude et document : par `start`, donc par `resolveReading(doc.sourceType, …)` (`Pipeline.ts:605`). Le narrateur n'est pas concerné par la voix (`narratorFor(profile)` a sa propre liaison). **Non vérifié** : le chemin « voix du personnage » de la direction (ADR-015), faute de l'avoir trouvé dans les fichiers lus. Contournement restant : I3 (éditeur).
3. **Geste et réseau** : I2 (préchauffage sans lecture), M4 (requête de capacités). Aucun appel `controller.start` hors geste dans les modules de profil (lu, et vérifié par les tests statiques V14). Clé API, chemin, URL : `describeVoice` n'affiche jamais le chemin de l'échantillon (« Votre échantillon »). L'identité de moteur `tts.id` (`resolveProviderConfig.ts:92-96`) contient l'URL et le chemin de l'échantillon, et est écrite en métadonnée de cache (`AudioQueue.ts:431,461-465`) : **non vérifié** si elle est journalisée ou exposée ailleurs que sur disque local.
4. **Cache** : I1 (même voix, deux langues, une clé). Même voix qui ne réutilise jamais le cache : non constaté. `speed` n'entre dans la clé que quand le moteur l'applique (`AudioQueue.ts:416`), `tts.id` porte moteur, URL et échantillon. Sous-réserve : l'échantillon est identifié par son chemin, pas son contenu. Un fichier remplacé sur place garde la même clé, et le téléversement mémorisé par instance l'ignore aussi (comportement déjà présent avant l'ADR).
5. **Tests à vide** :
   - V8, ligne 364 de `voice-causes.test.ts` : aveugle au préchauffage (I2).
   - `no-profile-word.test.ts:76-79` : si `async chooseMode(` ou `private warnIfVoiceLanguageDiffers(` disparaît, `indexOf` rend -1 et `slice(-1, …)` rend une chaîne vide ; le `expect(…).toBe(false)` passe alors à vide. Il ne regarde que les chaînes entre guillemets doubles, pas les gabarits.
   - Exceptions du cliquet V9 : `profile-word-exceptions.json` gèle 8 occurrences « profil inconnu » dans `profileStore.ts`, **fichier créé par cette carte**, rattachées à la carte 0-009. La liste est un multiensemble par fichier et texte (`no-profile-word.test.ts:27-40`) : il n'est pas lié à une ligne ni à un symbole. Une nouvelle phrase identique à une phrase gelée dans le même fichier passe. Le test ne vérifie pas non plus que la carte nommée est bien celle qui retirera la phrase (seule une regex sur le numéro, ligne 60). Large, mais défendable pour un cliquet : j'attends que les 8 messages neufs de `profileStore.ts` soient réécrits en « mode » plutôt que gelés.
   - `no-autoplay-voice.test.ts` : `methodBody` s'arrête au premier `\n  }\n` et ne suit pas les appelés. `chooseVoice` appelle `handleVoiceTier` et `voiceTierActions` (`Pipeline.ts:1286-1296`) qui exécutent des commandes : leur corps n'est pas vérifié. Test statique correct pour ce qu'il dit, mais sa couverture de « zéro autoplay » est plus étroite que son titre.
   - Faux reproduisant l'implémentation : non constaté. Les tests d'intégration lisent le corps de `POST /tts` reçu par `MockTtsServer` (observation externe). Le test de propriété V6 (300 graines) compare à `original.tts` et à l'idempotence, pas à une copie de l'algorithme.

## Écarts assumés par l'auteur

1. **Ligne 2 du classement compare les deux côtés complétés** (`migrations.ts:224-229`) : **validé**. Sans complétion, un mode `{voice: "X"}` sans moteur ne serait jamais égal à la voix globale qui en est issue (`providerId` et `baseUrl` tirés des réglages) : il resterait « voix propre » de lui-même sur lui-même. Les deux côtés sont complétés avec les mêmes réglages, donc l'égalité est réelle. Deux notes : (a) elle dépend des réglages au moment de la migration, ce que l'ADR accepte puisque la voix globale a été calculée avec eux ; (b) `format` est exclu de la comparaison conformément à la ligne 321 de l'ADR, donc un mode `{...voix globale, format: "mp3"}` se vide et perd son `format`. Le test de la ligne 63 (« another format »), couvre `wav`, pas `mp3`. `format` n'atteint pas la synthèse (`bindingFrom`, `PlaybackController.ts:802-811`) : perte sans effet audible aujourd'hui.
2. **« Marque absente, voix absente, tts vides » : voix système seulement si la sauvegarde prouve un `tts` antérieur non vide** (`migrations.ts:194-202`) : **validé, avec réserve**. L'ADR (ligne 293) dit « système » sans condition. Sans la preuve, un utilisateur de la 0.3 qui lit via `llmVoice.tts.*` avec des `tts` vides depuis toujours entendrait soudain la voix système. La logique de l'auteur est la bonne, et conforme au principe de l'ADR (« on ne retire que ce dont on prouve l'origine »). Réserve : `readBackup` avale toute erreur et rend `undefined` (`globalVoiceStore.ts:151-159`) : une sauvegarde illisible passe en « pas de preuve », donc en calcul depuis les réglages, silencieusement. L'ADR doit être amendé (ligne 293) pour dire cela, sinon la carte contredit sa spécification.
3. **Une voix propre subit aussi la vitesse globale** (`voiceResolution.ts:122-124`, `Pipeline.ts:662,1098`) : **validé, conforme à l'ADR §1.4** (« la vitesse est globale », « une voix propre ne porte pas de vitesse »). L'écart reste visible via `describeSpeedGap`. À garder en tête : cela impose I-M4 (requête de capacités) y compris pour les voix propres sur un moteur sans `speed`.
4. **`ProfileStore` : nouvelle classe sans `vscode`, dont `ProfileRepository` hérite** : **validé**. Gain réel : toute la logique de fichier et de migration tourne sous vitest (`voiceMigration.test.ts` l'exploite). `ProfileRepository` ne contient que réglages, messages et `openInEditor`. Point à vérifier en exécutant `tsc` : le constructeur de `ProfileRepository` utilise `this` dans des flèches (`ProfileRepository.ts:26`) avant l'appel à `super` (ligne 28). C'est correct à l'exécution (appelées plus tard), mais TypeScript peut le refuser selon la version. **Non vérifié : je n'ai pas lancé `tsc`.** Le câblage propre à `ProfileRepository` (réglages lus, message échantillon/voix) n'a que le niveau intégration, pas de test unitaire.

## À faire avant de dire « terminé »
- Exécuter `bash _grimoire/kit/framework/cc-verify.sh` : non fait ici.
- Relancer vitest et `test/integration-voice` : non fait ici.
- Ouvrir des cartes pour I1, I2, I3, I4 (ou les assumer par écrit dans `evidence-pack.md`).

```grimoire-uncertainties
[
  {"where": "Pipeline.ts:1204/2045 et .vscode-test.mjs:289", "what": "Le préchauffage lancé par chooseVoice est lu, pas observé.", "why": "Aucune exécution ici ; il faut lancer chooseVoice avec llmVoice.tts.warmup à true et regarder les requêtes du moteur."},
  {"where": "AudioQueue.ts:409-418 / ChatterboxProvider.ts:296", "what": "La collision de cache entre deux langues est déduite de la lecture de la clé et de la requête.", "why": "Pas de test exécuté ; à confirmer par un test unitaire de computeCacheKey avec deux langues."},
  {"where": "media/profileEditor/profileEditor.js:184-190", "what": "La conservation de referenceAudio après choix d'une voix dans l'éditeur est lue, pas jouée.", "why": "Pas de pilotage de l'éditeur ; l'ordre de priorité échantillon sur voix vient de voiceResolution.ts et du commentaire de ChatterboxProvider, non relus ici."},
  {"where": "Pipeline.ts, chemin direction (ADR-015)", "what": "Voix du personnage de la direction non retrouvée dans les fichiers lus.", "why": "Hors des fichiers listés ; je ne peux pas dire si elle contourne resolveReading."},
  {"where": "extension.ts:163", "what": "Comportement de la vue des modes quand listEffective lève (global-voice.json invalide).", "why": "extension.ts et le fournisseur de vue n'ont pas été lus en détail."},
  {"where": "ProfileRepository.ts:26-28", "what": "this dans une flèche avant super().", "why": "tsc non lancé ; esbuild l'accepte, TypeScript peut le refuser."},
  {"where": "AudioQueue.ts:431,461 (tts.id en métadonnée de cache)", "what": "URL et chemin d'échantillon dans l'identité du moteur : exposition en journal non vérifiée.", "why": "Pas de recherche exhaustive des usages de tts.id / providerId dans les journaux."},
  {"where": "globalVoiceStore.test.ts:198-210", "what": "Corps du test « another window classified first » non lu.", "why": "Je n'ai lu que les titres ; je ne peux pas affirmer qu'il ne couvre pas la fenêtre TOCTOU de M1."},
  {"where": "Tous les tests cités", "what": "Aucun test relancé par moi.", "why": "Pas d'outil d'exécution dans cette session ; les états verts viennent de l'evidence-pack, que je n'ai pas relu."}
]
```

## Suites données par le concierge (2026-11-06)

- I1 corrigé : la langue entre dans la clé du cache, test `audio-cache.test.ts`.
- I2 corrigé : le préchauffage ne part que d'une lecture demandée et jamais en mode jeu. Test `voice-causes.test.ts` « opening the voice picker starts no synthesis » ; sous mutation, `1 !== 0`. La garde gpu-yield elle-même n'a pas de test dédié.
- I3 reporté à la carte `GAO-refonte-ux-1-002`, I4 à `GAO-refonte-ux-0-007`.
- Test à vide de `no-profile-word.test.ts` corrigé : bornes vérifiées. Écart du classement « marque absente » reporté dans ADR-017 §2.
- `tsc` valide `ProfileRepository.ts:26` : typecheck vert.
