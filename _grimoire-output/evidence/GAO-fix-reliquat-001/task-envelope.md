# Agentic Task Envelope

## Task

- Task id: GAO-fix-reliquat-001
- Request: Fix · Reliquats voix : port par défaut de Kokoro, bouton sans effet en préparation, avertissement de fenêtre périmée non testé
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
| Que signifie « annuler » pendant `preparing`/`buffering` ? | Le bouton lecture/pause devient une action d'annulation qui envoie l'action existante `stop` : aucun nouveau message de protocole, et `PlaybackController.stop()` invalide déjà la génération en cours. | contexte vérifié : `src/playback/PlaybackController.ts` (`stop`, `playIndex`), `src/extension.ts` (switch `onUserAction`) |
| Les codicons sont-ils utilisables dans le webview du lecteur ? | Non : ni police ni paquet `@vscode/codicons`, et les autres boutons du lecteur sont des glyphes texte. Le bouton d'annulation utilise U+2715, sans présentation emoji ; écart noté dans le pack. | contexte vérifié : `grep codicon` sur `media/` et `node_modules/@vscode` |
| Kokoro doit-il ignorer tout `llmVoice.tts.baseUrl` comme Kyutai ? | Non : Kokoro est dans l'énumération de `llmVoice.tts.provider`, donc une URL choisie dans ce réglage reste un usage légitime. Seuls le port Chatterbox (quelle qu'en soit l'écriture) et le vide cèdent la place au port Kokoro. | contexte vérifié : `package.json` ; arbitrage de l'agent, signalé au demandeur |
| Périmètre : `piper-local` a-t-il le même défaut ? | Hors périmètre de la carte : à prouver puis signaler, sans le corriger. | question ciblée : le brief ne nomme que Kokoro |

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Context bundle | _grimoire-output/context/GAO-fix-reliquat-001/context-bundle.yaml | généré par le kit depuis le Mission Ledger | 2026-11-06 | n/a |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---:|---|
| aucune base de connaissances | n/a | n/a | no | seuls le code et les tests du dépôt font foi |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
| `_grimoire/_memory/shared-context.md` | read | invariants P0 (zéro autoplay, local-first) | fichier relu, pas de contrôle d'intégrité dédié |
| `feedback-boutons-taille-fixe.md` (mémoire utilisateur) | read | règle UI des boutons | fichier relu |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| `npm --prefix vscode-extension run test:unit` | execute | tests du projet (gate run-tests) | racine du projet |
| `npm --prefix vscode-extension run compile` et `typecheck` | execute | contrôle TypeScript | sortie `out/` du paquet |
| Read, Edit, Write | edit | `vscode-extension/` et ce dossier de preuves | jamais `src/tts/KyutaiPocketProvider.ts`, ni les preuves d'autres cartes ; ni commit, ni stash, ni reset, ni checkout |

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
| Implémentation et tests | Anthropic | claude-opus-5-5 (backend-engineer) | aucun | code local, aucune charge GPU ni banc audio |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | tableau « Ambiguïtés résolues » ci-dessus | done |
| Implementation complete | `evidence-pack.md`, inventaire des preuves | done |
| Validation complete | test:unit, compile, typecheck, lint à exit 0 ; vrai VS Code non exécuté | partial |
| Deviations documented | `evidence-pack.md`, écarts et risques | done |
