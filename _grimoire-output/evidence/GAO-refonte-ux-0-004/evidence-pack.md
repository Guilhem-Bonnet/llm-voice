# Agentic Evidence Pack

## Summary

- Task id: GAO-refonte-ux-0-004
- Profile: controlled
- Outcome: Refonte UX 04 · Modèle voix globale et modes : migration des profils et sélection unifiée — critères : AC-001 test: migration couverte sur un profiles.json existant, sans perte; AC-002 test: la voix choisie est bien celle utilisée à la lecture du document; AC-003 test: npm --prefix vscode-extension run test:unit vert; AC-004 gate: grimoire standard gate check --strict vert
- Final state: in_progress (2026-11-06)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD 9ec5465 | git rev-parse --short HEAD | référence (2026-11-06) |

## Phase rouge : échec réel des causes A, B, C, D

**Run 1, code d'avant ADR-017** (HEAD `9ec5465`), avec les seules sondes de test ajoutées (faux puits, port
fixe, profil `voice-chain`, `resetAutoTtsCacheForTest`). Le test pilotait alors l'ancien modèle : une voix par
profil, écrite sur le profil sélectionné comme le faisait `browseVoices()`.
Commande : `xvfb-run -a npx vscode-test --label voice-chain`, sortie 1, `0 passing`, `6 failing`.

| Cause | Test | Attendu | Reçu |
|---|---|---|---|
| C | V1, document | `predefined_voice_id: voice-x` | `voice-of-document-mode` |
| C | V1, réponse de Claude | `predefined_voice_id: voice-x` | `voice-of-reply-mode` |
| A | V2, choix d'une voix du catalogue | `voice_mode: predefined` | `clone` |
| B | V3, autre échantillon, même texte | 2 `POST /tts` | 1 (`1 !== 2`, le cache répond) |
| B | V3, autre URL, même texte | 1 `POST /tts` sur le nouveau serveur | 0 (`0 !== 1`) |
| D | V4, voix listée par le moteur résolu depuis `auto` | `providerId: chatterbox` persisté | `auto` |

