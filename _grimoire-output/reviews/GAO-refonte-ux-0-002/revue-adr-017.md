# Revue indépendante — ADR-017, carte GAO-refonte-ux-0-002

Relecture de `docs/adr/ADR-017-voice-and-reading-mode.md` contre `vscode-extension/src` et `package.json` (arbre de travail du 2026-11-05). Aucun test n'a été exécuté : tout est constat de lecture. La décision de fond (voix globale séparée du mode, mot « profil » retiré) n'est pas rediscutée.

Les lignes citées par l'ADR ont glissé d'environ 8 à 14 lignes. Exemples : `Pipeline.ts:568` est maintenant `:576`, `:1024` est `:1038`, `:1157` est `:1171`, `:1259` est `:1273`, `:1366` est `:1380`, `:1408` est `:1422`. Le fond reste exact.

## 1. Causes A à D

- **A, exacte.** `browseVoices` (`Pipeline.ts:1067-1070`) ne remplace que `voice` et laisse `referenceAudio`. `ChatterboxProvider.ts` préfère l'échantillon.
- **Réserve sur A.** L'ADR dit que le `profiles.json` réel de l'utilisateur contient un clone et cite la fixture `legacy-profiles-v1.json:13`. Cette ligne est le chemin livré `../deploy/tts/reference-audio/fr-female-siwis.wav`, pas un clone d'utilisateur. L'exemple prouve le mécanisme, pas le cas réel de guilhem-bonnet.
- **B, exacte.** `bindingFrom` (`PlaybackController.ts:801-806`) transmet `providerId` tel qu'écrit, donc `auto`. `AudioQueue.ts:404` en fait la clé. `tts.id` (`Pipeline.ts:1761-1764`) contient bien moteur, URL et chemin de l'échantillon.
- **C, exacte.** Les écritures passent par `getSelected()` sans source (`:1038, 1062, 1162, 2013`). La lecture passe par `getSelected(doc.sourceType, bySource)` (`:576`). Le défaut `claude-code: llm-summary` est à `package.json:574-576`.
- **D, exacte.** `pickVoiceForProfile` liste les voix du moteur résolu (`:1093-1101`) et seul `voice` est écrit.
- **Cause manquante, mineure.** `previewVoice` (`Pipeline.ts:1151`) fait `{...profile.tts, voice}`. L'aperçu d'une voix du catalogue rejoue donc l'échantillon cloné. C'est la cause A dans l'aperçu : l'écran de choix ment avant même l'enregistrement. À couvrir par V2.
- **Autres lecteurs de `profile.tts`.** `isRemoteProfile` ne figure pas dans la liste de l'ADR (voir I-3).

## 2. Constats

### Bloquants

Aucun. Les points I-1, I-2 et I-4 deviennent bloquants s'ils ne sont pas corrigés avant la carte 0-004.

### Importants

**I-1. Perte silencieuse de `parameters`/`format` : contradiction « sans perte » / « conservé à l'octet ».**
- Fichiers : ADR §1.3 (« `format` et `parameters` seuls n'en font pas une [voix propre] ») et §2 (ligne « Tout le reste : conservé à l'octet »). Code : `core/profile.schema.ts:97-107`, éditeur `media/profileEditor/profileEditor.js`.
- Scénario : l'utilisateur a réglé `exaggeration: 0.9` sur le mode « Professeur technique ». Son `tts` est `{providerId:"auto", parameters:{exaggeration:0.9}}`. La ligne 2 ne le vide pas (paramètres différents du préréglage), donc il est conservé dans le fichier. Mais `hasOwnVoice` rend false, car `providerId:"auto"` ne compte pas comme voix propre pour un mode (le test d'identité ne couvre que le moteur nommé). `withEffectiveVoice` remplace alors le `tts` en entier par la voix globale. À la lecture, le réglage disparaît sans libellé « Voix propre » ni avertissement.
- Correction demandée : trancher explicitement. Soit `parameters` et `format` survivent à `withEffectiveVoice` (fusion limitée à ces deux champs, ce qui contredit « remplacement entier »). Soit la migration range ce mode en voix propre. Ajouter un cas à V5 et V6.

