# Evidence pack — GAO-metteur-en-s-001 (état intermédiaire, 2026-11-07)

## Fait
- Commit `de4a6fd` : incrément 2, partie code.
  - `vscode-extension/src/direction/cast/stagePlay.ts` : table états → consignes anglaises (données, aucune branche par état), au plus deux consignes, garde ASCII sans crochets, contexte (souffle et toux durent sur la réplique suivante du même personnage, une fois ; la narration ne joue jamais).
  - `ChunkVoice.direction` → `bindingForChunk` → requête (`TtsRequest.direction`) et clé de cache (`computeCacheKey` ajoute `direction:` seulement si présente : clés sans consigne inchangées).
  - Qwen3 : `direction.instructions: true` (`src/tts/presets.ts`) ; `Pipeline.castVoicesOf` en tire `playsStates`, passé à `assignCast`.
  - Point d'entrée `extraDirections` (consignes du metteur en scène, par id de segment) prévu dans `assignCast`, pas encore alimenté.

## Commandes exécutées (dans `vscode-extension/`, avant le commit)
- `npm run -s typecheck` : code 0.
- `npm run -s lint` : aucune sortie d'erreur.
- `npm run -s test:unit` : 153 fichiers, 3178 tests passés.
- `npm run -s build` : Done.
- `xvfb-run -a npx vscode-test --label fake-tts` : 79 passing ; `--label integration-security` : 8 passing ; `--label voice-chain` : 52 passing.

## Non fait / non prouvé
- Incrément 1 (propositions âge/genre/caractère avec citation vérifiée, colonne `proposal`, bouton « Appliquer ») : non commencé.
- Incrément 2 : consignes du metteur en scène pour les états hors table (« Il tire son épée ») non branchées ; aucune lecture réelle.
- Incrément 3 (démarrage anticipé d'après la vitesse mesurée) : non commencé.
- Aucune preuve audio réelle, aucune charge GPU lancée.

## Reprise du 2026-11-07 — incrément 1 (commit `7469bf6`)
- `vscode-extension/src/direction/director/castProposals.ts` : prompt, schéma JSON fermé (genre woman|man, âge child|young|adult|elderly, caractère = ids de `VOICE_TRAITS`), `verifyProposals` (citation absente → `quote-absent`, réduite à un nom → `name-only`, valeur hors liste → `invalid-value`), `nearestVoice` (tables de mots anglais par valeur comparées à la `description` de la voix, jamais la narratrice, voix libre devant à égalité), cache par document (`proposalCacheKey`), mode jeu → aucun appel.
- `OllamaDirectionLlm.structured()` (appel `propose`), `Pipeline.prepareCastProposals` (journal : comptes et raisons, aucun mot du texte), colonne proposition et boutons « Proposer d'après le texte » / « Appliquer » dans `media/castPanel/castPanel.js`, `description` lue dans `GET /voices`.
- Commandes : `npm run -s typecheck` 0 ; `lint` sans erreur ; `test:unit` 154 fichiers, 3187 tests passés ; `build` ok ; `vscode-test` integration-security 8 passing, voice-chain 52 passing ; fake-tts 1 échec au premier passage (« a narrated reading … goes past its first group », lecture narrée, hors du code touché), puis 79 passing deux fois de suite.
- Preuve réelle (Ollama `qwen2.5:7b`, local, drapeau gpu-yield absent vérifié dans le script) sur `docs/essais-voix/07-theatre-noms-seuls.md` : `propositions-07.json` — Isaure : femme d'après « Madame » ; Le Comte : homme d'après « seigneur » ; 0 rejet ; 6,9 s. « Elle pose sa lampe » non rendu (une citation par champ).
- Non fait : metteur en scène pour `extraDirections`, démarrage anticipé, preuve audio réelle.
