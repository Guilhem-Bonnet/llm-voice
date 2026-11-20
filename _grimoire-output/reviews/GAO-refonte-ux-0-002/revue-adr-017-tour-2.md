# Revue indépendante, tour 2 — ADR-017, carte GAO-refonte-ux-0-002

Périmètre : les quatre points demandés, contre `vscode-extension/src` et `.vscode-test.mjs` (arbre de travail du 2026-11-05). Rien n'a été exécuté : tout est constat de lecture. Les choix de fond ne sont pas rediscutés.

## Verdict
Acceptable sous conditions : aucun bloquant de conception ; 2 constats importants (I-1, I-2) et 4 mineurs à corriger dans l'ADR avant la carte 0-004.

## 1. La marque `voiceMigration` survit-elle ? (risque principal)
Constat de lecture :
- `ProfileCollectionSchema` (`core/profile.schema.ts:175-179`) et `VoiceProfileObjectSchema` (`:123-136`) sont des `z.object` sans `.passthrough()` : Zod retire toute clé non déclarée. `load()` fait `ProfileCollectionSchema.parse` à chaque lecture (`ProfileRepository.ts:75`) puis renvoie le résultat parsé, donc une marque non déclarée serait perdue à la première lecture suivie d'une écriture. La migration rejouerait à chaque démarrage. Ce n'est PAS le cas si la marque est déclarée au schéma, ce que l'ADR §2 dit (« champ optionnel du schéma »).
- Une fois déclarée, tous les chemins d'écriture la gardent : `setDefault` (`:124`), `duplicate` (`:136`), `update` (`:165`), `delete` (`:190`), `import` (`:206`) font `{ ...collection, ... }` à partir de `load()`. La migration v1 vers v2 (`migrations.ts:85-92`) fait aussi `...collection`. Le second dépôt (`extension.ts:147`) est la même classe : mêmes chemins, aucune écriture différente.
- Seule la 0.3 la retire, ce qui est voulu.

Points à écrire dans l'ADR (sinon la marque ou `hidden` disparaît) :
- **I-1 (important).** L'ADR ne liste pas les déclarations à faire : `voiceMigration` dans `ProfileCollectionSchema`, `hidden` dans `VoiceProfileObjectSchema` (sinon `update()` via `parseVoiceProfile` retire `hidden`, `ProfileRepository.ts:162`), les types `ProfileCollection` (`core/profile.ts:124`) et `VoiceProfile` (`core/profile.ts:89-121`), et la régénération de `schemas/profile-collection.schema.json` (test de synchro : `test/unit/schemas/profile-collection.schema.test.ts`). Ajouter à V7 un test de ProfileRepository : `setDefault`, `update`, `duplicate` puis relecture gardent `voiceMigration` et `hidden`.
- **I-2 (important). Installation neuve.** `defaultCollection()` (`ProfileRepository.ts:237-243`) ne pose ni marque ni `global-voice.json`, et l'ADR §2 dit « marque déjà posée ». Or la ligne de table « `global-voice.json` supprimé, marque présente » émet « Voix réinitialisée ». Sans création explicite de `global-voice.json` par l'installation neuve, la première lecture d'un utilisateur neuf afficherait ce message. À écrire : l'installation neuve crée les deux fichiers dans la même séquence (et la ligne de table doit dire que la création est faite par `load()` ENOENT, `:66-71`).

## 2. Idempotence du rejeu
- Première montée : OK sur le papier (marque absente, séquence 1 à 4).
- Sauvegarde restaurée : OK, marque absente, reclassement contre la voix globale actuelle. La sauvegarde n'est pas réécrite (création exclusive) : celle qui reste est celle d'avant la première montée.
- Fichier réécrit par la 0.3 : OK pour le classement. Mineur M-1 : la 0.3 n'est pas contrôlée ; un mode que l'utilisateur a mis lui-même à `chatterbox@8004` sans voix en version neuve (voix propre voulue) est revidé silencieusement après un passage par la 0.3 (ligne 3 de la table). Cas rare ; à dire dans « Négatives ».
- `global-voice.json` supprimé : cas « marque présente » traité. **M-2 (mineur) : trou** : fichier réécrit par la 0.3 (marque absente, `tts` déjà vides) ET `global-voice.json` absent. La séquence recalcule alors la voix depuis le `tts` vide de `lastSelectedId` : l'utilisateur perd Estelle sans message (voix `auto` selon `llmVoice.tts.*`). Dire que ce cas rend la voix système + le message, comme la ligne voisine.
- Deux fenêtres / deux dépôts : l'activation lance deux `load()` concurrents dans la même fenêtre (`Pipeline.ts:424` et `extension.ts:159`, `void profilesTree.refresh()`). La création exclusive et la relecture avant renommage protègent la voix et le classement ; le classement est déterministe, donc deux écritures identiques sont inoffensives. Reste, comme l'ADR le dit, une fenêtre de course entre la relecture et le renommage pour un `update()` concurrent (`ProfileRepository.ts:151-167`, sans verrou) : accepté.
- **M-3 (mineur).** `migrations.ts` est donné « pur » et complète la voix par `resolveTtsConfig`, qui exige `TtsSettings` (`resolveProviderConfig.ts:67`, réglages VS Code). Ni `load()` ni la signature annoncée `{ collection, voice?, lastSelectedId? }` ne reçoivent ces réglages. Préciser l'entrée (réglages passés en paramètre), sinon le dépôt les lit lui-même et la fonction n'est plus pure. Sans effet sur le cas réel ci-dessous (providerId et baseUrl sont explicites).