**I-2. La procédure de retour arrière réintroduit le symptôme.**
- Fichier : ADR §2 « Retour arrière » (« copier `profiles.pre-adr-017.json` sur `profiles.json` »).
- Scénario : l'utilisateur restaure la sauvegarde, puis remonte de version. `global-voice.json` contient toujours `profilesMigrated: true`, donc rien ne rejoue. Les cinq modes restaurés portent chacun leur voix d'origine, tous « voix propre ». Choisir une voix globale n'a plus aucun effet sur eux : c'est le symptôme initial, même s'il est affiché.
- Correction demandée : la procédure du CHANGELOG doit supprimer aussi `global-voice.json`, ou la migration doit réagir à un `profiles.json` sans les marques attendues.

**I-3. Le badge 🔒/☁ ignore la voix héritée.**
- Fichiers : `core/profile.schema.ts:217` (`isRemoteProfile`), `profiles/profileQuickPick.ts:29`, `views/profiles/profileTreeItems.ts:65`, `Pipeline.ts:952`. L'ADR ne traite que `collectRemoteProviderIds` (`remoteProviders.ts:24`) et `computeLocalModeResult`.
- Scénario : la voix globale pointe vers un serveur distant sous `trustedHosts`. Les modes hérités ont `tts: {}`. Quick Pick, vue Modes et avertissement d'import montrent tous 🔒 « local » alors que le texte part à l'extérieur. C'est un trompe-l'œil sur l'invariant P0 « local-first ».
- Correction demandée : `isRemoteProfile` doit recevoir le mode effectif. L'ajouter au §1.3 et à V5.

**I-4. V2 ne peut pas observer la cause A.**
- Fichier : `Pipeline.ts:1750-1753`. `ttsFor` retourne `ttsProviderOverride` avant de calculer `referenceAudioPath` (`:1755`). Un `FakeTtsProvider` branché par cet override ne voit jamais l'échantillon.
- Scénario : le test V2 « aucun échantillon à la synthèse » passe même si l'échantillon est encore transmis par le chemin réel.
- Correction demandée : V2 passe par `ttsFor` réel avec un faux serveur HTTP Chatterbox, ou un test sur `createTtsProvider`/le corps de requête. Même réserve pour V1 : il prouve la bonne résolution du mode, pas le comportement bout en bout. V15 ne tourne qu'aux cartes 0-007 et 1-005, alors que le modèle bascule en 0-004.

**I-5. Zone de course dans la migration à deux fichiers.**
- Fichiers : ADR §2 étapes 2 à 4. Sources d'accès : `extension.ts:147` crée un second `ProfileRepository` (`profilesRepositoryForViews`) qui appelle aussi `load()` ; plusieurs fenêtres VS Code partagent `globalStorageUri`.
- Scénario : l'étape 4 « réécrit » `global-voice.json` avec `profilesMigrated: true`. Si l'utilisateur appelle `chooseVoice` dans l'autre instance entre les étapes 2 et 4, l'étape 4 écrase le choix par la valeur lue à l'étape 2. De même `setGlobalVoice` qui reconstruit l'objet depuis le schéma doit conserver `profilesMigrated`, sinon la migration rejoue.
- Correction demandée : l'étape 4 relit le fichier avant d'ajouter le drapeau ; verrou ou écriture unique de l'instance qui gagne ; test de V6 avec deux dépôts concurrents.
- Complément : la réinitialisation manuelle de `global-voice.json` relance la migration sur un `profiles.json` déjà vidé. La voix globale est alors recalculée depuis un `tts` vide, donc perdue sans bruit. Le drapeau devrait vivre dans `profiles.json` ou un fichier d'état séparé.

**I-6. Langue : la voix globale n'a pas de langue.**
- Fichiers : `profiles/defaults.ts` (tous fr-FR) ; `Pipeline.ts:1993` (`defaultVoiceFor(voices, profile.language)` seulement si aucune voix).
- Scénario : l'utilisateur duplique un mode en `en-US`. Le mode hérite de la voix globale `estelle` (française) : texte anglais lu en français, alors qu'avant il pouvait avoir sa voix. La migration conserve les modes existants avec voix propre, donc seul le nouveau cas est touché.
- Correction demandée : une ligne dans l'ADR (avertissement dans « Choisir le mode » ou héritage conditionné à la langue).

