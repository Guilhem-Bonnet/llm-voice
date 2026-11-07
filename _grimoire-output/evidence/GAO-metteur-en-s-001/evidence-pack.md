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
