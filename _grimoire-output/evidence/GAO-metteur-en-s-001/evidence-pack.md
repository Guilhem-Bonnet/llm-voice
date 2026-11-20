# Evidence pack — GAO-metteur-en-s-001 (état intermédiaire, 2026-11-07)

## Fait
- Commit `de4a6fd` : incrément 2, partie code.
  - `vscode-extension/src/direction/cast/stagePlay.ts` : table états → consignes anglaises (données, aucune branche par état), au plus deux consignes, garde ASCII sans crochets, contexte (souffle et toux durent sur la réplique suivante du même personnage, une fois ; la narration ne joue jamais).
  - `ChunkVoice.direction` → `bindingForChunk` → requête (`TtsRequest.direction`) et clé de cache (`computeCacheKey` ajoute `direction:` seulement si présente : clés sans consigne inchangées).
  - Qwen3 : `direction.instructions: true` (`src/tts/presets.ts`) ; `Pipeline.castVoicesOf` en tire `playsStates`, passé à `assignCast`.
  - Point d'entrée `extraDirections` (consignes du metteur en scène, par id de segment) prévu dans `assignCast`, pas encore alimenté.

## Commandes exécutées (dans `vscode-extension/`, avant le commit)
- `npm run -s typecheck` : code 0.
- `npm run -s lint` : aucune sortie d'erreur.
- `npm run -s test:unit` : 153 fichiers, 3178 tests passés.
- `npm run -s build` : Done.
- `xvfb-run -a npx vscode-test --label fake-tts` : 79 passing ; `--label integration-security` : 8 passing ; `--label voice-chain` : 52 passing.

