# Agentic Evidence Pack

## Summary

- Task id: GAO-jeu-d-acteur-001
- Profile: controlled
- Outcome: Jeu d'acteurs : plusieurs voix pour le théâtre et le livre, narrateur et personnages — critères : AC-001 test: npm --prefix vscode-extension run test:unit vert; AC-002 revue: essai de guilhem-bonnet consigné dans acceptance-record; AC-003 gate: grimoire standard gate check --strict vert
- Final state: in_progress (2026-11-06) : étapes 1 à 4 livrées hors preuve audible, qui revient au concierge

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD 4775f57 | git rev-parse --short HEAD | référence (2026-11-06) |
| Tests écrits avant le code | `vscode-extension/test/unit/playback/audio-queue-cast.test.ts`, `reading-preparer.test.ts`, `test/unit/direction/script/parseScript.test.ts`, `test/unit/direction/cast/{casting,synthesisPlan}.test.ts` | `npx vitest run` avant les modules | rouge constaté : 5 fichiers en échec, 6 tests en échec, 1 réussi |
| Contrat de voix par passage | `src/core/playback.ts`, `src/playback/AudioQueue.ts` (`bindingForChunk`, `cacheKeyFor`, `bindingFor`) | `audio-queue-cast.test.ts` | clé et requête dorées, narrateur à clé identique, `speakerId` hors de la clé |
| Reconnaissance | `src/direction/script/parseScript.ts`, `scriptFidelity.ts` | `parseScript.test.ts` | table des formes, 8 textes d'essai, aucun personnage sur `docs/adr`, `CHANGELOG.md`, `docs/Documentation-humaine`, 1 Mo sous 1 s |
| Distribution | `src/direction/cast/casting.ts`, `castStore.ts`, `castSegments.ts` | `casting.test.ts` | stabilité sur bible rechargée, 35 voix uniques, verrou, `%` en `casting`, mémoire seule |
| Plan de lecture | `src/direction/cast/synthesisPlan.ts`, `src/playback/ReadingPreparer.ts` | `synthesisPlan.test.ts`, `reading-preparer.test.ts` | `D` sur table, 15,4 s pour la scène de l'ADR, aucun sink |
| Chaîne réelle hors GPU | `test/integration-voice/cast-voices.test.ts` | `npm run test:integration-voice` | `voice_url` par personnage reçue par `MockTtsServer`, dans l'ordre, un seul POST à la fois, relecture sans POST |
| Textes d'essai | `docs/essais-voix/theatre-demo.md`, `06` à `12`, leurs `.attendu.json` | écrits pour cette carte | texte original, voir écarts |

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Types | `npm run -s typecheck` (dans `vscode-extension/`) | code 0 | sortie vide |
| Lint | `npm run -s lint` | code 0 | sortie vide, `--max-warnings=0` |
| Tests unitaires | `npm run -s test:unit` | code 0 | `Test Files 139 passed (139)`, `Tests 2820 passed (2820)` |
| Build | `npm run -s build` | code 0 | `dist/extension.js` produit |
| Intégration fake-tts | `xvfb-run -a npx vscode-test --label fake-tts` | code 0 | `73 passing (10s)` |
| Intégration voix | `npm run -s test:integration-voice` | code 0 | `35 passing (1m)`, dont 11 de `voice-chain: jeu d'acteurs (ADR-018)` |
| Test instable, hors périmètre écrit | `voice-gallery.test.ts`, « favorites live in globalState » | 1 échec sur 6 passes de `voice-chain` | assertion `favorites` fausse juste après le dispatch ; cause non établie ; les 5 autres passes sont vertes |
| Sécurité du panneau | `xvfb-run -a npx vscode-test --label integration-security` | code 0 | `8 passing (12s)` |
| Serveur 1.6B | `python3 deploy/kyutai16/test_server.py` | code 0 | `Ran 50 tests in 20.067s`, `OK` (serveur non modifié) |
| Paquet | `npm run -s package:linux-x64` | code 0 | `DONE Packaged: llm-voice-linux-x64.vsix (49 files, 1.89 MB)`, `check-vsix: no test code, no sources, no maps, no secrets` |
| Gate de la carte | `grimoire standard gate check --task-id GAO-jeu-d-acteur-001 --strict` | non exécuté | revient au concierge |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | yes | enveloppe remplie avant modification, aucun commit | gate au concierge |
| Quality | yes | tests écrits d'abord, sorties ci-dessus | preuve audible à faire |
| Runtime | partial | `MockTtsServer`, sink factice | GPU, banc et service kyutai16 non touchés |
| Knowledge | no |  |  |
| Model/provider | no |  |  |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| `ReadingPreparer` minimal livré dès l'étape 4 | Le choix confirmé « Préparer » existe ; budget du cache, estimation de taille et reprise du mode jeu restent à l'étape 6 | à valider par guilhem-bonnet | étape 6 |
| `addRole` en origine `analyst`, pas `casting` | `reducer.test.ts:55` fige `casting` à `assignVoice` ; le contrat de la bible ne change pas | à valider | relecture d'ADR-018 §3 |
| Coût non corrigé par les temps réels de la session, modèle froid non ajouté à `D` | Le seuil de 20 s repose sur le modèle déduit | à valider | étape 0 |
| Fenêtre de 120 s calculée sur la durée moyenne des passages | Une scène très irrégulière a une fenêtre approximative | à valider | étape 0 |
| Textes d'essai originaux, pas du domaine public | ADR-018 demandait des textes sourcés ; le brief les demande écrits | concierge (brief) | banc |
| Panneau Distribution remplacé par Quick Pick, « Écouter » absent | Prévu par l'étape 4 ; le panneau est l'étape 5 | ADR-018 §7 | étape 5 |
| `listVoices` de 1.6B fait un appel réseau, ancien test « without a call » réécrit | ADR-018 §3 le demande ; repli sur le catalogue | ADR-018 §3 | galerie |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Preuve réelle rejouée par le concierge (2026-11-06)

