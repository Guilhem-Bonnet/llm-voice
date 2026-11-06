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
