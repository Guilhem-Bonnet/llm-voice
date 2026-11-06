# Agentic Evidence Pack

## Summary

- Task id: GAO-refonte-ux-0-002
- Profile: controlled
- Outcome: Refonte UX 02 · ADR-017 Voix et mode de lecture : retrait du mot profil, migration, amendement d'ADR-011 — critères : AC-001 gate: ADR-017 versé dans docs/adr, relu par un vérificateur indépendant; AC-002 revue: accord de guilhem-bonnet consigné; AC-003 gate: grimoire standard gate check --strict vert
- Final state: ready (2026-11-06)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD de4d8b5 | git rev-parse --short HEAD | référence (2026-11-06) |

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
| Tests | `npm --prefix vscode-extension run test:unit` | non exécuté | grimoire standard gate run-tests --task-id GAO-refonte-ux-0-002 écrit _grimoire-output/evidence/GAO-refonte-ux-0-002/test-run.json |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | no |  |  |
| Quality | no |  |  |
| Runtime | no |  |  |
| Knowledge | no |  |  |
| Model/provider | no |  |  |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
|  |  |  |  |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Rédaction d'ADR-017 : sources lues (2026-11-05, platform-architect, outils lecture et écriture seulement)

Livrable : `docs/adr/ADR-017-voice-and-reading-mode.md` (statut Proposé), ligne ajoutée à `docs/adr/README.md`. État de la carte non modifié. Relecture indépendante et accord de guilhem-bonnet restent à obtenir (AC-001, AC-002).

- Décision et cadrage : `_grimoire/_memory/decisions-log.md` (lignes 190-230), `_grimoire/_memory/shared-context.md`, `_grimoire-output/design/refonte-ux-2026-11.md`, `docs/ux/audit-2026-11-05.md`.
- ADR : ADR-011 (entier), ADR-013 (entier), ADR-015 (entier), ADR-016 (entier), `docs/adr/README.md`.
- Ledger : `_grimoire-runtime-output/ledger/events.jsonl` lignes 338-423 (descriptions des cartes, liens et retraits de liens), `_grimoire-output/context/GAO-refonte-ux-0-002/context-bundle.yaml`, `task-envelope.md` et `claim-ledger.md` de la carte, `evidence-pack.md` des cartes 0-001 et 0-003.
- Profils : `vscode-extension/src/profiles/` defaults.ts, ProfileRepository.ts, migrations.ts, profileForm.ts, bySource.ts, voiceBrowser.ts, profileQuickPick.ts, ttsProviderLabel.ts, remoteProviders.ts ; `src/core/profile.ts`, `src/core/profile.schema.ts`, `src/core/tts.ts`.
- Lecture : `src/pipeline/Pipeline.ts` (entier), `src/pipeline/resolveProviderConfig.ts`, `src/playback/PlaybackController.ts`, `AudioQueue.ts`, `AudioCache.ts` (clé), `AudioSink.ts`, `WebviewAudioSink.ts`, `SessionFactory.ts`.
- Moteurs : `src/tts/presets.ts`, `ChatterboxProvider.ts` (en-tête), `KyutaiPocketProvider.ts` (début), `SystemTtsProvider.ts` (extraits).
- Accueil : `src/onboarding/` SetupVoice.ts, voiceTiers.ts, handleVoiceTier.ts, UseOwnVoice.ts, useOwnVoiceFlow.ts, Walkthrough.ts.
- Interface : `src/extension.ts`, `src/commands/index.ts`, `src/commands/PipelineFacade.ts`, `src/ui/StatusBar.ts`, `src/views/player/PlayerViewProvider.ts`, `playerHtml.ts`, `src/views/profiles/ProfilesTreeProvider.ts`, `src/views/profileEditor/ProfileEditorPanel.ts` (début), `src/claude/InboxQuickPick.ts` (début), `media/player/player.js` (début), `media/profileEditor/profileEditor.js` (début), `vscode-extension/package.json`.
- Direction et contrats : `src/direction/translator/translate.ts`, `contracts/core-v1/http/enqueue.request.schema.json`, `test/fixtures/profiles/legacy-profiles-v1.json` (début), `test/integration/profileMigration.test.ts` (début).