- `scripts/audio-proof/native-real.sh --cast` : code 0, `kyutai-cast.test.ts` 1 passing. VS Code réel, moteur natif, Core réel, Kyutai 1.6B, sink nul, faster-whisper. Sortie : `preuve-audio-reelle.json`.
- Quatre voix relevées dans le journal du serveur : `cml-577_394`, `cml-4724_3731`, `cml-10179_11051`, `cml-8128_7016` ; 29 requêtes, toutes 200.
- Personnages vus à l'écran : Narrateur · Camille, Madeleine · Mika, Anselme · Andréa, Lucien · Noam. Aucun nom `MADELEINE :` dans la transcription.
- **WER 0,1186**, au-dessus de l'objectif de 10 % de l'ADR, sous le seuil du banc de 0,25. Écarts entendus par le transcripteur : « clef » en « cleuf », « scène » en « Seine », noms propres, indications très courtes (« à part » en « Très la part »). Non départagé entre le modèle et le transcripteur : écoute humaine requise.
- Premier son à 51,6 s avec le modèle déjà chargé (« Lire quand même », passages préparés d'avance) ; lecture totale 126 s ; plus long silence entre deux sons 1,34 s.
- Étape 0, mesuré sur 29 passages : 2,28 s + 0,0412 s par caractère. Modèle de l'ADR (1,8 s + 0,84 × durée à 17 car/s) : 96,8 s prédites pour 103,3 s réelles, écart moyen 0,33 s par passage.
- Rejeu : typecheck 0, lint 0, build 0, unitaires 2820 réussis, fake-tts 73, voice-chain 35 (deux passes), integration-security 8. Test des favoris renforcé : état stable 2 s exigé ; cause de l'échec isolé (1 sur 6) non établie.
- Rendu du bloc Document ouvert à 260, 320 et 500 px : `panneau-260-320-500.png`, boutons à taille fixe, sans étirement ni retour à la ligne interne.
- Non testé : Précédent et Suivant entre voix ; écoute de guilhem-bonnet (critère AC-002).

## Relecture indépendante du commit a851b70 (2026-11-06), à corriger avant clôture

1. Lien Markdown dans une réplique : la parenthèse de l'URL est prise pour une indication, le jeu d'acteurs est abandonné pour tout le document (exécuté).
2. Mot en capitales seul (`FIN`, `RIDEAU`) : devient un personnage, avec sa voix et une entrée dans la bible (exécuté).
3. Parenthèse d'un mot dans une réplique (`Je (ne) sais`) : la voix change au milieu de la phrase (exécuté).
4. Ponctuation seule après une indication supprimée (`Viens (bas) ?`) (lecture du code).
5. Fichier texte : la garde compare normalisé contre normalisé, alors que la lecture simple livre le texte brut ; mots différents sans message (exécuté).
6. Préparer saute `prepareEngine` : à froid, seul le délai de 60 s protège le premier passage. Vérifié : `tts.timeoutMs` vaut 60000, `loadsOnDemand` vrai ; échec non observé.
7. Stop n'arrête ni une préparation ni une question ouverte ; une réponse tardive démarre après un Stop (lecture du code).
8. Messages trompeurs : suspension mémoire dite « ne répond pas » ; narrateur absent de `/voices` dit « demande une voix 1.6B ».
9. `warmUp` coupé dès l'activation, même sans personnage ni mode Fidèle.
Mode jeu : pendant la préparation, le serveur répond 503 et la préparation passe à `held` ; aucun contournement relevé côté code du commit.

## Corrections de la relecture (2026-11-06), arbre de travail non commité, base f038bed

Rouge constaté d'abord. Unitaires : `test/unit/direction/script/parseScript-relecture.test.ts`, 44 échecs sur 53 avant le code. Intégration : 12 échecs sur 25 dans `voice-chain: jeu d'acteurs`, tests compilés contre le paquet `dist/` de la base. Trois de ces rouges étaient dus au profil (`readyTimeoutMs: 0`) ; une fois les tests corrigés, ils ont été revus rouges par mutation : `prepareEngine` retiré, garde de « Lire » retirée (`'playing' !== 'idle'`).

| # | Correction | Test |
|---|---|---|
| 1 | Cible de lien, image, code en ligne, adresse protégés ; `inlineText` équilibre les parenthèses d'URL | `1. lien Markdown…` ; `un lien dans une réplique…` |
| 2 | Mots de structure, sigle sans voyelle exclus ; nom présent une fois : refusé en forme seule ou `NOM :` sans réplique, admis en `NOM : réplique` à partir de 4 lettres ; une ligne en capitales refusée, en tête de paragraphe, coupe le locuteur courant | `2. un mot en capitales…` |
| 3 | `src/direction/script/stageDirection.ts` : collée à un mot, référence, phrase coupée : non ; tête de réplique ou entre deux phrases : oui ; ailleurs : forme d'indication exigée | `3. une parenthèse…` |
| 4 | La ponctuation seule suit la réplique (`closing`), ou l'indication s'il n'y a pas de réplique à compléter | `4. la ponctuation…` |
| 5 | `parseScript(…, { plainText })`, `plainScriptSegments`, garde sur `plainReadingOf` (la même fonction que la lecture simple) | `5. un fichier texte…` ; `un fichier texte à plusieurs voix…` |
| 6 | `prepareEngine` avant le premier passage de « Préparer », aucun test du drapeau côté client : le serveur refuse | `Préparer à froid…` ; `Préparer suspendue…` |
| 7 | `stop` et `dispose` annulent question et préparation ; toute réponse tardive vérifiée (`over()`) | `Arrêter ferme la question…`, `Arrêter annule…`, `Arrêter pendant le chargement…`, `« Lire » répondu…` |
| 8 | Titre de `HOLD_NOTICES`, erreur réelle du passage (`failed.error`), `CAST_NARRATOR_ABSENT` | `Préparer suspendue…`, `Préparer en échec…`, `un narrateur absent…` |
| 9 | Préchauffage décidé après `castReadingFor`, coupé seulement si `cast.voices` existe | `le préchauffage n'est coupé…` |
| plus | Précédent et Suivant sur le faux serveur | `Précédent et Suivant…` (vert dès l'écriture) |

Instabilités :

- Test « une voix changée » : 0 échec sur 6 passes de la suite de base, puis sur 8 passes ciblées sous charge CPU. Deux causes reproduites à la demande. (a) Second chargement de `.vscode-test.mjs` pendant un passage : il vide et réécrit tous les profils ; même test en échec, code 1. Corrigé : seul le profil du libellé demandé est touché ; `voice-chain` et `integration-security` ont ensuite tourné ensemble, verts. (b) Voix fixe du test égale à la voix automatique de Lucien : 554 chemins sur 20 000 (`cast-collision-179` a donné `[]`). Corrigé dans le test. Laquelle a frappé l'autre agent : non établi.
- Bug de produit trouvé en cherchant : deux écritures de `globalState` à quelques millisecondes d'écart perdent la seconde. Sonde temporaire : 118 sur 400, même valeur fausse 15 ms après. Code de VS Code 1.145 lu : `onDidChangeStorage` remplace `_value` par l'écho. `toggleCast` perdait l'activation dès le premier croisement (test rouge, `lecture 0`). Corrigé pour `toggleCast` seul (`castChoices`, écriture vérifiée).
- « favorites live in globalState » : même mécanisme, établi en une passe de sonde sur `globalState`, sans rejouer l'échec du test lui-même. Produit non corrigé pour les favoris, voix récentes, mesures d'attente.

| Check | Commande | Résultat |
|---|---|---|
| Types | `npm run -s typecheck` | code 0 |
| Lint | `npm run -s lint` | code 0 |
| Unitaires | `npm run -s test:unit` | code 0, 144 fichiers, 2960 tests |
| Build | `npm run -s build` | code 0 |
| fake-tts | `xvfb-run -a npx vscode-test --label fake-tts` | code 0, 77 passing |
| Sécurité | `xvfb-run -a npx vscode-test --label integration-security` | code 0, 8 passing |
| Voix | `npm run -s test:integration-voice`, 4 passes | code 0 à chaque passe, 50 passing |
| Preuve réelle | `scripts/audio-proof/native-real.sh --cast`, drapeau de jeu absent, port 8020 prêt | code 0, `preuve-audio-relecture.jsonl` |

Preuve réelle : WER 0,0734 (une mesure, contre 0,1186 au passage précédent, écart non expliqué) ; premier son 49,9 s ; lecture 123,6 s ; plus long silence entre deux sons 1,2 s ; 29 requêtes, toutes 200 ; quatre voix `cml-577_394`, `cml-4724_3731`, `cml-10179_11051`, `cml-8128_7016` ; à l'écran Narrateur · Camille, Madeleine · Mika, Anselme · Andréa, Lucien · Noam.

Limite mesurée de la règle des parenthèses, avant le retrait des participes en `-é` : 1855 lignes de `docs/adr` et du CHANGELOG, forcées en `@a:` : 35 ont une partie au narrateur, 2 sont refusées par la garde (lignes coupées au milieu d'un code). Aucun mot perdu. Mesure non refaite après ce retrait.

Non fait : écoute de guilhem-bonnet, `dispose` exécuté, gate, ADR-018 §1 à mettre à jour avec ces règles.

## Indications jouées et passages regroupés (2026-11-06), arbre de travail non commité, base d95635a

Décision de guilhem-bonnet : « Quand il y a des termes comme essoufflé, ce n'est pas au narrateur de prononcer le mot essoufflé. » L'indication n'est plus dite et l'état reste connu ; le jeu audible n'est pas livré.

Rouge constaté d'abord : `test/unit/direction/script/stageReading.test.ts` et `test/unit/playback/passageGroups.test.ts`, 70 échecs sur 79 ; `theatre-demo.attendu.json` révisé, 1 échec dans `parseScript.test.ts`.

| Check | Commande | Résultat |
|---|---|---|
| Codes (voice et voice2 : passes intermédiaires, voir ligne Voix) | typecheck, lint, test:unit, build, fake-tts, integration-security, integration-voice | typecheck code=0 ; lint code=0 ; unit code=0 ; build code=0 ; fake code=0 ; security code=0 ; voice code=1 ; fini ; voice2 code=1 |
| Unitaires | `npm run -s test:unit` | ['Tests  3133 passed (3133)'] |
| fake-tts | `xvfb-run -a npx vscode-test --label fake-tts` | ['79 passing (8s)'] |
| Sécurité | `xvfb-run -a npx vscode-test --label integration-security` | ['8 passing (13s)'] |
| Voix | `npm run -s test:integration-voice` | 1re passe 46 passing, 5 failing ; 2e 49 passing, 2 failing : attentes de test périmées ou fautives, aucune correction de `src/` ; dernière passe après correction des tests : 51 passing (2m) ; voice3 code=0 |
| Panneau | Chromium headless, vrais `player.js` et `player.css`, cadre à 260, 320, 500 px | pas de défilement horizontal, ligne dans le cadre (10 à largeur - 10), 4 boutons visibles, 24 px de haut, `nowrap`, aucun débordement ; rendus `mesures-regroupement/*.png` |

Passes réelles, `scripts/audio-proof/native-real.sh --cast` et `--response-adapted`, drapeau de jeu vérifié avant chaque passe (`journal.txt`). Valeurs par passe, séparées par `/`. Sorties brutes : `mesures-regroupement/`.

| Texte | État | Passes | Requêtes | Premier son (s) | Total (s) | Synthèse (s) | WER | WER moyen |
|---|---|---|---|---|---|---|---|---|
| scène | base, `maxSentences: 1`, série 1 | 3 | 29/29/29 | 49.6/50.1/52.2 | 117.5/121.2/122.6 | 99.7/102.2/106.0 | 0.113/0.1017/0.1017 | 0.1055 |
| scène | base, `maxSentences: 1`, série 2 | 3 | 29/29/29 | 49.8/49.9/50.9 | 121.4/121.6/124.3 | 101.0/100.6/101.9 | 0.1073/0.113/0.1186 | 0.113 |
| scène | base, `maxSentences: 3` | 3 | 18/18/18 | 33.0/34.7/34.7 | 99.1/101.7/104.7 | 80.1/82.0/83.1 | 0.0847/0.1017/0.1073 | 0.0979 |
| scène | après, `maxSentences: 3` | 3 | 15/15/15 | 27.9/27.6/27.7 | 94.8/96.4/94.7 | 76.6/77.5/76.3 | 0.0625/0.108/0.0852 | 0.0852 |
| réponse | base | 3 | 6/6/6 | 8.9/9.3/8.9 | 21.4/21.4/20.4 | 22.3/22.2/21.2 | 0.1667/0.1667/0.2917 | 0.2084 |
| réponse | après | 3 | 3/3/3 | 14.3/15.0/13.6 | 24.0/25.7/22.7 | 17.2/17.6/16.2 | 0.125/0.0417/0.0417 | 0.0695 |

Journal :

```
base--cast-1 code=0 duree=153
base--cast-2 code=0 duree=156
base--cast-3 code=0 duree=160
base--response-adapted-1 code=0 duree=53
base--response-adapted-2 code=0 duree=52
base--response-adapted-3 code=1 duree=50
base3--cast-1 code=0 duree=150
base3--cast-2 code=0 duree=151
base3--cast-3 code=0 duree=153
base3--cast-3 code= duree=153
apres--cast-1 code=0 duree=124
apres--cast-2 code=0 duree=125
apres--cast-3 code=0 duree=124
apres--response-adapted-1 code=0 duree=52
apres--response-adapted-2 code=0 duree=53
apres--response-adapted-3 code=0 duree=50
base3b--cast-1 code=0 duree=132
base3b--cast-2 code=0 duree=131
base3b--cast-3 code=0 duree=135
```

- `base--cast-1` : WER 0.113, requêtes 29, essouffl entendu : non, mots attendus absents de la transcription : anselme, capitales, garder, n'entend, rends, rendue, sait, tenez, voici, voix
  entendu : La clef du jardin. La scène courte écrite pour essayer la lecture à plusieurs voies. Les noms en capital ne sont pas dits. Les indications sont lues par le narrateur. Scène unique. Le soir dans un jardin. Une lanterne éclaire le banc. Tu arrives bien tard en Selma. J'ai cru que tu ne viendrais plus. C'est soufflé. J'ai couru depuis le pont. Le portail était fermé et la clef n'est plus à sa place. La clef, mais c'est toi qui l'avais hier soir. Moi, je l'ai rendu à ton frère devant la fontaine. Le Lucien entre une lettre à la main. Vous cherchez ceci peut-être ? Elle était dans la poche de mon manteau. Lucien, depuis quand nous écoutes-tu ? Depuis assez longtemps pour savoir que personne ici ne s'est gardé une clef. Nous rentrons là et n'en parlons plus. Qui a part ? Il ne se doute de rien. Bien. Alors fermons ce portail et rentrons avant la pluie. La lanterne s'éteint. On entend plus que le vent dans les branches.
- `base--cast-2` : WER 0.1017, requêtes 29, essouffl entendu : non, mots attendus absents de la transcription : anselme, capitales, clef, rends, rendue, scène, tenez
  entendu : La clœuf du jardin. Seine, courte, écrite pour essayer la lecture à plusieurs voix. Les noms en capital ne sont pas dits. Les indications sont lues par le narrateur. Seine unique. Le soir dans un jardin. Une lanterne éclaire le banc. « Tu arrives bien tard, Hanselme. J'ai cru que tu ne viendrais plus. » « Et soufflé. J'ai couru depuis le pont. Le portail était fermé, et la clœuf n'est plus à sa place. » « La clœuf ? Mais c'est toi qui l'avais hier soir. » « Moi ? Je l'ai rendu à ton frère devant la fontaine. » « Le Lucien entre une lettre à la main. » « Vous cherchez ceci peut-être. Elle était dans la poche de mon manteau. » « Le Lucien. Depuis quand nous écoutes-tu ? » « Depuis assez longtemps pour savoir que personne ici ne sait garder une clœuf. » « Le rang-là. Et n'en parlons plus. » « Pas à part. » « Il ne se doute de rien. En tenant la voici. » « Bien. Alors fermons ce portail et rentrons avant la pluie. » « La lanterne s'éteint. On n'entend plus que le vent dans les branches. »
- `base--cast-3` : WER 0.1017, requêtes 29, essouffl entendu : non, mots attendus absents de la transcription : anselme, capitales, garder, part, rends, rendue, sait, voix
  entendu : La clef du jardin, une scène courte écrite pour essayer la lecture à plusieurs voies. Les noms en capital ne sont pas dits, les indications sont lues par le narrateur. Seine unique, de le soir, dans un jardin. Une lanterne éclaire le banc. Tu arrives bien tard, Hanselme. J'ai cru que tu ne viendrais plus. Des soufflés, j'ai couru depuis le pont. Le portail était fermé et la clef n'est plus à sa place. La clef ? Mais c'est toi qui l'avais hier soir. Moi ? Je l'ai rendu à ton frère, devant la fontaine. Lucien entre, une lettre à la main. Vous cherchez ceci peut-être. Elle était dans la poche de mon manteau. Lucien, depuis quand nous écoutes plus ? Depuis assez longtemps pour savoir que personne ici ne s'est gardé une clef. On l'a, et n'en parlons plus. Trappard. Il ne se doute de rien, tenez, la voici. Bien, alors fermons ce portail et rentrons avant la pluie. La lanterne s'éteint. On n'entend plus que le vent dans les branches.
- `base3--cast-1` : WER 0.1073, requêtes 29, essouffl entendu : non, mots attendus absents de la transcription : anselme, capitales, garder, part, rends, rendue, sait, scène, voix
  entendu : La clef du jardin. Seine, courte, écrite, pour essayer la lecture à plusieurs voies. Les noms en capital ne sont pas dits, les indications sont lues par le narrateur. Seine, unique, le soir, dans un jardin. Une lanterne éclaire le banc. Tu arrives bien tard, Hanselme. J'ai cru que tu ne viendrais plus. N'ai soufflé. J'ai couru depuis le pont. Le portail était fermé, et la clef n'est plus à sa place. La clef ? Mais c'est toi qui l'avais hier soir. Moi ? Je l'ai rendu à ton frère, devant la fontaine. Le Lucien entre, une lettre à la main. Vous cherchez ceci peut-être ? Elle était dans la poche de mon manteau. Lucien, depuis quand nous écoutes-tu ? Depuis assez longtemps pour savoir que personne ici ne s'est gardé une clef. Il rentre là, et n'en parlons plus. Il ne se doute rien. Et tenez, la voici. Bien. Alors fermons ce portail, et rentrons avant la pluie. La lanterne s'éteint. On n'entend plus que le vent dans les branches.
- `base3--cast-2` : WER 0.113, requêtes 29, essouffl entendu : non, mots attendus absents de la transcription : anselme, capitales, rends, rendue
  entendu : La clef du jardin. La scène courte écrite pour essayer la lecture à plusieurs voix. Les noms en capital ne sont pas dits. Les indications sont lues par le narrateur. Seine unique. Le soir, dans un jardin. Une lanterne éclaire le banc. Tu arrives bien tard, en cellule. J'ai cru que tu ne viendrais plus. T'es soufflée. J'ai couru depuis le pont. Le portail était fermé, et la clef n'est plus à sa place. La clef ? Mais c'est toi qui l'avais hier soir. Moi, je l'ai rendu à ton frère, devant la fontaine. Lucien, entre une lettre à la main. Vous cherchez ceci peut-être. Elle était dans la poche de mon manteau. Et Lucien ? Depuis quand nous écoutes-tu ? Depuis assez longtemps pour savoir que personne ici ne sait garder une clef. Prends-la, et n'en parlons plus. T'es à part. Il ne se doute rien. Tenez, la voici. Bien, alors fermons ce portail, et rentrons avant la pluie. La lanterne s'éteint. On n'entend plus que le vent dans les branches. Même si nous célébrons au jour...
- `base3--cast-3` : WER 0.1186, requêtes 29, essouffl entendu : non, mots attendus absents de la transcription : anselme, capitales, garder, n'entend, part, rends, rendue, sait, scène, voix
  entendu : La cleuve du jardin. Seine courte écrite pour essayer la lecture à plusieurs voies. Les noms en capital ne sont pas dits, les indications sont lues par le narrateur. Seine unique, le soir, dans un jardin. Une lanterne éclaire le banc. Tu arrives bien tard, Hanselme. J'ai cru que tu ne viendrais plus. J'ai couru depuis le pont. Le portail était fermé et la cleuve n'est plus à sa place. La cleuve ? Mais c'est toi qui l'avais hier soir. Moi. Je l'ai rendu à ton frère, devant la fontaine. Le Lucien entre eux, une lettre à la main. Vous cherchez ceci peut-être ? Elle était dans la poche de mon manteau. Lucien. Depuis quand nous écoutes-tu ? Depuis assez longtemps pour savoir que personne ici ne s'est gardé une clef. Prends-la et n'en parlons plus. Tu n'as pas. Il ne se doute de rien. Tenez, la voici. Bien. Alors fermons ce portail et rentrons avant la pluie. La lanterne s'éteint. On entend plus que le vent dans les branches.
- `base3b--cast-1` : WER 0.0847, requêtes 18, essouffl entendu : non, mots attendus absents de la transcription : anselme, capitales, fermons, pluie, rendue, scène, voix
  entendu : La clef du jardin. Seine, courte, écrite pour essayer la lecture à plusieurs voies. Les noms en capital ne sont pas dits. Les indications sont lues par le narrateur. Seine unique. Le soir, dans un jardin. Une lanterne éclaire le banc. « Tu arrives bien tard, Hanselme. J'ai cru que tu ne viendrais plus. « Il est soufflé. J'ai couru depuis le pont. Le portail était fermé, et la clef n'est plus à sa place. « La clef, mais c'est toi qui l'avais hier soir. » « Moi ? Je l'ai rendu à ton frère devant la fontaine. » « Le Lucien entre une lettre à la main. » « Vous cherchez ceci peut-être ? Elle était dans la poche de mon manteau. « Lucien, depuis quand nous écoutes-tu ? » « Depuis assez longtemps pour savoir que personne ici ne sait garder une clef. « Rends-là, et n'en parlons plus. « T'es à part ? » « Il ne se doute de rien. Tenez, la voici. « Bien, alors serre-mon ce portail et rentrons avant la puce. » La lanterne s'éteint. On n'entend plus que le vent dans les branches.
- `base3b--cast-2` : WER 0.1017, requêtes 18, essouffl entendu : oui, mots attendus absents de la transcription : anselme, capitales, clef, n'en, n'entend, part, rends, rendue, scène
  entendu : La clœuf du jardin. Seine courte, écrite pour essayer la lecture à plusieurs voix. Les noms en capital ne sont pas dits. Les indications sont lues par le narrateur. Seine unique. Le soir, dans un jardin, une lanterne éclaire le banc. Tu arrives bien tard, Hanselme. J'ai cru que tu ne viendrais plus. Dessoufflé. J'ai couru depuis le pont. Le portail était fermé et la clœuf n'est plus à sa place. La clœuf, mais c'est toi qui l'avais hier soir. Moi, je l'ai rendu à ton frère devant la fontaine. Le Lucien entre, une lettre à la main. Vous cherchez ceci peut-être ? Elle était dans la poche de mon manteau. Le Lucien, depuis quand nous écoutes-tu ? Depuis assez longtemps pour savoir que personne ici ne sait garder une clœuf. Rend-la, et non parlons plus. Trappard. Il ne se doute de rien. Tenez, la voici. Bien. Alors fermons ce portail, et rentrons avant la pluie. La lanterne s'éteint. On entend plus que le vent dans les branches.
- `base3b--cast-3` : WER 0.1073, requêtes 18, essouffl entendu : non, mots attendus absents de la transcription : anselme, capitales, fontaine, garder, noms, rends, rendue, sait, scène, voix
  entendu : La clef du jardin. Seine, courte, écrite pour essayer la lecture à plusieurs voies. Les nons en capital ne sont pas dits. Les indications sont lues par le narrateur. Seine, unique. Le soir, dans un jardin, une lanterne éclaire le banc. « Tu arrives bien tard en Selmé. J'ai cru que tu ne viendrais plus. » « Non mais soufflez. J'ai couru depuis le pont. Le portail était fermé et la clef n'est plus à sa place. » « La clef ? Mais c'est toi qui l'avais hier soir. » « Moi, je l'ai rendu à ton frère devant la fontelle. » « Le Lucien entre une lettre à la main. » « Vous cherchez ceci peut-être ? Elle était dans la poche de mon manteau. » « Lucien, depuis quand nous écoutes-tu ? » « Depuis assez longtemps pour savoir que personne ici ne s'est gardé une clef. » « Nous allons là et n'en parlons plus. » « À la part ? » « Il ne se doute de rien. Tenez, la voici. » « Bien. Alors fermons ce portail et rentrons avant la pluie. » « La lanterne s'éteint. On n'entend plus que le vent dans les branches. »
- `apres--cast-1` : WER 0.0625, requêtes 15, essouffl entendu : non, mots attendus absents de la transcription : anselme, capitales, n'entend, rends, rendue, scène, voix
  entendu : La clef du jardin. Seine courte, écrite pour essayer la lecture à plusieurs voies. Les noms en capital ne sont pas dits. Les indications sont lues par le narrateur. Seine unique. Le soir, dans un jardin. Une lanterne éclaire le banc. Tu arrives bien tard en Selmé. J'ai cru que tu ne viendrais plus. J'ai couru depuis le pont. Le portail était fermé, et la clef n'est plus à sa place. La clef. Mais c'est toi qui l'avais hier soir. Moi. Je l'ai rendu à ton frère devant la fontaine. Lucien entre. Une lettre à la main. Vous cherchez ceci, peut-être? Elle était dans la poche de mon manteau. Lucien. Depuis quand nous écoutes-tu? Depuis assez longtemps pour savoir que personne ici ne sait garder une clef. Taurendla. Et n'en parlons plus. Par à part. Il ne se doute de rien. Tenez, la voici. Bien. Alors fermons ce portail et rentrons avant la pluie. La lanterne s'éteint. On entend plus que le vent dans les branches.
- `apres--cast-2` : WER 0.108, requêtes 15, essouffl entendu : non, mots attendus absents de la transcription : anselme, capitales, garder, part, rends, rendue, s'éteint, sait, scène, voix
  entendu : La clœuf du jardin. Seine courte, écrite pour essayer la lecture à plusieurs voies. Les noms en capital ne sont pas dits, les indications sont lues par le narrateur. Seine unique. Le soir, dans un jardin, une lanterne éclaire le banc. Tu arrives bien tard, Anselm. J'ai cru que tu ne viendrais plus. J'ai couru depuis le pont. Le portail était fermé et la clœuf n'est plus à sa place. La clœuf? Mais c'est toi qui l'avais hier soir. Moi? Je l'ai rendu à ton frère, devant la fontaine. Le Lucien entre, une lettre à la main. Vous cherchez ceci peut-être? Elle était dans la poche de mon manteau. Lucien, depuis quand nous écoutes-tu? Depuis assez longtemps pour savoir que personne ici ne s'est gardé une clef. Rennes-là et n'en parlons plus. Il n'en se doute de rien. Tenez, la voici. Bien. Alors fermons ce portail et rentrons avant la pluie. La lanterne s'étend. On n'entend plus que le vent dans les branches.
- `apres--cast-3` : WER 0.0852, requêtes 15, essouffl entendu : non, mots attendus absents de la transcription : anselme, capitales, quand, rends, rendue, scène, voix, écoutes
  entendu : La clef du jardin. Seine courte, écrite pour essayer la lecture à plusieurs voies. Les noms en capital ne sont pas dits. Les indications sont lues par le narrateur. Seine unique, le soir, dans un jardin. Une lanterne éclaire le banc. « Tu arrives bien tard, Hanselme. J'ai cru que tu ne viendrais plus. » « J'ai couru depuis le pont. Le portail était fermé et la clef n'est plus à sa place. » « La clef. Mais c'est toi qui l'avais hier soir. » « Moi, je l'ai rendu à ton frère devant la fontaine. » « Le Lucien entre une lettre à la main. » « Vous cherchez ceci peut-être ? Elle était dans la poche de mon manteau. » « Lucien, depuis qu'on nous écoute-tu ? » « Depuis assez longtemps pour savoir que personne ici ne sait garder une clef. » « Rennes-là et n'en parlons plus. » « À part. » « Il ne se doute de rien. Tenez, la voici. » « Bien. Alors fermons ce portail et rentrons avant la pluie. » « La lanterne s'éteint. On n'entend plus que le vent dans les branches. » « Puni, c'est ça ? »
- `base--response-adapted-1` : WER 0.1667, requêtes 6, essouffl entendu : non
  entendu : C'est bilan. Le correctif touche tts.ts. La documentation est sur le guide et sur un lien. Fin, exemple de code. Bon, le test passe maintenant.
- `base--response-adapted-2` : WER 0.1667, requêtes 6, essouffl entendu : non
  entendu : Je bilan. Le correctif touche tt.punsee. La documentation est sur le guide et sur un lien. Tais un exemple de code. Le test passe maintenant.
- `base--response-adapted-3` : WER 0.2917, requêtes 6, essouffl entendu : non
  entendu : Bilan, le correctif touche tes tests.s La documentation est sur le guide et sur un lien, dans un exemple de code. Le test passe maintenant. C'est parti !
- `apres--response-adapted-1` : WER 0.125, requêtes 3, essouffl entendu : non
  entendu : Et bilan, le correctif touche tts.cs, la documentation est sur le guide et sur un lien. Dans un exemple de code, le test passe maintenant.
- `apres--response-adapted-2` : WER 0.0417, requêtes 3, essouffl entendu : non
  entendu : Le correctif touche tts.ts, la documentation est sur le guide et sur un lien. Un exemple de code. Le test passe maintenant.
- `apres--response-adapted-3` : WER 0.0417, requêtes 3, essouffl entendu : non
  entendu : Bilan. Le correctif touche tts.ts. La documentation est sur le guide et sur un lien. Viens un exemple de code. Le test passe maintenant.
