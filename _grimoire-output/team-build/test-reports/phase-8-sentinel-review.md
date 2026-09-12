# Phase 8 — Revue Sentinel + merge Flow

Repo : Guilhem-Bonnet/llm-voice. Worktree de revue :
`/tmp/claude-1000/-mnt-Travail-Projets-Dev-TTS-Voice/389c7bfc-f6bb-4fe0-8f7c-a67d861aaed1/scratchpad/wt/review`.

## PR #48 — voix autonome par défaut, zéro Docker

**Verdict : approuvé, merge squash effectué.**

- (a) `Pipeline.ensureVoiceReady` : une seule proposition d'installation puis `startInternal` se relance automatiquement (`"retry"`) sur la lecture demandée — chemin complet testé par `test/integration-no-engine/no-voice-available.test.ts` (profil `system-no-engine`, `PATH` vidé, vraie `SystemTtsProvider`).
- (b) Refus/hors-ligne → repli voix système honnête, jamais de blocage (même test, prompt dismiss, `start()` résout en `error`/`playing`).
- (c) `grep -rn "Chatterbox" src/` passé en revue occurrence par occurrence : rien de user-facing pour quelqu'un qui n'a pas configuré Chatterbox (`AutoVoiceInstall.fallbackMessageFor` ne le nomme jamais).
- (d) `autoSelectTts` : Chatterbox (si déjà up) → Piper local → système, confirmé code + doc.
- (e) SHA-256 + `LLM_VOICE_STRICT_LOCAL=1` inchangés, réutilisés sans affaiblissement.
- (f) Docs (`install-linux.md`, `providers.md`, `user-guide.md`, README) : Docker repositionné en option "Qualité maximale", jamais requis.

**Correction bloquante apportée** : `integration (windows-latest)` échouait sur `EPERM` au `rename()` de `ProfileRepository.write` (verrou transitoire Windows AV/indexeur sur le fichier de destination). Ajout d'un retry avec backoff sur `EPERM`/`EBUSY` (5 tentatives), no-op sur Linux/macOS. 1 tentative CI, verte ensuite.

**SHA merge (squash)** : `ed5eb39`.

## PR #49 — navigateur de voix, ma propre voix, éditeur de profils