### Mineurs

- **M-1. Formule de vitesse non bornée.** `voice.speed` (0,5 à 3) × `playback.rate` n'est pas ramené aux bornes des moteurs (0,5 à 2 : `KokoroProvider.ts:42`, `SystemTtsProvider.ts:198`). Un produit de 3,3 est tronqué sans le dire. Le facteur du mode (Révision ×1,1) est silencieusement ignoré sur Chatterbox et Pocket sans lecteur compatible, contrairement à « jamais d'effet silencieusement absent » (§1.4) : la commande grisée ne couvre que la vitesse globale.
- **M-2. `AudioQueueBinding.speed` existe déjà** (`AudioQueue.ts:58, 560`), non cité. Seul `bindingFrom` ne le transmet pas. Le travail est plus petit que décrit, mais la clé de cache (`AudioQueue.ts:406-414`) doit alors inclure `speed`, ce que §1.5 prévoit.
- **M-3. Réglage déprécié.** « Lu seulement si le nouveau n'a aucune valeur explicite » exige `inspect()` : les deux réglages ont un défaut non vide, donc `get()` ne distingue pas défaut et valeur utilisateur.
- **M-4. `hidden` perdu au retour arrière.** Le schéma Zod (`profile.schema.ts:123-136`) retire les clés inconnues à la première écriture de la 0.3. À la remontée, `profilesMigrated` étant vrai, `system-voice` réapparaît visible avec `tts: {}`, doublon de Fidèle.
- **M-5. Alternatives.** `globalState` (déjà utilisé pour `lastSelectedId`, `ProfileRepository.ts:24`) n'est pas examiné comme alternative au fichier séparé. Le choix du fichier reste défendable (retour arrière, import/export, visibilité).
- **M-6. Priorité et ADR-015.** « Voix préférée du narrateur de la portée `user` = voix globale » (§4) diverge de « le narrateur prend la voix effective » quand le mode a une voix propre. Une phrase suffit.
- **M-7. ADR-013.** Une voix globale distante exclut tous les modes hérités des candidats d'Auto : liste vide possible. V13 ne couvre que l'absence d'implémentation.
- **M-8. La migration fige l'état de la cause A.** Si le mode `lastSelectedId` porte `referenceAudio`, la voix globale initiale le porte aussi (`voice` est alors ignoré par Chatterbox). L'utilisateur entend toujours le clone jusqu'à ce qu'il rechoisisse. À signaler à l'utilisateur après migration.

## 3. Réponses point par point

