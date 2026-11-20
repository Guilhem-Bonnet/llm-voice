# Enveloppe de tâche — GAO-fix-l-url-du-001

## Objectif

Faire en sorte que changer de provider TTS dans l'éditeur de profil mette à
jour automatiquement l'URL du serveur (Base URL) vers l'adresse par défaut
du nouveau provider, sans écraser une URL personnalisée.

## Origine

Utilisateur, après avoir suivi les instructions pour éditer un profil et y
sélectionner Kyutai Pocket TTS + voix estelle : erreur "fetch failed" sur
`http://127.0.0.1:8004` — le port par défaut de Chatterbox, resté en place
depuis le profil d'origine, jamais remplacé par celui de Kyutai (8000).

## Périmètre outillé

- `vscode-extension/media/profileEditor/profileEditor.js` : nouvel
  écouteur `change` sur `field-tts-provider` qui met à jour
  `field-tts-base-url` vers l'adresse par défaut du nouveau provider,
  seulement si le champ est vide ou contient déjà l'adresse par défaut
  connue d'un autre provider (jamais une URL tapée à la main).

## Hors périmètre

- Les presets TypeScript (`src/tts/presets.ts`) ne sont pas modifiés ; les
  valeurs par défaut sont dupliquées à la main côté webview (ce fichier
  n'a pas de bundler/import vers le code TS) — risque de désynchronisation
  documenté dans le commentaire du code.
- `openai-compatible` et `system` n'ont pas d'URL par défaut sensée
  (distant/non pertinent) — aucun remplissage automatique pour eux.

## Critères de sortie

- `npm --prefix vscode-extension run test:unit` vert, avec un test qui
  exécute le vrai `profileEditor.js` contre un DOM factice et vérifie le
  cas exact rapporté par l'utilisateur (8004 → 8000 en passant à Kyutai),
  plus la non-écrasement d'une URL personnalisée.
- `grimoire standard gate check --strict` vert.
- Correctif réellement packagé et réinstallé, vérifié sur le build présent
  dans VS Code.
