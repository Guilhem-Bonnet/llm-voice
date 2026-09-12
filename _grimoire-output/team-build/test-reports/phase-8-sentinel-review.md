# Revue phase 8 (PR #47, #48, #49) — commentaires GitHub, 2026-09-11

## PR #48 — feat(tts): self-contained French voice by default, no Docker required
## Revue Sentinel — PR #48

**Verdict : approuvé, corrections appliquées.**

Vérifications demandées :
- (a) `Pipeline.ensureVoiceReady` propose une seule action puis `startInternal` se relance automatiquement (`"retry"`) → la lecture demandée reprend sans second geste utilisateur. Testé de bout en bout par `no-voice-available.test.ts` (profil `system-no-engine`, `PATH` vidé, vraie `SystemTtsProvider`).
- (b) Refus/hors-ligne → `fallbackMessageFor` retombe sur la voix système, jamais de blocage ; prouvé par le même test (dismiss de la notification, `start()` doit résoudre en `error`/`playing`, jamais rejeter ni pendre).
- (c) `grep -rn "Chatterbox" src/` passé en revue occurrence par occurrence : tout ce qui reste est soit un identifiant de code/commentaire interne, soit le sélecteur de tier "Setup Voice" (choix explicite et nommé par l'utilisateur), soit `presets.ts`. Le seul message destiné à quelqu'un qui n'a pas configuré Chatterbox (`AutoVoiceInstall.fallbackMessageFor`) ne le nomme jamais — vérifié.
- (d) `autoSelectTts` : ordre Chatterbox (si `health()` répond déjà) → Piper local → système. Confirmé dans `Pipeline.ts` et documenté dans `docs/providers.md`.
- (e) Téléchargement Piper vérifié SHA-256 via `AssetDownloader`, `LLM_VOICE_STRICT_LOCAL=1` refuse le téléchargement (`PiperSetup.ts`) — mécanisme préexistant, réutilisé sans affaiblissement.
- (f) `docs/install-linux.md`, `docs/providers.md`, `docs/user-guide.md`, `vscode-extension/README.md` : Docker repositionné comme optionnel ("Qualité maximale"), jamais requis pour un usage individuel.

**Correction apportée (bloquante) :** `integration (windows-latest)` échouait sur
`EPERM: operation not permitted, rename ... profiles.json.tmp-... -> profiles.json`
dans `ProfileRepository.write` — un verrou transitoire Windows (AV/indexeur) sur le
fichier de destination, pas un vrai conflit. Ajout d'un retry avec backoff sur
`EPERM`/`EBUSY` (5 tentatives), no-op sur Linux/macOS. Commit `b18b8a4`.

CI relancée sur ce commit ; merge squash dès 9/9 verts.


## PR #49 — feat(profiles): voice browser with preview, use your own voice as reference, profile editor webview
## Revue Sentinel — PR #49

**Verdict : approuvé, corrections appliquées, main mergée.**

Points tranchés :
- (a) **Renommage `markdownPolicy`/`syncMode` → `markdown`/`synchronization.mode`** pour coller au CdC §18 verbatim. `VoiceProfileSchema` migre automatiquement un `profiles.json` pré-renommage (`z.preprocess`, les anciens noms ne survivent jamais à une réécriture). Testé au niveau schéma (`profileForm.test.ts`) et de bout en bout via `Pipeline.importProfileFromJson` (`syncModeAndMarkdownPolicy.test.ts`, nouveau test « legacy shape »).
- (b) **`CHANGELOG.md`** : `vscode-extension/CHANGELOG.md` devient la seule source de vérité (c'est ce que lit la Marketplace dans le VSIX, édité à chaque bump de version) ; le fichier racine devient une copie générée par `scripts/sync-changelog.mjs` (enchaîné dans `npm run package`), décision documentée dans `CONTRIBUTING.md`.
- (c) **Forwarders de test sur `Pipeline`** (`getProfileEditorHtmlForTest`, etc.) : acceptable — pattern déjà établi avant cette PR (`getCurrentProfileLabelForTest`, `listInboxEntriesForTest`...) pour la même raison architecturale (bundle esbuild vs `out/`, deux instances de module). Pas un contournement ad hoc.
- (d) **Faux `createQuickPick`** dans le test de balayage des commandes : revu, ne rend aucune commande muette ou bloquante — le test reste sur l'intention d'origine.
- (e) **Sécurité webview éditeur** : nonce par rendu, CSP stricte, aucune donnée de profil interpolée dans le HTML (confirmé par lecture de `profileEditorHtml.ts`/`ProfileEditorPanel.ts`). Test d'injection rejoué par mutation : `ProfileEditorPanel.handleSave` modifié temporairement pour ré-injecter le label sauvegardé dans le shell HTML → le test échoue bien (`hostile label must never reach the webview document`) ; reverté après vérification. Correction additionnelle : 2 alertes CodeQL high (`js/bad-tag-filter`) sur les regex `<script>` insensibles à la casse dans les tests — corrigées (`gi`/`i`).

CI CodeQL (2 alertes high) et migration de main (PR #48) appliquées ; conflit non-fonctionnel dans `Pipeline.ts` résolu (ordre `synchronization.mode` puis `ensureVoiceReady`).

Merge squash dès 9/9 verts.

## AC-07 sur `integration (ubuntu-latest)` — verdict : flake pré-existant, pas une régression

`integration (ubuntu-latest)` a échoué une fois sur `AC-07: selecting a different profile sends a different voice to the TTS provider` (`test/integration/profiles.test.ts`, `AssertionError: expected 'voice-b', got undefined`). Windows et macOS étaient déjà verts sur ce même commit.

**Preuves examinées avant de conclure :**
1. `test/integration/profiles.test.ts` n'a **aucun diff** sur toute la chaîne main→#48→#49 (`git diff f209fae...HEAD -- test/integration/profiles.test.ts` est vide) : le test lui-même n'a pas changé.
2. Le seul nouveau code qui aurait pu interférer, `Pipeline.ensureVoiceReady` (#48), fait un no-op prouvé pour ce test : `presetKindForProviderId("fake-tts") !== "system"` fait retourner `"proceed"` avant tout appel à `resolveTtsConfig`/`autoSelectTts`/`health()` — aucune interaction avec la sélection auto ni avec `FakeTtsProvider`.
3. `FakeTtsProvider.requests` n'est alimenté que par `synthesize()`/`synthesizeStream()`, jamais par `health()` — la voie qu'emprunte `ensureVoiceReady` pour un provider non-système ne touche donc jamais ce tableau.
4. Localement : 54/54 tests passent (suite complète, deux exécutions), y compris AC-07 en isolation et en run complet.
5. **Rerun ciblé du job en échec sans aucun changement de code → vert** (`integration (ubuntu-latest)` repassé au 2e essai).

**Diagnostic le plus probable (documenté, non corrigé ici — hors périmètre de #48/#49)** : `FakeTtsProvider` est une instance unique partagée par toute l'activation de l'extension pendant un run mocha ; son tableau `requests` s'accumule à travers tous les fichiers de test du profil `fake-tts`. `Pipeline.stop()` ne garantit pas l'annulation d'un `synthesize()` déjà en vol. Sur un runner chargé (ubuntu, le plus contraint des trois), une requête tardive d'un test précédent utilisant aussi `fake-tts` peut atterrir dans `requests` après celle d'AC-07 et fausser `requests[last]`. C'est une lacune d'isolation du harnais de test pré-existante, pas un défaut du code produit de #48/#49 — aucune correction de code apportée pour cette raison ; à traiter séparément si ça se reproduit.

Aucune modification de test ni de code liée à AC-07 dans cette PR.


## PR #47 — chore(deps): upgrade dev tooling — vitest 5, eslint 10, node types, GitHub actions
## Revue Sentinel — PR #47

**Verdict : approuvé, main (#48 + #49) mergée, merge squash effectué.**

Vérifications demandées :
- **`eslint-disable` sans justification** : `git diff main...HEAD -- src test | grep eslint-disable` ne remonte aucune occurrence nouvelle. Lint (`eslint . --max-warnings=0`, eslint 10 + `@typescript-eslint` 8.70) passe sans suppression ajoutée.
- **Couverture et seuils inchangés** : `vitest.config.ts` (seuil `lines: 80`) non modifié par cette PR ; couverture réelle après merge avec #48/#49 : 93.65 % lignes, 919/919 tests unitaires passent sous vitest 5.0.0 sans adaptation de code (aucun test cassé par le bump majeur).
- **`npm audit --omit=dev`** : `found 0 vulnerabilities` (contre 2 critiques/2 hautes/6 modérées avant ce bump sur le total dev+prod).
- **CI réelle** : 9/9 verts sur ce commit (`lint`, `audit`, `unit`, `integration` ubuntu/windows/macos, `package`, `codeql`, `CodeQL`) — comptes ci-dessus.

Merge de `main` (post #48/#49) sans conflit réel (uniquement des sections non-chevauchantes de `package.json`). Suite d'intégration complète rejouée localement après merge (66 tests, tous profils `.vscode-test.mjs`) : verte. `npm run package`/`check:vsix`/`check:licenses` : OK.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

Revue de clôture (orchestrateur) : 9/9 checks verts après intégration de #48 et #49. Dette d'outillage absorbée — vitest 5, eslint 10, actions GitHub v7, codeql-action v4 ; `@types/node` volontairement maintenu en 22.x car le runtime est Node 22 et les types 26 exposeraient des API absentes. Vulnérabilités de développement 10 → 4, `npm audit --omit=dev` reste à 0. Les 8 PR Dependabot d'origine ont été fermées avec renvoi vers celle-ci.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
