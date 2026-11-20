# Agentic Evidence Pack

## Summary

- Task id: GAO-r-ponses-2-l-001
- Profile: controlled
- Outcome: Réponses 2 · Lecture adaptée à l'oral et bascule Code — critères : AC-001 test: npm --prefix vscode-extension run test:unit vert; AC-002 gate: grimoire standard gate check --strict vert; AC-003 revue: accord de guilhem-bonnet consigné
- Final state: in_progress (2026-11-06)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD 8aa8080 | git rev-parse --short HEAD | référence (2026-11-06) |
| Rouge constaté | `test/unit/parser/ResponseReading.test.ts`, `test/unit/views/responseCodeChip.test.ts` | `npx vitest run` avant implémentation | 2 fichiers en échec, modules absents |
| Table de formes réelles | `vscode-extension/test/fixtures/claude-stop/{markup,paths-urls,code-consecutive,inline-code,table-short,table-long,table-six,lists}.json` | écrites à la main, aucune réponse privée lue | 8 fixtures |
| Rendus de la puce | `chip-renders/w{260,320,500}-{ignore,lu,sans}.png` | Firefox headless, 9 images ; w260-lu, w320-ignore, w500-lu, w260-sans regardées | bouton fixe, pas de retour à la ligne, absent sans code |
| Preuve audio réelle | `native-real-response-adapted.json` | `scripts/audio-proof/native-real.sh --response-adapted`, exit 0, gpu-yield absent, Kyutai 1.6B port 8020 | WER 0.125, aucun mot interdit |
| Puce dans la vraie fenêtre | `proof-chip-window.png`, `proof-before-gesture.png` | même exécution | « Code : ignoré » visible pendant la lecture |

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Types | `npm run -s typecheck` | exit 0 | rejoué après la reprise |
| Lint | `npm run -s lint` | exit 0 | rejoué après la reprise |
| Tests | `npm run -s test:unit` | exit 0, 146 fichiers, 3036 tests | rejoué après la reprise |
| Build | `npm run -s build` | exit 0 | rejoué après la reprise |
| Intégration | `xvfb-run -a npx vscode-test --label fake-tts` | exit 0, 79 passing | deux tests ajoutés dans `test/integration/inbox.test.ts` |
| Sécurité | `xvfb-run -a npx vscode-test --label integration-security` | exit 0, 8 passing | |
| Chaîne vocale | `npm run -s test:integration-voice` | exit 0, 50 passing | |
| Preuve réelle | `native-real.sh --response-adapted` | exit 0, 1 passing, WER 0.125, `mots_interdits_entendus: []` | transcription : « Bilan. Le correctif touche tts.s.c La documentation est sur le guide et sur un lien. Dure un exemple de code. Le test passe maintenant. » |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | no |  |  |
| Quality | yes | typecheck, lint, test:unit, build, fake-tts, integration-security, test:integration-voice | gate strict et accord non obtenus ici |
| Runtime | yes | native-real-response-adapted.json | « Code : lu » prouvé avec le faux moteur seulement |
| Knowledge | no |  |  |
| Model/provider | no |  |  |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Clic sur la puce non exercé dans une vraie webview : `player.js` testé sur double DOM, bascule appelée directement sur le pipeline | le `case` de `extension.ts` n'est pas couvert par un test | à décider par guilhem-bonnet | toute évolution de la puce |
| La bascule vaut pour la prochaine lecture, avec la note « À la prochaine lecture. » | la lecture en cours ne change pas | à décider par guilhem-bonnet | retour d'usage |
| Numéro d'une liste ordonnée non dit, numéro de ligne d'un chemin non dit | information perdue à l'oral | à décider par guilhem-bonnet | retour d'usage |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Vérification du concierge (2026-11-06)
- typecheck 0, lint 0, build 0, unitaires 3036 réussis, fake-tts 79.
- `native-real.sh --response-adapted` joué trois fois, code 0 : WER 0,125, 0,1667, 0,1667. Ni URL, ni chemin complet, ni code dicté.
- **Défaut ouvert :** le premier passage très court (« Bilan. », 6 caractères) manque deux fois et devient « Prémbilant » une fois ; « Un exemple de code » reçoit un mot parasite (« Pose », « Faire ») deux fois sur trois. Son d'origine non conservé : modèle ou transcripteur non départagé. Même forme que « (à part) » sur le théâtre : les passages très courts sont suspects.
- À traiter en Réponses 3 : la lecture adaptée ne vaut que pour `sourceType === "claude-code"`, donc pas encore pour le presse-papiers, voie retenue pour Copilot Chat et les chats web.