Non fait, faute d'outil dans cette tranche : aucune commande exécutée (ni tests, ni `grimoire task show`, ni rendu Mermaid), aucune recherche récursive dans le code. Le canevas de la maquette (privé) n'a pas été ouvert. Les causes A à D du §1.1 sont des constats de lecture, non reproduits par exécution.

## Correction d'ADR-017 après relecture indépendante (platform-architect)

Entrée : `_grimoire-output/reviews/GAO-refonte-ux-0-002/revue-adr-017.md`. Statut de l'ADR : Proposé, accord de guilhem-bonnet toujours à obtenir (AC-002). État de la carte non modifié. Chaque constat a été vérifié dans le code avant application ; aucun test ni aucune commande exécutés.

| Constat | Vérification | Décision |
|---|---|---|
| I-1 | Scénario cité faux : `{ providerId: "auto", parameters }` comptait bien comme voix propre selon le §1.3. Contradiction réelle pour `parameters` ou `format` seuls. | Tout `tts` non vide est une voix propre. V5, V6. |
| I-2 | Exact. | Marque déplacée dans `profiles.json` : fichier restauré reclassé sans procédure. V7. |
| I-3 | Exact pour Quick Pick et vue ; inexact pour l'import (`Pipeline.ts:952`), qui juge ce que le fichier apporte. | `listEffective()` ; import laissé sur le mode brut. V16. |
| I-4 | Exact (`Pipeline.ts:1751-1756`, et `TtsRequest` sans échantillon). | Profil `voice-chain`, serveur fictif, faux sink seul. V1, V2, V3, V15. |
| I-5 | Exact, complément compris. | Plus de drapeau dans `global-voice.json`, création exclusive, relecture avant écriture, pas de verrou. V17. |
| I-6 | Exact. | Avertissement et action, pas d'héritage conditionné. V19. |
| M-1, M-2 | Exacts. | Bornes, `voice.speed` 0,5 à 2, écart et absence de voie affichés. Ajout : réappliquer la vitesse après `audio.load()`. V11. |
| M-3 | Exact. | Lecture par `inspect()`. V18. |
| M-4 | Exact. | Couvert par la marque. V7. |
| M-5 | Exact. | `globalState` examiné, fichier gardé (§1.2). |
| M-6, M-7 | Exacts. | Narrateur = voix effective ; candidats vides = `invalid-request` d'ADR-013, repli affiché. V12, V13. |
| M-8 | Exact. | Trois cas d'échantillon à la voix initiale, message unique si ambigu. V6. |
| `previewVoice` | Exact (`Pipeline.ts:1151`). | Ajouté à la cause A, §1.3, V2. |
| Réserve sur A | Exacte : la fixture porte le chemin livré. | §1.1 corrigé. |
| V3, V6, V9 | Exacts. | V3 sur la chaîne réelle plus `ttsInstanceKey` ; « à valeur JSON égale » ; V9 en cliquet. |
| Lignes glissées | Exact. | Citations relues sur HEAD `c23e68f` et corrigées. |

Relus pour cette correction : `src/pipeline/Pipeline.ts` (extraits cités), `resolveProviderConfig.ts`, `src/views/profiles/profileTreeItems.ts`, `src/views/profileEditor/profileEditorHtml.ts` (extrait), `src/tts/KokoroProvider.ts`, `ChatterboxProvider.ts` (corps de `/tts`), `SystemTtsProvider.ts` (extrait), `src/playback/SequencedAudioSink.ts` (début), `test/fakes/mockTtsServer.ts`, `vscode-extension/.vscode-test.mjs`, `test/integration/voiceBrowserAndProfileEditor.test.ts` (début), `package.json` (vues, réglages, parcours), `media/profileEditor/profileEditor.js` (extrait), `.git/refs/heads/feat/s1-native-audio-foundation`.

Écart de contrôle signalé : la carte 0-004 ne déclare que `test:unit` ; V1 à V3 exigent d'y ajouter `test:integration-voice`.