Un premier lancement avait donné aussi 6 échecs, dont un sans valeur (`profil inconnu « chain-last »`, course du
test contre la création des défauts à l'activation). Corrigé par un `profiles.json` préalable ; seul le second
lancement ci-dessus compte. Les causes se reproduisent toutes les quatre.

**Non observés à ce run** : l'aperçu (V2) et le changement de moteur résolu (V3) n'existaient pas encore. Prouvés
par mutation temporaire, ci-dessous. La vitesse (V3, V11) est une fonction neuve : pas de phase rouge observée.

**Mutations temporaires, annulées ensuite** (`grep -c` à 0 après annulation, tests refaits) :

| Mutation | Tests rouges | Sortie observée |
|---|---|---|
| `previewVoice` redevient `{ ...profile.tts, voice }` et `bindingFrom` refournit `providerId` | aperçu V2 ; V3 échantillon ; V3 URL | `'clone'` au lieu de `'predefined'` ; `1 !== 2` ; `0 !== 1` ; `3 failing` |
| `bindingFrom` refournit `providerId`, test `auto` renforcé | V3 échantillon ; V3 URL ; V3 `auto` | `1 !== 2` ; `0 !== 1` ; `1 !== 0` ; `3 failing` |

La première mutation a révélé que le test V3 `auto` passait même muté (la voix par défaut de chaque moteur
séparait les clés). Il nomme désormais sa voix, et la seconde mutation prouve qu'il échoue sans le correctif.

## Validation

Dernier passage, code final (`vscode-extension/`), sorties réelles :

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Types | `npm --prefix vscode-extension run typecheck` | sortie 0 | |
| Lint | `npm --prefix vscode-extension run lint` | sortie 0 | `eslint . --max-warnings=0` |
| Tests | `npm --prefix vscode-extension run test:unit` | sortie 0, `Test Files 121 passed (121)`, `Tests 2511 passed (2511)` | référence avant la carte : 114 fichiers, 2005 tests |
| Chaîne de voix | `npm run test:integration-voice` | sortie 0, `13 passing` | vrai `ChatterboxProvider` contre `MockTtsServer` |
| Profil `fake-tts` | `npm run build` puis `xvfb-run -a npx vscode-test --label fake-tts` | sortie 0, `65 passing` | référence avant la carte : 65 |
| `tts-auto-fallback-succeeds` | `xvfb-run -a npx vscode-test --label …` | sortie 0, `1 passing` | |
| `tts-auto-fallback-fails` | idem | sortie 0, `1 passing` | |
| `chunk-invalid-fake-tts` | idem | sortie 0, `2 passing` | |
| `prefetch-chunks-fake-tts` | idem | sortie 0, `1 passing` | |
| `system-no-engine` | idem | sortie 0, `1 passing` | |
| `integration-security` | idem | sortie 0, `8 passing` | CSP et injection des webviews |
| `native-real` | idem, sans `LLM_VOICE_NATIVE_REAL` | sortie 0, `0 passing`, `2 pending` | **ne prouve rien** : suites sautées, seul le chargement de la configuration est vu |
| Contenu du VSIX | `npm run check:vsix` | **sortie 1** | `MUST NOT SHIP … bin/linux-x64/llm-voice-core` : binaire local ignoré par git, sans rapport avec cette carte. Aucune plainte sur `schemas/global-voice.schema.json`, mais le contrôle n'est pas vert |
| Audio réel (V15) | banc | **non lancé** | consigne : le concierge fait la preuve audio |
| `grimoire standard gate check --strict` | | **non lancé** | carte non avancée, à la charge du concierge |

## Vérifications de l'ADR

| V | Test |
|---|---|
| V1 | `test/integration-voice/voice-causes.test.ts` |
| V2 | idem, choix et aperçu |
| V3 | idem, plus `test/unit/profiles/voiceResolution.test.ts`, `test/unit/playback/audio-queue.test.ts` |
| V4 | `voiceResolution.test.ts`, `voice-causes.test.ts` |
| V5 | `voiceResolution.test.ts`, `test/unit/profiles/voiceMigration.test.ts` |
| V6 | `voiceMigration.test.ts`, dont propriété à 300 graines et arrêt à chaque étape |
| V7 | `voiceMigration.test.ts`, `test/fixtures/profiles/frozenSchemaV2.ts` |
| V8 (part 0-004) | `test/unit/invariants/command-ids.test.ts`, `voice-causes.test.ts` |
| V9 (cliquet) | `test/unit/invariants/no-profile-word.test.ts`, `profile-word-exceptions.json` |
| V10 | `test/unit/views/profileEditor.behavior.test.ts` |
| V11 (part 0-004) | `voice-causes.test.ts`, `voiceResolution.test.ts` |
| V12 | `test/unit/direction/translator/translate.test.ts` |
| V13 (part 0-004) | `voiceMigration.test.ts` |
| V14 | `test/unit/invariants/no-autoplay-voice.test.ts` |
| V16 | `profileQuickPick.test.ts`, `remoteProviders.test.ts`, `profileTreeItems.test.ts`, `voiceMigration.test.ts` |
| V17 | `test/unit/profiles/globalVoiceStore.test.ts` |
| V18 | `test/unit/profiles/bySource.test.ts` |
| V19 | `voiceResolution.test.ts` |
| Configuration réelle | `test/unit/profiles/realConfigMigration.test.ts`, 7 tests |

`~/.config/Code` n'a été ni lu ni modifié.

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | no |  | gate à lancer par le concierge |
| Quality | yes | tableau Validation | `check:vsix` rouge pour un binaire local ; V15 non lancée |
| Runtime | no |  |  |
| Knowledge | no |  |  |
| Model/provider | no |  |  |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Le classement compare les deux côtés complétés, pas le JSON brut (§2, ligne 2) | Le mode source d'une voix dont le `tts` n'a pas d'URL ou porte l'échantillon livré hérite ; même son | à valider par le concierge | relecture de l'ADR |
| « Marque absente, voix absente, `tts` vides » n'applique la voix système que si la sauvegarde prouve un `tts` antérieur non vide | Un `tts: {}` écrit sous la 0.3 garde son comportement par `llmVoice.tts.*` | à valider par le concierge | relecture de l'ADR |
| `system` et `auto` ne reçoivent pas d'URL des réglages dans la voix initiale | Évite un faux badge distant | à valider par le concierge | relecture de l'ADR |
| V6 lu avec §2 : un libellé encore d'origine change, un libellé personnalisé reste égal | Le texte de V6 pouvait se lire autrement | à valider par le concierge | relecture de l'ADR |
| V7 porte sur `ProfileStore`, parent de `ProfileRepository` | Même code, exécutable sous vitest | à valider par le concierge | relecture de l'ADR |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Contrôles rejoués par le concierge (2026-11-06)

- `typecheck` et `lint` sans erreur ; `test:unit` 121 fichiers, 2511 tests verts ; `test:integration-voice` 13 passing ; `fake-tts` 65 passing.
- `npm run package:linux-x64` : `check-vsix` vert pour la cible linux-x64, 45 fichiers. `npm run check:vsix` (universel) rouge seulement parce que le binaire du Core est présent après ce paquet : comportement attendu du contrôle.
- V15, audio réel sur sink nul : `native-real-systeme.log` WER 0.0455 ; `native-real-kyutai.log` WER 0.0, modes hérités. Sortie par défaut inchangée après le banc.
- Copie du vrai profiles.json de l'utilisateur, passée par `ProfileStore` dans un dossier temporaire : voix globale kyutai-pocket, estelle ; marque 1 ; défaut faithful-local ; quatre modes hérités, libellés Fidèle, Professeur, Résumé, Révision ; system-voice masqué ; Révision garde rate 1.1 ; aucune notice ; sauvegarde identique à l'octet ; rejeu sans effet. Test temporaire non versé.
