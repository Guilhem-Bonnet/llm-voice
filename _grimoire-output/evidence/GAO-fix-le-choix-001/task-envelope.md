# Enveloppe de tâche — GAO-fix-le-choix-001

## Objectif

Faire en sorte qu'un choix de voix (assistant "Choisir une voix" ou
"Parcourir les voix") produise un effet visuel réel et immédiat dans le
panneau lecture et la barre de statut, pas seulement un toast transitoire.

## Origine

Après GAO-impl-mente-l-001 (ajout d'un indicateur de voix persistant),
l'utilisateur a testé réellement l'assistant et rapporté : "je vois aucun
changement" (capture d'écran à l'appui). Lecture du code : `currentVoiceLabel`
était bien mis à jour, mais rien n'appelait `pushPlayerState()` ni
`statusBar.update()` juste après — ces deux surfaces ne se rafraîchissent
que lors d'un événement de lecture (début de session, changement d'état de
lecture) ou d'un changement explicite de profil actif
(`selectProfileById`→`refreshLocalModeBadge()`), jamais après un simple
changement de voix sur le profil déjà actif.

## Périmètre outillé

- `vscode-extension/src/pipeline/Pipeline.ts` : `applyVoiceTierChoice` et
  `browseVoices` — ajout de `await this.refreshLocalModeBadge()` (rafraîchit
  la barre de statut, motif déjà établi par `selectProfileById`) et
  `this.pushPlayerState()` (rafraîchit le panneau lecture immédiatement,
  même avant toute session de lecture).

## Hors périmètre

- `applyVoiceToProfileById`/le flux de sauvegarde de l'éditeur de profil
  (webview séparée, a son propre retour visuel) — non touché.
- L'ambiguïté Piper/voix système (toujours non résolue, cf.
  GAO-impl-mente-l-001).

## Critères de sortie

- `npm --prefix vscode-extension run test:unit` vert.
- `grimoire standard gate check --strict` vert.
- Correctif réellement packagé et réinstallé, vérifié sur le build présent
  dans VS Code.

## Limite de preuve assumée

Aucun outil de clic automatisé Wayland n'existe sur ce poste (mémoire du
projet) — ce correctif ne peut pas être prouvé par un clic automatisé réel
dans VS Code. La preuve se limite à : lecture du code confirmant l'appel
manquant puis ajouté, absence de régression sur la suite de tests complète,
et vérification que le build réel installé contient bien ce changement.
L'utilisateur reste le seul à pouvoir confirmer visuellement le résultat.