## 3. Le cas réel de guilhem-bonnet
Entrée : `lastSelectedId = faithful-local`, `defaultProfileId` quelconque, `bySource` par défaut `{claude-code: llm-summary}` (`package.json:572-576`) : aucune source ne vise `system-voice`.
- Voix globale initiale = `tts` de `faithful-local` = `{kyutai-pocket, http://localhost:8000, estelle}` ; `resolveTtsConfig` ne rajoute que providerId et baseUrl (`resolveProviderConfig.ts:79-82`), déjà présents ; `speed: 1`. Résultat : **Estelle**.
- `faithful-local` : mêmes valeurs que la voix globale, ligne 2 : vidé.
- `system-voice {system}` : ligne 4, vidé ; `hidden: true` ; `lastSelectedId` ne le vise pas.
- `quick-review {chatterbox, http://localhost:8004}` : ligne 3 (chatterbox à l'URL livrée `presets.ts:99`, aucune voix, ni paramètres, ni format, ni échantillon) : vidé. Il garde `playback.rate: 1.1` (`defaults.ts:108`).
- `technical-teacher` et `llm-summary` : leur forme n'a pas été donnée ni lue. Si elle est `{chatterbox, 8004}` comme quick-review, vidés. Si l'éditeur les a enregistrés (il écrit toujours `providerId` et `parameters`, `profileEditor.js:161-167`, selon l'ADR §2, non relu ici) avec des `parameters` différents du préréglage `{exaggeration 0.4, cfg_weight 0.5, temperature 0.6}`, ils restent « Voix propre » et NE suivent PAS Estelle. **Non vérifié : le `profiles.json` réel n'a pas été lu.** La carte 1-005 doit le lire avant la revue humaine.
- Résultat attendu (Professeur, Résumé, Révision et réponses de Claude suivent Estelle) : obtenu SI les deux profils non décrits ont la forme d'origine. Les réponses de Claude passent par `llm-summary` (bySource), donc suivent Estelle seulement si `llm-summary` est vidé ; c'est le profil le plus exposé au cas des `parameters` édités.
- Les tts d'utilisateur ne sont jamais touchés : la ligne 5 conserve tout le reste à valeur JSON égale.

## 4. Profil `voice-chain`, V1 à V3 avec le code existant
Réalisable, avec ces constats :
- Faux TTS retiré, vrais `ttsFor`/`createTtsProvider`/`ChatterboxProvider` : OK (`Pipeline.ts:1750-1803`, le faux n'intervient que si `ttsProviderOverride` est posé, `extension.ts:187-213`). Le serveur reçoit `POST /tts` ; `MockTtsServer` journalise le corps brut (`mockTtsServer.ts:95, 152-165`) et les noms d'échantillon (`:167-180`) : `voice_mode` et `predefined_voice_id` se lisent en parsant le corps.
- Faux puits : le `FakeAudioSink` n'est créé que dans le bloc gardé par `LLM_VOICE_TEST_FAKE_TTS` (`extension.ts:187-197`) ; le nouveau `LLM_VOICE_TEST_FAKE_SINK` demande bien un second point d'injection, avec la garde `extensionMode` (`:80-85`). Sans lui le puits est le webview, muet sous xvfb : non observable.
- `MockTtsServer.listen()` ne sait que le port éphémère (`:77`) : l'option de port de l'ADR est nécessaire pour la chaîne `auto` (surcharge d'environnement `LLM_VOICE_TEST_AUTO_CHATTERBOX_BASE_URL`, `extension.ts:245-248`, valeur fixée dans `.vscode-test.mjs`, donc avant que le serveur existe).
- **I-3 (important). Persistance entre exécutions.** Les `--user-data-dir` de `.vscode-test.mjs` sont des chemins fixes sous `.vscode-test/` (`:26-29`), jamais nettoyés : `global-voice.json`, `profiles.json` et le cache disque y survivent. Pour `voice-chain`, avec un port fixe pour la chaîne `auto`, la clé de cache (URL comprise) est identique d'une exécution à l'autre : V3 « première synthèse = un POST » échoue à la 2e exécution (cache chaud). Il faut, dans la configuration du profil : réécrire `profiles.json` et `global-voice.json` à chaque chargement (comme `seedAutoProfile`, `:94-120`) et soit vider le cache, soit `llmVoice.cache.enabled` ciblé par test, soit un texte unique par exécution. À ajouter à la description du profil dans l'ADR.
- **M-4 (mineur). V1 « réponse de Claude ».** L'entrée de l'inbox passe par `claude-code`, dont le défaut est `llm-summary` (narré, donc Ollama réel) ; `.vscode-test.mjs:206-226` documente que cela fait dépasser les 20 s de mocha. Le profil `voice-chain` doit donc fixer `modes.bySource.claude-code` sur un mode fidèle et un port narrateur fermé (comme le profil `integration-security`), et ne pas utiliser l'ancien réglage `llmVoice.profiles.bySource` du profil existant (`:220`). L'ADR ne le dit pas.
- Les tests de `voice-chain` doivent vivre dans leur propre dossier : le profil `fake-tts` globe tout `out/test/integration/**` (`:235`) et les exécuterait sans serveur.
- Le registre d'instances mémorise le fournisseur par clé (`Pipeline.ts:1765-1768`, `ChatterboxProvider` mémorise son envoi) : V2 « aucun nouvel envoi après choix d'une voix du catalogue » est vrai trivialement tant que l'instance clonée n'est pas réutilisée ; l'assertion utile est le corps (`predefined`, id de voix), pas le compteur d'envois.
- Script : `test:integration-voice` n'existe pas encore ; modèle `package.json:843`. Les contrôles de la carte 0-004 doivent le nommer (l'ADR le dit déjà, §Découpe).

## Corrections exactes à faire dans l'ADR
1. §2 (I-1) : lister les déclarations de schéma/types (`voiceMigration`, `hidden`), régénération du schéma JSON, et ajouter le test ProfileRepository à V7.
2. §2 (I-2) : l'installation neuve crée `global-voice.json` en même temps que la marque ; préciser que « Voix réinitialisée » ne s'émet pas dans ce cas.
3. §2 table (M-2) : ligne « marque absente, `global-voice.json` absent, `tts` vides » : voix système + message.
4. §2 (M-3) : entrée de la fonction de migration : réglages `TtsSettings` passés en paramètre.
5. « Négatives » (M-1) : un mode volontairement à la forme d'origine est revidé après un passage par la 0.3.
6. §Tests (I-3, M-4) : description du profil `voice-chain` : réécriture des deux fichiers à chaque chargement, cache neutralisé, mode fidèle pour `claude-code`, dossier de tests propre.

```grimoire-uncertainties
[
  {"where": "ProfileRepository.ts:75 et profile.schema.ts:175-179", "what": "Le retrait des clés inconnues par Zod (z.object sans passthrough) est déduit de la lecture du schéma et du comportement documenté de Zod, pas d'une exécution", "why": "Aucun test lancé ; un petit test vitest du round-trip load/write prouverait la survie de voiceMigration et hidden"},
  {"where": "profiles.json réel de guilhem-bonnet (technical-teacher, llm-summary)", "what": "Forme exacte de ces deux modes non fournie ni lue ; le résultat attendu (Résumé et réponses de Claude suivent Estelle) dépend de l'absence de parameters édités", "why": "Fichier réel non lu ; la ligne 3 de la table ne vide que la forme d'origine"},
  {"where": "media/profileEditor/profileEditor.js:161-167", "what": "L'affirmation de l'ADR que l'éditeur écrit toujours providerId et parameters est reprise telle quelle, non relue", "why": "Hors des quatre points demandés ; elle conditionne le risque ci-dessus"},
  {"where": "test/fakes/FakeAudioSink.ts et PlaybackController", "what": "Non vérifié que FakeAudioSink fait avancer la lecture de bout en bout (fin de segment) sans le FakeTtsProvider", "why": "Fichiers non lus ; V1 à V3 supposent que le puits factice termine les segments"},
  {"where": "ChatterboxProvider.ts (mémorisation de l'envoi d'échantillon)", "what": "Le comportement de mémorisation par instance est déduit du commentaire de Pipeline.ts:1757-1760 et de l'en-tête du fichier, pas relu dans le corps", "why": "Influe sur la valeur probante de la vérification V2 sur le compteur d'envois"}
]
```