## Non fait / non prouvé
- Incrément 1 (propositions âge/genre/caractère avec citation vérifiée, colonne `proposal`, bouton « Appliquer ») : non commencé.
- Incrément 2 : consignes du metteur en scène pour les états hors table (« Il tire son épée ») non branchées ; aucune lecture réelle.
- Incrément 3 (démarrage anticipé d'après la vitesse mesurée) : non commencé.
- Aucune preuve audio réelle, aucune charge GPU lancée.

## Reprise du 2026-11-07 — incrément 1 (commit `7469bf6`)
- `vscode-extension/src/direction/director/castProposals.ts` : prompt, schéma JSON fermé (genre woman|man, âge child|young|adult|elderly, caractère = ids de `VOICE_TRAITS`), `verifyProposals` (citation absente → `quote-absent`, réduite à un nom → `name-only`, valeur hors liste → `invalid-value`), `nearestVoice` (tables de mots anglais par valeur comparées à la `description` de la voix, jamais la narratrice, voix libre devant à égalité), cache par document (`proposalCacheKey`), mode jeu → aucun appel.
- `OllamaDirectionLlm.structured()` (appel `propose`), `Pipeline.prepareCastProposals` (journal : comptes et raisons, aucun mot du texte), colonne proposition et boutons « Proposer d'après le texte » / « Appliquer » dans `media/castPanel/castPanel.js`, `description` lue dans `GET /voices`.
- Commandes : `npm run -s typecheck` 0 ; `lint` sans erreur ; `test:unit` 154 fichiers, 3187 tests passés ; `build` ok ; `vscode-test` integration-security 8 passing, voice-chain 52 passing ; fake-tts 1 échec au premier passage (« a narrated reading … goes past its first group », lecture narrée, hors du code touché), puis 79 passing deux fois de suite.
- Preuve réelle (Ollama `qwen2.5:7b`, local, drapeau gpu-yield absent vérifié dans le script) sur `docs/essais-voix/07-theatre-noms-seuls.md` : `propositions-07.json` — Isaure : femme d'après « Madame » ; Le Comte : homme d'après « seigneur » ; 0 rejet ; 6,9 s. « Elle pose sa lampe » non rendu (une citation par champ).
- Non fait : metteur en scène pour `extraDirections`, démarrage anticipé, preuve audio réelle.

## Reprise n° 2 du 2026-11-07
- `ab95f7d` : citation rattachée au personnage (`relatedTexts`, `FIELD_RELATIONS` en données : genre = réplique adressée ou indication qui suit ; âge et caractère = aussi sa propre réplique ; sinon `quote-unrelated`) ; metteur en scène local `src/direction/director/stateDirections.ts` (candidates = répliques précédées d'une indication ; le modèle rend un identifiant de `STAGE_PLAY_TABLE` et une citation vérifiée dans l'indication ; consigne prise dans la table ; doute, panne, mode jeu → voix figée) ; préparé par « Proposer d'après le texte », lu en cache par `castReadingFor` (`extraDirectionOf`). Avant commit : typecheck 0, lint ok, test:unit 155 fichiers / 3195 tests, build ok, fake-tts 79, integration-security 8, voice-chain 52 passing.
- `a3ba8be` : `src/playback/earlyStart.ts` (`canStartEarly`, pur) + `PlaybackController` (option `earlyStart`, recalcul à chaque passage prêt, événement `onEarlyStart`) + `Pipeline` (lecture préparée). Tour de parole entier pour `addressed`, parenthèses ignorées aux bords d'une citation. Avant commit : suite VS Code complète verte sur l'arbre de l'étape 3 (79 / 8 / 52) ; après la petite reprise de citation : typecheck 0, lint ok, test:unit 156 fichiers / 3201 tests, build ok (suites VS Code non relancées après cette reprise).
- Preuve réelle LLM (`metteur-07.json`, Ollama qwen2.5:7b local, drapeau gpu-yield absent au départ) sur `07-theatre-noms-seuls.md` : propositions Isaure femme d'après « Madame », Le Comte homme d'après « seigneur », 0 rejet, 2,7 s ; metteur en scène : 2 candidates (avant « Parlez… » d'Isaure : « Elle pose sa lampe sur la table. » ; avant « Non. Je reste… » du Comte : « Il tire son épée. »), 0 consigne retenue, 1 rejet `quote-absent` (c2), 3,5 s. Pour c1, le modèle a rendu null (geste neutre).
- Non fait : preuve audio réelle sur sink nul (premier son avant/après, plus long silence, WER, temps de préparation avec voix jouée) ; démarrage anticipé non éprouvé sur une vraie lecture.

## Reprise n° 3 du 2026-11-07
- Diagnostic local (journal dans le dossier temporaire de session, ni commité ni dans les journaux de l'extension) : pour c2 le modèle rendait `state: determined` mais citait la **réplique** (« Non. Je reste… ») au lieu de l'indication ; pour c1 `state: null` avec la réplique citée. Correction `ca73705` : le schéma JSON n'autorise plus comme citation que des fragments exacts des indications (`indicationFragments`), consigne et exemples (exemples volontairement absents des textes d'essai). Après correction, deux passages identiques : c1 null « Elle pose sa lampe sur la table », c2 determined « Il tire son épée » → consigne « Determined and resolute, a firm steady voice, ready to fight » retenue. Sur `theatre-demo.md` : 3 candidates, 2 consignes (tender d'après « une lettre à la main », ironic d'après « à part » — la table, prioritaire, donne la voix intérieure pour « à part ») ; propositions : 3 rejets `quote-unrelated`, 0 retenue.
- Vérifs avant `ca73705` : typecheck 0, lint ok, build ok, test:unit 3201/3202 (échec unique : test de durée « 1 Mo en moins d'une seconde » de parseScript, fichier non touché, Ollama en charge au même moment).
- Étape 2 : `test/unit/playback/earlyStartController.test.ts` (durées connues → départ anticipé avec 2 mesures ; sans durée → aucun événement, attente de tout ; moteur lent → attente de tout).
- Étape 3 préparée : scénario `--qwen3-cast` de `scripts/audio-proof/native-real.sh` (07, mots interdits « lampe épée », silence < 1,2 s), `test/integration-native-real/qwen3-cast.test.ts`, crochets de test `setEarlyStartForTest` / `lastCastDirectionsForTest`.
