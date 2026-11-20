# Agentic Task Envelope

## Task

- Task id: GAO-refonte-ux-0-005
- Request: Refonte UX 05 · Galerie de voix en onglet : cartes, écoute, préparation, recherche, favorites, phrase d'essai
- Owner agent: guilhem-bonnet
- Profile: controlled
- Current state: `executing`
- Risk level: `medium`

## Ambiguïtés résolues

Toute ambiguïté bloquante rencontrée pendant la tâche, et comment elle a été
résolue — par contexte vérifié (relecture, source faisant autorité) ou par
question ciblée posée au demandeur. Une hypothèse non vérifiée reste une
hypothèse, jamais un fait tant que la colonne « Source » ne le dit pas.

| Question posée | Résolution | Source (contexte vérifié / question ciblée / hypothèse) |
|---|---|---|
| La maquette montre « Démarrer le serveur » : faut-il lancer un processus ? | Non : la galerie dit que le serveur est arrêté et propose la commande adaptée ; le démarrage automatique est la carte 0-006. | Brief de la carte (contexte vérifié) |
| Quel texte disent les échantillons inclus ? | Inconnu ici (ni le script d'encodage ni les preuves ne le donnent). La phrase d'essai reste donc vide par défaut au lieu d'afficher une phrase qui pourrait ne pas être celle entendue. | Hypothèse prudente, à valider à l'écoute (AC-003) |
| Où vont les niveaux retirés du Quick Pick (Piper à installer, Chatterbox) ? | Dans la section « À préparer » : Piper non installé y apparaît avec « Installer », sinon il perdrait son seul accès. | Hypothèse, signalée comme écart dans le rapport |

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Context bundle | _grimoire-output/context/GAO-refonte-ux-0-005/context-bundle.yaml | généré par le kit depuis le Mission Ledger | 2026-11-06 | n/a |
| Maquette | scratchpad design/project : Main, Galerie-etats, Credits, Clair-galerie, Systeme, Menus (.dc.html) | spécification visuelle de la carte | 2026-11-05 | n/a |
| ADR | docs/adr/ADR-017 § Découpe et §3, ADR-016 §4 | contrat `setGlobalVoice`, alias `browseVoices`, licences | 2026-11-06 | n/a |
| Modèle existant | src/profiles/voiceResolution.ts, src/tts/kyutaiVoiceCatalog.ts, media/voices/CREDITS.md | catalogue, `bindingForEngineVoice`, crédits | HEAD 033a91f | n/a |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---:|---|
|  |  |  | no |  |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
|  | read |  |  |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| `npm --prefix vscode-extension run test:unit` | execute | tests du projet (gate run-tests) | racine du projet |
| `npm run typecheck`, `lint`, `build`, `xvfb-run -a npx vscode-test --label fake-tts`, `test:integration-voice`, `package:linux-x64`, `check-vsix` | execute | vérification de la carte | vscode-extension/ ; pas de banc audio ni de charge GPU |
| Édition de fichiers | edit | vscode-extension/ et preuves de la carte | ni commit, ni push, ni stash, ni reset, ni checkout ; carte non déplacée |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation | Anthropic | claude-opus-5-5 (backend-engineer, dispatché) | aucun | code du dépôt, aucune donnée utilisateur |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | Spécification du brief et table « Ambiguïtés résolues » ci-dessus | done |
| Implementation complete | vscode-extension/src/views/voiceGallery/, media/voiceGallery/, `chooseVoice` réduit | done |
| Validation complete | evidence-pack.md § Validation ; écoute humaine AC-003 et gate strict restent à faire | partial |
| Deviations documented | evidence-pack.md § Deviations | done |
