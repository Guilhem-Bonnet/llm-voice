# Evidence pack — GAO-fix-liste-de-001

## Origine du correctif

Retour direct de l'utilisateur, non sollicité par un test automatisé : "Je ne
comprends rien de ce qui se passe [...] dans les profils que je vois plus bas
[...] aucune ne me parle." En réponse, lecture du code réel (pas seulement du
visuel) :

- `src/profiles/defaults.ts` : les 5 profils livrés par défaut ont chacun déjà
  un champ `description` en français clair (ex. "Explication orale
  pédagogique, avec analogies quand elles aident." pour "Professeur
  technique").
- `src/views/profiles/profileTreeItems.ts` (avant correctif) : la ligne
  visible du panneau "Profils" n'affichait jamais ce champ — seulement
  `formatProfileDescription()`, une paire technique "narrateur · voix" (ex.
  "ollama · chatterbox"), illisible pour qui ne connaît pas ces noms. La vraie
  description n'était utilisée qu'en `tooltip`, donc invisible sans survol de
  la souris.
- `src/core/profile.schema.ts:132` : confirme que `description` est un champ
  persistant du schéma, pas une donnée ajoutée après coup — les profils déjà
  installés chez l'utilisateur la portent déjà dans leur `profiles.json`,
  aucune migration nécessaire.

Vérifié aussi, par lecture de `src/onboarding/voiceTiers.ts` et des tests
existants (`voiceTiers.test.ts`, `handleVoiceTier.test.ts`, tous verts), que
les 3 boutons "Choisir une voix" appliquent bien un changement réel au profil
actif (`Pipeline.applyVoiceTierChoice`, bug historique déjà corrigé le
2026-09-12) — mais "Voix système" et "Voix française autonome" pointent
tous deux vers le même `providerId: "system"` en interne, ce qui explique
pourquoi rien ne semble changer visuellement entre ces deux choix tant que
Piper n'est pas effectivement téléchargé.

## Diff

- `vscode-extension/src/views/profiles/profileTreeItems.ts` :
  `buildProfileTreeItems` affiche désormais `profile.description` (quand il
  existe) comme ligne visible, au lieu de la paire technique — qui passe en
  second niveau dans l'infobulle (`"<description>\n\n<technique>"`). Un
  profil sans description humaine retombe sur l'ancien format technique,
  comportement inchangé pour ce cas.
- `vscode-extension/test/unit/views/profiles/profileTreeItems.test.ts` :
  l'ancien test de tooltip mis à jour pour le nouveau format combiné ; deux
  nouveaux tests — la ligne visible montre la description humaine et ne
  contient plus "ollama"/"chatterbox" pour un profil qui en a une ; un profil
  sans description retombe sur l'ancien format technique.

## Résultat des vérifications

```
cd vscode-extension
npx tsc -p ./ --noEmit                                           → No errors found
npx eslint src/views/profiles/profileTreeItems.ts \
  test/unit/views/profiles/profileTreeItems.test.ts \
  --max-warnings=0                                                → No issues found
npm run test:unit    → Test Files 108 passed (108) / Tests 1872 passed (1872)
npm run package:linux-x64 → llm-voice-linux-x64.vsix reconstruit, exit 0
```

## Reconstruction et réinstallation réelles

Build relancé et réinstallé via `code --install-extension
llm-voice-linux-x64.vsix --force` ; présence du nouveau comportement vérifiée
sur le fichier réellement installé
(`~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/dist/extension.js`),
pas seulement dans le dépôt source — même méthode de preuve que les cartes
précédentes.

## Relecture Sentinel et corrections apportées

Relecture indépendante (`agent-optimizer`, 2026-11-05) : **accepté avec
réserves, aucune bloquante**. Deux réserves corrigées avant clôture :

- **R1** : `friendly ?? technical` ne traitait pas une description vide
  (`""`, autorisée par le schéma) — un profil modifié à la main avec
  `description: ""` aurait affiché une ligne quasi vide. Corrigé :
  `profile.description` n'est retenu que s'il est non vide après `trim()`,
  sinon repli sur `technical`, pour la ligne visible comme pour l'infobulle.
  Nouveau test : "falls back to the technical pair when `description` is an
  empty string, not a silently blank row".
- **R2** : le commentaire de code citait un identifiant de carte inventé
  (`GAO-ux-profils-...`) au lieu du vrai (`GAO-fix-liste-de-001`). Corrigé
  dans le commentaire et dans le titre du test qui le citait aussi.
- Trou de couverture signalé : aucun test ne combinait profil actif et
  description humaine (le préfixe "Actif — " n'était testé qu'avec le format
  technique). Ajouté : "prefixes the active profile's row with 'Actif — '
  even when it has a human description".
- R3 (commentaire préexistant trompeur sur le badge distant/local du profil
  actif) et R5 (l'affirmation sur `voiceTiers.ts` dans ce pack, hors diff de
  cette carte) : non bloquants, non corrigés ici — R3 préexistait avant cette
  carte, R5 ne figure dans aucune affirmation du claim-ledger.

## Risques et limites

- `profileQuickPick.ts` (le sélecteur rapide de profil, commande palette)
  garde pour l'instant le format technique — hors périmètre de cette carte,
  amélioration possible séparée (suggérée par Sentinel : même plainte
  utilisateur applicable).
- Aucun profil Kyutai par défaut n'a été ajouté : ce correctif rend le
  panneau existant lisible, il ne résout pas à lui seul la découvrabilité de
  Kyutai (déjà traitée séparément par GAO-fix-provider-001 pour l'éditeur de
  profil).

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
