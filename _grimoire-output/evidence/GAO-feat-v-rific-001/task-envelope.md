# Enveloppe de tâche — GAO-feat-v-rific-001

## Objectif

Ajouter une vérification de connexion en direct dans l'éditeur de profil,
pour qu'un décalage provider/Base URL soit visible immédiatement — pas
seulement après une tentative de synthèse échouée avec un message
cryptique.

## Origine

Demande explicite de l'utilisateur ("cherche la solution durable") après
une série de bugs réels tous liés à des décalages provider/URL invisibles
dans l'interface (GAO-fix-l-url-du-001 et la longue séance de diagnostic
qui l'a précédée : profil VS Code, cache webview, découverte du bouton
crayon). Le correctif ponctuel (auto-remplissage de l'URL) résout le cas
le plus fréquent, mais pas tous les cas (URL personnalisée invalide,
serveur arrêté, mauvais port tapé à la main) — une vérification réelle,
visible dans l'éditeur, couvre tous ces cas sans avoir à les anticiper un
par un.

## Périmètre outillé

- `vscode-extension/src/views/profileEditor/ProfileEditorPanel.ts` :
  nouveau type de message `checkHealth`, nouvelle méthode
  `handleCheckHealth`, nouvelle entrée `checkHealth` sur
  `ProfileEditorDeps`.
- `vscode-extension/src/pipeline/Pipeline.ts` : nouvelle méthode
  `checkTtsHealth(profile)` (réutilise `ttsFor()` + `.health()`, déjà
  utilisés partout ailleurs, ADR-005) ; câblée dans `openProfileEditorById`.
- `vscode-extension/src/views/profileEditor/profileEditorHtml.ts` :
  bouton "Vérifier la connexion" + zone de statut sous Base URL.
- `vscode-extension/media/profileEditor/profileEditor.js` : déclenchement
  automatique au changement de provider et à la perte de focus du champ
  Base URL, plus le bouton explicite ; gestion du message `healthResult`.
- `vscode-extension/media/profileEditor/profileEditor.css` : styles
  joignable/injoignable.

## Hors périmètre

- Aucune tentative de synthèse réelle n'est faite par cette vérification
  (seulement `health()`, pas `synthesize()`) — plus rapide, sans effet de
  bord audio.
- N'ajoute pas de bouton "Réessayer" après échec ; l'utilisateur corrige
  le champ et redéclenche en le quittant à nouveau (comportement déjà
  suffisant, pas ajouté pour rester simple).

## Critères de sortie

- `npm --prefix vscode-extension run test:unit` vert, avec des tests qui
  exécutent le vrai `profileEditor.js` contre un DOM factice couvrant :
  déclenchement par bouton, par changement de provider, par perte de
  focus ; affichage correct pour un résultat `ok`/`unreachable` ; remise à
  zéro au chargement d'un nouveau profil.
- `grimoire standard gate check --strict` vert.
- Correctif réellement packagé et réinstallé, vérifié sur le build présent
  dans VS Code.
