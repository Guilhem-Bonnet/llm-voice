# Enveloppe de tâche — GAO-feat-l-assis-001

## Objectif

Faire en sorte que l'assistant "Choisir une voix" ouvre réellement un
sélecteur de voix, pas seulement un choix de palier de provider.

## Origine

Relecture Sentinel de GAO-fix-boucle-i-001 : réserve bloquante pour la
communication utilisateur — le correctif de la boucle de retéléchargement
ne traitait pas le second volet de la plainte ("aucun moyen de réellement
choisir une voix"). Confirmé par lecture du code : `handleVoiceTier`
n'ouvrait jamais de sélecteur, seulement un dialogue de palier.

## Périmètre outillé

- `vscode-extension/src/onboarding/handleVoiceTier.ts` : nouvelle action
  `browseVoices` sur `VoiceTierActions`, appelée après les paliers
  "system" et "piper" (jamais "chatterbox", dont le serveur peut ne pas
  être lancé).
- `vscode-extension/src/onboarding/SetupVoice.ts` : nouveau paramètre
  `BrowseVoices` sur `setupVoice()`.
- `vscode-extension/src/extension.ts` : branchement vers
  `pipeline.browseVoices()` (déjà existant, déjà utilisé par la commande
  `llmVoice.browseVoices`).

## Hors périmètre

- Le palier Piper n'offre toujours qu'une seule voix dans
  `SystemTtsProvider.listVoices()` — ce correctif ouvre le vrai sélecteur,
  il n'en invente pas des voix supplémentaires qui n'existent pas.
- Le palier "chatterbox" n'ouvre pas le sélecteur (serveur potentiellement
  pas encore lancé) — l'utilisateur garde la voie habituelle (éditeur de
  profil → "Parcourir les voix") une fois Docker démarré.

## Critères de sortie

- `npm --prefix vscode-extension run test:unit` vert, avec des tests
  explicites sur l'appel (ou non) du sélecteur par palier.
- `grimoire standard gate check --strict` vert.
- Correctif réellement packagé et réinstallé, vérifié sur le build présent
  dans VS Code.
