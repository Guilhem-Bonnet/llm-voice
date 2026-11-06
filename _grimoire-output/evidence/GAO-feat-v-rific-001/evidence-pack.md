# Evidence pack — GAO-feat-v-rific-001

## Origine

Demande explicite : "cherche la solution durable et continu le travail de
ui/ux [...] je veux un vrai travail qui permet de bien comprendre tout
dessuite." Après plusieurs correctifs ponctuels sur des décalages
provider/Base URL (le dernier confirmé par l'utilisateur lui-même sur
`127.0.0.1:8004`), la vraie solution structurelle est de rendre l'état de
connexion visible dans l'éditeur lui-même, en direct, plutôt que de
continuer à corriger des cas précis un par un.

## Diff

- `vscode-extension/src/views/profileEditor/ProfileEditorPanel.ts` :
  `ProfileEditorDeps.checkHealth(profile): Promise<ProviderHealth>` ;
  `WebviewToExtensionMessage.type` étend `"checkHealth"` ;
  `handleCheckHealth` — valide le formulaire (même garde que
  `handleTest`), appelle `deps.checkHealth`, répond `{type:
  "healthResult", ...health}` ; une erreur de validation est traitée
  comme un résultat `unreachable`, jamais silencieuse.
- `vscode-extension/src/pipeline/Pipeline.ts` : `checkTtsHealth(profile)`
  réutilise `ttsFor()` + `.health()` (même chemin que tout le reste de
  l'extension, ADR-005) — pas de nouvelle mécanique réseau inventée.
  Câblé dans `openProfileEditorById`'s `deps`.
- `vscode-extension/src/views/profileEditor/profileEditorHtml.ts` :
  `<div id="connection-row">` (champ Base URL + bouton "Vérifier la
  connexion") et `<p id="connection-status" role="status"
  aria-live="polite">`.
- `vscode-extension/media/profileEditor/profileEditor.js` :
  `checkConnection()` poste `{type: "checkHealth", profile:
  collectFormProfile()}` ; déclenché par le bouton, par `change` sur
  `field-tts-provider` (après l'auto-remplissage de l'URL — donc vérifie
  bien la bonne adresse), et par `blur` sur `field-tts-base-url`. Le
  message `healthResult` colore et texte la zone de statut ; `load` la
  remet à zéro pour qu'aucun résultat périmé ne survive à un changement de
  profil.
- `vscode-extension/media/profileEditor/profileEditor.css` : classes
  `.connection-ok`/`.connection-error`.

## Résultat des vérifications

```
cd vscode-extension
npx tsc -p ./ --noEmit                                     → No errors found
npx eslint src/views/profileEditor/ProfileEditorPanel.ts \
  src/views/profileEditor/profileEditorHtml.ts \
  src/pipeline/Pipeline.ts media/profileEditor/profileEditor.js \
  test/unit/views/profileEditor.behavior.test.ts \
  --max-warnings=0                                          → No issues found
npm run test:unit   → Test Files 110 passed (110) / Tests 1903 passed (1903)
```

Nouveaux tests dans `test/unit/views/profileEditor.behavior.test.ts`
("live connection check", 6 tests) — exécutent le vrai `profileEditor.js`
contre un DOM factice :
- clic sur le bouton → poste bien `checkHealth` avec le profil du
  formulaire courant.
- changement de provider → vérifie automatiquement, **après**
  l'auto-remplissage (donc sur la bonne adresse corrigée).
- perte de focus du champ Base URL → vérifie automatiquement.
- résultat `ok` → texte vert "✓ Joignable", nomme l'endpoint.
- résultat `unreachable` → texte d'erreur, cite le détail réel.
- chargement d'un nouveau profil → remet le statut à zéro (pas de résultat
  périmé affiché pour le mauvais profil).

## Reconstruction et réinstallation réelles

`npm run package:linux-x64` puis installation dans le profil VS Code
réellement utilisé par ce workspace (`__default__profile__`, confirmé via
`profileAssociations` dans `storage.json`).

## Relecture Sentinel et correction apportée

Relecture indépendante (`agent-optimizer`, 2026-11-05) : **accepté avec
réserves, aucune bloquante**. Deux réserves, une corrigée :

- **Corrigée** : rien n'empêchait deux vérifications de se chevaucher
  (ex. modifier l'URL puis changer de provider déclenche `blur` puis
  `change`, chacun postant son propre `checkHealth`) — si les réponses
  revenaient dans le désordre, le statut affiché pouvait décrire la
  mauvaise vérification. Corrigé par un `requestId` incrémental, renvoyé
  tel quel par `healthResult` : toute réponse dont l'id ne correspond pas
  à la dernière requête envoyée est ignorée. Un `blur` sans changement
  réel de valeur (tabulation sans édition) ne redéclenche plus non plus
  de vérification inutile. Deux nouveaux tests : "ignores a stale
  healthResult superseded by a newer check" (reproduit explicitement
  l'ordre inversé des réponses) et "does not re-check on a blur that
  changed nothing".
- **Non corrigée, non bloquante** : `handleCheckHealth` dans
  `ProfileEditorPanel.ts` n'a pas de test unitaire dédié (même limite
  préexistante que `handleTest`/`handleBrowseVoices`, dépendance forte à
  `vscode`, couverte seulement par les tests d'intégration) — déjà
  déclaré dans l'acceptance-record.
- Chiffres corrigés dans les claim-ledgers des deux cartes liées (le
  nombre exact de tests par correctif était inexact dans une version
  antérieure).

## Risques et limites

- `ProfileEditorPanel.ts` n'a pas de suite de tests unitaires dédiée
  (dépendance forte à `vscode`, limite préexistante du fichier, pas
  introduite ici) — `handleCheckHealth` suit exactement le même motif
  établi que `handleTest`/`handleBrowseVoices`, déjà couverts seulement
  par les tests d'intégration (`vscode-test`, hors `npm run test:unit`).
- La vérification ne fait qu'un `health()`, pas une synthèse réelle — un
  serveur qui répond "healthy" mais échoue en pratique sur un texte
  particulier ne serait pas détecté ici (comportement volontaire : plus
  rapide, sans effet de bord audio, cohérent avec `health()` partout
  ailleurs dans le projet).

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