- **Migration.** Elle ne perd ni ids ni champs hors `tts`. Elle est idempotente à voix globale fixée (§2). Le retour arrière vers la 0.3 tient techniquement (`schemaVersion` 2, `tts: {}` valide, `ProfileCollectionSchema` accepte 1 ou 2 à `profile.schema.ts:176`) sous réserve de I-1, I-2, I-5 et M-4. `lastSelectedId` et `defaultProfileId` pointent vers `faithful-local` : valide en 0.3 aussi. Écart de formulation : `lastSelectedId` vit dans `globalState` (`ProfileRepository.ts:24`), pas dans `profiles.json` ; la « fonction pure » doit donc l'écrire hors de la sauvegarde.
- **package.json.** Les 47 commandes et les vues `llmVoice.player`, `llmVoice.playerView`, `llmVoice.inboxView`, `llmVoice.profilesView` ont un sort au §3. Les réglages `defaultProfile`, `profiles.bySource`, `tts.provider`, `tts.baseUrl` et `ui.layout` aussi. Aucune fonction perdue trouvée. `llmVoice.markdownContextMenu` (`package.json:374`) n'a pas de ligne, ce qui est sans conséquence. `llmVoice.testVoice.text` et `llm-voice-panel` sont à surveiller.
- **ADR-013 et ADR-015.** La priorité personnage > mode > global est compatible avec ADR-013 (Auto choisit un mode puis `withEffectiveVoice`) et avec ADR-015 (`binding` issu de `effective`, `translate.ts:57-62, 211-217`). Réserves : M-6 et M-7. Aucune collision de `schemaVersion` : ADR-013 §4 garde la version 3.
- **Fichier séparé et vitesse.** Justification suffisante pour le fichier ; elle repose sur le retour arrière (voir M-5). La formule est cohérente avec `translate.ts:237` (`binding.speed × tempo`) mais non bornée (M-1).
- **Découpe.** Pas de double système durable : la bascule tient en 0-004. Deux zones de cohabitation transitoire sont nommées. L'éditeur intérimaire avec option « Voix globale » (`profileEditor.js:134, 161-167`) est à tester (V10). Le réglage déprécié `profiles.bySource` reste lu en repli (M-3).
- **V1 à V15.**
  - V6 : « à l'octet » est trop fort. `load()` fait passer chaque mode par Zod, qui retire les clés inconnues. Dire « à valeur JSON égale ».
  - V9 : avec une liste d'exceptions décroissante, le lint ne prouve rien avant 1-005.
  - V1 à V5 : avec un faux fournisseur, ils ne prouvent pas la chaîne réelle (I-4).
  - V3 : il teste `AudioQueue` avec un `tts.id` fourni. Il ne prouve pas que `Pipeline.ttsFor` produit des ids distincts selon moteur résolu, échantillon et URL.
  - Manquent : course (I-5), retour arrière réel (I-2), badge distant (I-3).

## 4. Verdict

**Acceptable après corrections.** I-1, I-2, I-3, I-4 et I-5 sont à traiter dans l'ADR avant d'ouvrir la carte 0-004. I-6 et les mineurs peuvent se traiter à l'implémentation.

```grimoire-uncertainties
[
  {"where": "ADR-017 §1.1 cause A, fixture legacy-profiles-v1.json:13", "what": "Je n'ai pas lu le profiles.json réel de l'utilisateur ni comparé la valeur de referenceAudio à un clone", "why": "La fixture ne contient que le chemin livré ../deploy/..., pas un échantillon d'utilisateur ; l'ADR affirme le contraire"},
  {"where": "vscode-extension/src/pipeline/resolveProviderConfig.ts:102-118, ADR cause D", "what": "Non relu : la résolution d'auto vers un moteur", "why": "Ma lecture de la cause D repose sur Pipeline.ts:1093-1101 et 1067-1070, pas sur ce fichier"},
  {"where": "vscode-extension/src/direction/translator/translate.ts:305-325", "what": "Non vérifié que la clé de cache du chemin de direction contient le moteur résolu ou l'échantillon", "why": "V3 ne couvre que AudioQueue ; le chemin ADR-015 a sa propre clé"},
  {"where": "vscode-extension/media/profileEditor/profileEditor.js et profileEditorHtml.ts", "what": "Non relu : l'éditeur écrit-il parameters/format dans tts ? (hypothèse de I-1)", "why": "L'éditeur expose la vitesse (profileEditorHtml.ts:117) ; je n'ai pas vérifié si exaggeration/cfg_weight y sont éditables"},
  {"where": "vscode-extension/media/player/player.js:143 et PlayerViewProvider.ts:71", "what": "Non vérifié : setRate applique réellement playbackRate, et reveal() ne dépend pas de l'id llmVoice.player", "why": "La suppression de llmVoice.player (PlayerViewProvider.viewType = llmVoice.player) suppose que reveal() suit le nouvel id"},
  {"where": "Mermaid de l'ADR, ledger des cartes", "what": "Rendu du diagramme et dépendances de cartes (_grimoire-runtime-output/ledger/events.jsonl) non vérifiés", "why": "Hors de ma tranche ; je n'ai pas ouvert le ledger"},
  {"where": "numéros de ligne cités", "what": "Les lignes de l'ADR ont glissé de 8 à 14 ; les miennes datent de la lecture du 2026-11-05 et peuvent glisser (un autre agent modifie vscode-extension/src)", "why": "L'ADR le signale lui-même"}
]
```
