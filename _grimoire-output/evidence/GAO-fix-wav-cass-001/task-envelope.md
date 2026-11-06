# Enveloppe de tâche — GAO-fix-wav-cass-001

Écrite après le diagnostic, au moment d'ouvrir la carte, avant la première modification du code.

## Objectif

La voix enregistrée dans le profil actif s'entend à la lecture d'un document, y compris
quand le cache contient un WAV cassé ; une fenêtre sur code périmé le signale.

## Périmètre outillé

`vscode-extension/src/core/wavRepair.ts`, `src/playback/DiskAudioCache.ts`,
`src/pipeline/Pipeline.ts`, `src/tts/KyutaiPocketProvider.ts`,
`scripts/audio-proof/native-real.sh`, tests associés. Exclus : catalogue de voix et refonte UX.

## Critères de sortie

Test unitaire de guérison vert, scénario réel sur cache empoisonné vert et fichier réparé
sur disque, `test:unit` et gate stricts verts.
