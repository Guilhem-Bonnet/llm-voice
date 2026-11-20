# Agentic Evidence Pack

## Summary

- Task id: GAO-attente-lisi-001
- Profile: controlled
- Outcome: Attente lisible et gestes de lecture : délai du premier chargement, étapes sans faux pourcentage, bloc Document ouvert, sélections multiples — critères : AC-001 test: npm --prefix vscode-extension run test:unit vert; AC-002 revue: essai de guilhem-bonnet consigné dans acceptance-record; AC-003 gate: grimoire standard gate check --strict vert
- Final state: in_progress (2026-11-06), carte laissée à running sur consigne

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD 707db02 | git rev-parse --short HEAD | référence (2026-11-06) |
| Coupure au délai prouvée avant correction | vscode-extension/test/unit/tts/slowFirstLoad.test.ts, 1er describe | serveur HTTP réel lent, provider et AudioQueue réels, délais réduits | 1re requête coupée au délai, reprise par la file : 2 POST, le son arrive en retard |
| Chargement demandé à l'avance | même fichier, dernier describe | serveur simulé avec /load et state | un seul POST, jamais coupé |
| Rendus à 260 px | _grimoire-output/evidence/GAO-attente-lisi-001/rendus-260px/ | chromium-browser --headless --disable-gpu sur le vrai player.js et player.css | document, empty, wait, playing, notice ; aucun débordement mesuré, boutons de hauteur fixe |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Typecheck | `npm run typecheck` (vscode-extension) | code 0 | |
| Lint | `npm run lint` | code 0 | --max-warnings=0 |
| Tests unitaires | `npm run test:unit` | code 0 : Tests 2726 passed (2726) | |
| Build | `npm run build` | code 0 | |
| Intégration fake-tts | `xvfb-run -a npx vscode-test --label fake-tts` | code 0 : 73 passing (8s) | inclut test/integration/waitAndDocument.test.ts ; FakeAudioSink, aucun son |
| Intégration voix | `npm run test:integration-voice` | code 0 : 24 passing (5s) | |
| Serveur Kyutai | `python3 deploy/kyutai16/test_server.py` | code 0 : Ran 50 tests in 20.553s OK | faux modèle, aucun GPU |
| Paquet | `npm run package:linux-x64` | code 0 : check-vsix: no test code, no sources, no maps, no secrets; every required file present. | |
| Mode jeu pendant les tests | `test -e $XDG_RUNTIME_DIR/gpu-yield/active` | inactif | aucun banc audio, service kyutai16 non touché |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | yes | carte du ledger, task-envelope remplie avant modification | gate strict non lancé : la carte reste à running sur consigne |
| Quality | yes | tableau Validation ci-dessus | modèle réel non chargé |
| Runtime | no |  |  |
| Knowledge | no |  |  |
| Model/provider | no |  |  |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Route POST /load ajoutée au serveur, non citée dans le brief | contrat HTTP étendu, mêmes contrôles Host et Origin, refus en mode jeu | à relire par guilhem-bonnet | redémarrage du service kyutai16 |
| readyTimeoutMs passe de 30000 à 180000 | un moteur qui dit charger est attendu jusqu'à 3 min, annulable | à relire | premier essai réel |
| Moteur préparé avant l'IA (ordre de la maquette, l'inverse du code d'avant) | une panne de moteur se voit avant de lancer l'IA | à relire | premier mode narré réel |
| Pas de liste d'étapes cochées comme dans Panneau-preparation : une étape courante, sa barre et son texte | moins fidèle à la maquette | à relire | revue visuelle |
| « Lire les N passages » reste en deuxième position, la maquette la met en premier | ordre des boutons | à relire | revue visuelle |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Preuve réelle du concierge (2026-11-06)

- Service réel recréé : `/load` 202, `/health` passe de `loading` à `ready` en 6,9 s, pire réponse de `/health` 0,36 s pendant le chargement GPU.
- Première synthèse après `/load` : 26 s pour une phrase courte. La lenteur du démarrage vient surtout de cette première génération, pas du chargement du modèle (6,9 s).
- `native-real.sh --kyutai16`, service à froid : exit 0, WER 0, pause 2460 ms, silence initial 45,2 s, un seul `POST /tts` de 37,4 s, sans coupure à 60 s.
- `test:unit` 2726, `test:integration-voice` 24, `fake-tts` 73 sur 2 passes, `test_server.py` OK.
- Reste : barre vue dans le vrai VS Code, « Lire avec la voix système », panneau affichant « Ouvrez un fichier » devant un aperçu Markdown.
