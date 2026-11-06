# Enveloppe de tâche — GAO-fix-test-de-001

## Objectif

Le bouton Test de l'éditeur de profil fait entendre Estelle avec le moteur audio
natif, et le bouton pause du panneau de lecture met réellement en pause.

## Périmètre outillé

- `vscode-extension/src/tts/KyutaiPocketProvider.ts` : tailles du WAV streamé.
- `vscode-extension/media/player/player.js` : décision pause/lecture.
- `vscode-extension/src/pipeline/Pipeline.ts`, `src/ui/notifications.ts` : un échec
  de lecture est signalé et journalisé avec sa raison.
- `vscode-extension/src/pipeline/resolveProviderConfig.ts` : adresse par défaut
  de `kyutai-pocket` quand le profil n'en donne pas.
- `vscode-extension/media/profileEditor/profileEditor.js` : message du bouton Test.
- Cache audio local de l'utilisateur : réparation de l'en-tête de l'unique WAV cassé.
- Tests unitaires associés.

Exclus : le cœur Rust, le catalogue de voix, le même défaut d'adresse sur Kokoro.

## Critères de sortie

- Une vraie synthèse Estelle passée par le code du provider est lue par le vrai
  lecteur natif, et sa capture sur sortie audio nulle est transcrite (WER ≤ 0,25).
- Le vrai `player.js` envoie `pause` quand l'état affiché est `playing`.
- `npm --prefix vscode-extension run test:unit` vert.
- `grimoire standard gate check --task-id GAO-fix-test-de-001 --strict` vert.
- Limite assumée : aucun clic réel dans VS Code depuis cette session ; la
  confirmation finale à l'oreille revient à l'utilisateur.
