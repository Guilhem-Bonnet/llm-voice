# Agentic Evidence Pack

## Summary

- Task id: GAO-refonte-ux-0-005
- Profile: controlled
- Outcome: Refonte UX 05 · Galerie de voix en onglet : cartes, écoute, préparation, recherche, favorites, phrase d'essai — critères : AC-001 test: l'écoute ne se lance jamais sans clic; AC-002 test: aucun bouton ne passe à la ligne ni ne s'étire à 260, 320 et 500 px; AC-003 revue: écoute et validation par guilhem-bonnet; AC-004 test: npm --prefix vscode-extension run test:unit vert; AC-005 gate: grimoire standard gate check --strict vert
- Final state: in_progress (2026-11-06)

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Point de départ git | HEAD 033a91f | git rev-parse --short HEAD | référence (2026-11-06) |
| Matrice des formats dans un vrai webview (VS Code 1.145.1, Electron 43.8.3) | codec-probe.txt | test d'intégration temporaire, retiré ensuite | Ogg Opus et WebM Opus refusés ; Ogg Vorbis, MP3, FLAC, WAV acceptés |
| Mesure des boutons, Chromium headless, 260 à 1400 px | render-measures.txt | page réelle, variables `--vscode-*` simulées | 0 bouton étiré, à la ligne ou débordant ; aucun débordement horizontal |
| Rendus | galerie-*.png | même harnais | sombre (1400, 1120, 800, 500, 320, 260, serveur arrêté), clair (1120), crédits (720) |

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
| Tests d'abord | `vitest run` sur les 3 nouveaux fichiers, avant le code | rouge : `Test Files 3 failed (3)`, `Cannot find module .../voiceGalleryHtml.js`, `.../galleryModel.js` | puis vert |
| Types | `npm run typecheck` | exit 0 | |
| Lint | `npm run lint` | exit 0 | |
| Unitaires | `npm run test:unit` | exit 0, `Test Files 125 passed (125)`, `Tests 2617 passed (2617)` | AC-001, AC-002 statique, AC-004 |
| Build | `npm run build` | exit 0 | |
| Intégration | `xvfb-run -a npx vscode-test --label fake-tts` | exit 0, `66 passing` | |
| Intégration voix | `npm run test:integration-voice` | exit 0, `22 passing` | dont 8 de la galerie ; les 20 échantillons atteignent `canplay` dans un vrai webview sous la CSP de la galerie |
| Paquet | `npm run package:linux-x64` (inclut `check-vsix --target linux-x64`) | exit 0, `Packaged: llm-voice-linux-x64.vsix (49 files, 2.04 MB)`, `every required file present` | liste requise étendue à la galerie, aux crédits et aux 20 échantillons |
| Gate | `grimoire standard gate check --strict` | non exécuté | la carte reste en running, le concierge la déplace |

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
| Échantillons réencodés d'Ogg Opus en Ogg Vorbis (depuis les Opus, faute des WAV d'origine) | L'Opus ne se décode pas dans le webview : sans cela, Écouter échouait sur les 20 voix. 696 Ko au lieu d'environ 340 Ko. ADR-016 §4 dit encore « Ogg Opus ». | à valider par guilhem-bonnet | écoute AC-003 ; amendement d'ADR-016 |
| Pas de « Démarrer le serveur » ni « Arrêter » | La commande est proposée et copiable ; carte 0-006 | brief de la carte | 0-006 |
| Phrase d'essai vide par défaut, pas pré-remplie | Le texte réel des échantillons est inconnu ici | à valider | écoute AC-003 |
| Piper non installé rejoint « À préparer » avec « Installer » | Sinon plus aucun accès depuis le retrait des niveaux du Quick Pick | à valider | revue |
| « Ma voix » : bouton « Préparer », pas « Enregistrer » | Le parcours actuel part d'un fichier ; l'enregistrement relève de 1-003 | à valider | 1-003 |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Contrôles rejoués par le concierge (2026-11-06)

- Échantillons réencodés depuis les WAV d'origine (`scripts/encode-voice-samples.sh`, Ogg Vorbis, 496 Ko au total), plus de double compression. Le test d'intégration `canplay` des 20 fichiers est rejoué sur ces fichiers.
- Texte des échantillons : « Bonjour. Je lis ce document à voix haute pour vous aider à le comprendre. »
- Contrôles du lancement ci-dessous consignés dans le message de livraison ; installé dans le VS Code de l'utilisateur.

## Stabilité des tests (2026-11-06)

- Deux causes distinctes. État conservé entre exécutions : dossier de test vidé à chaque lancement (`.vscode-test.mjs`). Écrasement de sélection par la migration : `profileStore.ts`, test `migrationSelectionRace.test.ts`, échec constaté sans le correctif (`expected 'faithful-local' to be 'technical-teacher'`).
- Rafraîchissements croisés de la liste : `profilesTreeRefresh.test.ts`, échec constaté sans le correctif.
- `fake-tts` : 12 passes de suite à 66 sur 66, puis 3 sur la version finale. Une erreur de compilation d'un test avait interrompu la construction pendant plusieurs passes : résultats écartés et rejoués.