**Verdict : approuvé, merge squash effectué (main mergée d'abord).**

- (a) Renommage `VoiceProfile.markdownPolicy`/`syncMode` → `markdown`/`synchronization.mode` pour coller au CdC §18 verbatim. Migration rétrocompatible via `z.preprocess` dans `VoiceProfileSchema` (un `profiles.json` pré-renommage continue de charger, les anciens noms ne survivent jamais à une réécriture). Testé au niveau schéma et de bout en bout (import Pipeline avec un JSON à l'ancien format).
- (b) `CHANGELOG.md` racine périmé depuis 0.1.1 : `vscode-extension/CHANGELOG.md` devient la seule source de vérité (lu par la Marketplace dans le VSIX), le fichier racine devient une copie générée (`scripts/sync-changelog.mjs`, enchaînée dans `npm run package`), décision documentée dans `CONTRIBUTING.md`.
- (c) Forwarders de test sur `Pipeline` (`getProfileEditorHtmlForTest` etc.) : acceptables — pattern déjà établi avant cette PR (`getCurrentProfileLabelForTest`, `listInboxEntriesForTest`), nécessaire à cause du bundle esbuild (deux instances de module).
- (d) Faux `createQuickPick` du test de balayage des commandes : revu, aucune commande muette ou bloquante, intention d'origine préservée.
- (e) Sécurité webview éditeur : nonce par rendu, CSP stricte, aucune donnée de profil interpolée dans le HTML. Test d'injection rejoué par mutation : `ProfileEditorPanel.handleSave` modifié temporairement pour ré-injecter le label sauvegardé dans le shell HTML → le test échoue bien (`hostile label must never reach the webview document`), reverté après preuve. Correction additionnelle : 2 alertes CodeQL high (`js/bad-tag-filter`, regex `<script>` insensibles à la casse) corrigées dans les tests.

**AC-07 sur `integration (ubuntu-latest)`** : un échec isolé (`profiles.test.ts`, fichier non modifié par #48/#49, `Pipeline.ensureVoiceReady` prouvé no-op pour un provider non-système). Rerun du job sans changement de code → vert. Conclusion posée en commentaire PR : flake pré-existant du harnais de test (instance `FakeTtsProvider` partagée + `stop()` qui ne garantit pas l'annulation d'un `synthesize()` en vol), pas une régression produit. Documenté, non corrigé (hors périmètre).

**SHA merge (squash)** : `c345e9a`.

## PR #47 — dette d'outillage (vitest 5, eslint 10, GH Actions)

**Verdict : approuvé, main (#48 + #49) mergée, merge squash effectué.**

- Aucun `eslint-disable` ajouté (`git diff main...HEAD -- src test | grep eslint-disable` vide).
- Couverture/seuils inchangés : `vitest.config.ts` (`lines: 80`) non modifié ; couverture réelle post-merge 93.7 % lignes, 919/919 tests unitaires passent sous vitest 5.0.0 sans adaptation de code.
- `npm audit --omit=dev --audit-level=high` : 0 vulnérabilité (contre 2 critiques/2 hautes avant ce bump).
- CI réelle : 9/9 verts (lint, audit, unit, integration ubuntu/windows/macos, package, codeql, CodeQL).
- Merge de `main` sans conflit réel (sections non-chevauchantes de `package.json`).

**SHA merge (squash)** : `89c2a0c`.

## Ce que voit un nouvel utilisateur à la première lecture, sans rien d'installé

1. Installe le `.vsix`, ouvre un `.md`, `Ctrl+Alt+V` puis `D` (ou palette → **Speak Document**) : la voix système démarre immédiatement, sans Docker/Python/terminal.
2. Si aucune voix locale n'existe encore : une seule notification propose « Installer la voix française » (~60 Mo, une fois) ; accepter télécharge (SHA-256 vérifié), installe et enchaîne automatiquement sur la lecture demandée — refuser ou être hors-ligne retombe honnêtement sur la voix système, jamais de blocage, jamais le mot « Chatterbox ».
3. `Setup Voice` reste disponible pour choisir explicitement entre voix système / voix française autonome (Piper, recommandé) / Qualité maximale (Chatterbox, Docker, avancé — jamais proposé par défaut).
4. `Browse Voices`, `Use My Own Voice` et `Edit Profile` (webview sécurisée, nonce+CSP) sont accessibles ensuite pour affiner.

## Validation finale sur `origin/main` (`89c2a0c` → `fdb6288` après un commit de documentation Grimoire post-merge, ancêtre confirmé)

Note d'incident : le worktree de revue a disparu en cours de tâche (répertoire introuvable) ; recréé avec `git worktree add --detach <path> origin/main` depuis le clone réel, sans y exécuter aucune autre commande git, conformément à la consigne.

| Étape | Résultat |
|---|---|
| `npm ci` | OK (620 paquets) |
| `npm run lint` | OK, 0 issue |
| `npm run typecheck` | OK |
| `npm run test:unit -- --coverage` | **78/78 fichiers, 919/919 tests** — 93.53 % stmts / 83.48 % branches / 95.32 % funcs / 93.7 % lignes (seuil 80 %) |
| `xvfb-run -a npm run test:integration` | **66/66 tests** sur le run final retenu (tous profils `.vscode-test.mjs`) |
| `npm run package` | OK — `llm-voice.vsix`, 23 fichiers, 306.07 KB |
| `node scripts/check-traceability.mjs` (racine) | OK — 27 couvert / 0 partiel / 0 non couvert, 33 fichiers de test référencés |
| `LLM_VOICE_E2E=1 LLM_VOICE_E2E_OLLAMA=1 npm run test:integration-real` | **4/4 fichiers, 11/11 tests** contre Chatterbox (`:8004`) et Ollama (`:11434`) réels |

**Point d'attention non bloquant** : `AC-07: selecting a different profile sends a different voice to the TTS provider` (`test/integration/profiles.test.ts`, fichier non modifié par #47/#48/#49) est un flake intermittent reproductible uniquement en run complet (2 échecs sur 3 tentatives locales en suite complète, 0 échec sur 6 tentatives en isolation — le fichier seul). Mécanisme probable : `FakeTtsProvider` est une instance unique partagée par toute l'activation de l'extension pendant un run mocha, et `Pipeline.stop()` ne garantit pas l'annulation d'un travail `AudioQueue` planifié par un test précédent avant que le suivant ne lise `sink.requests`. Confirmé pré-existant et sans lien avec le code produit des 3 PR (voir verdict détaillé sur #49). Recommandation : ticket de suivi pour isoler `FakeTtsProvider`/scoper `stop()` par test, hors périmètre de cette revue.

Aucun tag ni release créé.
