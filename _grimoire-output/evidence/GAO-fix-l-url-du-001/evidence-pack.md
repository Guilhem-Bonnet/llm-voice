# Evidence pack — GAO-fix-l-url-du-001

## Origine du correctif

Utilisateur, en situation réelle : "ok je viens de mettre estelle, mais
rien ne fonctionne [...] LLM Voice : la voix « kyutai-pocket »
(http://127.0.0.1:8004) a échoué — fetch failed." `8004` est le port par
défaut de Chatterbox (`CHATTERBOX_LOCAL_PRESET.baseUrl`,
`src/tts/presets.ts`), pas celui de Kyutai Pocket TTS (`8000`).

Lecture du code confirmant le diagnostic :
`media/profileEditor/profileEditor.js` — `fields.ttsProvider` n'avait
aucun écouteur `change` ; `applyProfileToForm`/`collectFormProfile`
lisent/écrivent `fields.ttsBaseUrl` indépendamment du provider choisi.
Changer le menu déroulant Provider ne touchait donc jamais le champ Base
URL, qui gardait la valeur chargée au moment de l'ouverture du formulaire
(ici, celle du profil d'origine, construit avec Chatterbox).

## Diff

- `vscode-extension/media/profileEditor/profileEditor.js` : nouvel
  écouteur `fields.ttsProvider.addEventListener("change", ...)`. Table
  `KNOWN_DEFAULT_BASE_URLS` (chatterbox→8004, kokoro→8880,
  kyutai-pocket→8000, mirroir manuel de `src/tts/presets.ts` — ce fichier
  webview n'a pas d'accès bundler/import au code TS). Règle : le champ
  n'est mis à jour que s'il est vide ou contient déjà l'adresse par défaut
  d'un *autre* provider connu — jamais une URL tapée à la main par
  l'utilisateur.

## Résultat des vérifications

```
cd vscode-extension
npx eslint test/unit/views/profileEditor.behavior.test.ts --max-warnings=0 → No issues found
npm run test:unit   → Test Files 110 passed (110) / Tests 1894 passed (1894)
```

Nouveau fichier `test/unit/views/profileEditor.behavior.test.ts` — exécute
le **vrai** `profileEditor.js` contre un DOM factice minimal (même
technique que `test/unit/security/webview-injection.test.ts` pour
`player.js`), 4 tests :
- remplit l'URL Kyutai par défaut depuis un champ vide.
- **reproduit exactement le bug rapporté** : `8004` (Chatterbox) →
  bascule sur Kyutai → devient `8000`.
- ne touche jamais une URL personnalisée tapée à la main.
- ne touche rien pour un provider sans adresse par défaut connue (system,
  openai-compatible).

## Reconstruction et réinstallation réelles

`npm run package:linux-x64` puis réinstallation — **cette fois avec le
profil VS Code correctement identifié comme étant réellement utilisé par
ce workspace** (voir note ci-dessous sur l'enquête des profils).

## Relecture Sentinel et correction apportée (réserve bloquante)

Relecture indépendante (`agent-optimizer`, 2026-11-05) : **accepté avec une
réserve bloquante** — l'erreur réellement citée par l'utilisateur nommait
`http://127.0.0.1:8004`, mais la comparaison initiale (`KNOWN_DEFAULT_
BASE_URLS` comparée verbatim) ne reconnaissait que `localhost:8004` comme
valeur par défaut connue. Si le champ contenait réellement `127.0.0.1`
(et non `localhost`), le court-circuit "déjà installée" ne se serait jamais
déclenché pour le cas précis rapporté.

**Corrigé** : `profileEditor.js` normalise désormais la comparaison
(minuscules, sans slash final, `127.0.0.1` traité comme équivalent à
`localhost`) avant de décider si le champ contient une valeur par défaut
connue. Deux nouveaux tests ajoutés :
- `"recognizes the 127.0.0.1 spelling too"` — reproduit exactement l'adresse
  citée dans le message d'erreur réel de l'utilisateur.
- `"also recognizes a trailing slash or different case"`.
- `"never overwrites a custom loopback URL on a non-default port"` — garantit
  que la normalisation ne devient pas trop agressive (un `127.0.0.1` sur un
  port qui n'est le défaut d'aucun provider reste traité comme une saisie
  manuelle, jamais écrasé).

CL-003 du claim-ledger, initialement marqué "prouvé" pour ce cas précis
alors que le test ne couvrait que `localhost`, est corrigé ci-dessous.

## Solution durable (demande explicite de l'utilisateur)

Au-delà de ce correctif ponctuel, une vérification de connexion **en
direct** a été ajoutée dans l'éditeur de profil (voir la carte séparée
`GAO-verif-connex-001` si ouverte) : un bouton "Vérifier la connexion" et
une zone de statut à côté du champ Base URL, déclenchés automatiquement au
changement de provider et à la perte de focus du champ. Ça rend ce type de
décalage provider/URL visible **avant** d'essayer de parler, au lieu
d'attendre un échec de synthèse avec un message cryptique.

## Note : enquête sur "je ne vois toujours rien" (hors correctif lui-même)

Avant de localiser ce bug, plusieurs cycles de diagnostic ont été
nécessaires pour comprendre pourquoi l'utilisateur ne voyait aucun
changement malgré des builds à jour confirmés sur disque :
1. D'abord soupçonné un profil VS Code nommé "Infra" distinct du profil
   par défaut — **piste fausse**, corrigée ensuite : la table
   `profileAssociations` de `storage.json` a confirmé que ce workspace
   (`/mnt/Travail/Projets/Dev/TTS-Voice`) utilise bien
   `__default__profile__`, celui déjà mis à jour correctement depuis le
   début.
2. Confirmé via le terminal intégré de l'utilisateur lui-même (pas le
   mien) que le fichier `package.json` installé était identique et à jour
   — écarte toute hypothèse de bac à sable/filesystem différent.
3. Confirmé via "Developer: Show Running Extensions" que l'extension
   tournait sans erreur.
4. Cause réelle trouvée : l'utilisateur ne savait pas qu'il fallait
   survoler une ligne du panneau "Profils" pour faire apparaître les
   icônes d'action (activer/éditer/dupliquer/supprimer) — once guidé
   précisément, il a bien trouvé la section "Voix (TTS)" et sélectionné
   Kyutai, révélant alors ce vrai bug de Base URL.

## Risques et limites

- `KNOWN_DEFAULT_BASE_URLS` est une copie manuelle des valeurs de
  `presets.ts` — si un preset change son `baseUrl` par défaut un jour,
  ce fichier devra être mis à jour séparément (documenté dans le
  commentaire du code).
- `openai-compatible` et `system` n'ont toujours pas de remplissage
  automatique — c'est voulu (pas d'adresse par défaut sensée pour l'un,
  aucune adresse nécessaire pour l'autre).

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
