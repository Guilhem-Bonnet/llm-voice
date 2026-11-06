# Evidence pack — GAO-fix-boucle-i-001

## Origine du correctif

Retour direct de l'utilisateur, après avoir réellement testé l'assistant
"Choisir une voix" : "il me propose juste de télécharger quelque chose. Une
fois téléchargé, en recliquant à nouveau, il me refait télécharger la même
chose en boucle." Lecture du code (pas seulement le symptôme) :

- `vscode-extension/src/tts/PiperSetup.ts`, `installPiperVoice()` : aucune
  vérification de l'état existant avant d'afficher le dialogue de
  consentement et de lancer le téléchargement — chaque appel repartait de
  zéro.
- `vscode-extension/src/tts/SystemTtsProvider.ts`, `detectManagedPiper()` :
  vérifie déjà `bin/piper(.exe)` + `voices/<voiceId>.onnx` pour détecter une
  installation gérée — exactement la logique manquante côté installation,
  jamais réutilisée là où elle aurait dû l'être.

## Diff

- `vscode-extension/src/tts/PiperSetup.ts` :
  - nouvelle fonction exportée `isPiperAlreadyInstalled(installDir,
    platform)` : vérifie l'existence de `bin/piper(.exe)` et
    `voices/<voiceId>.onnx`, miroir de `detectManagedPiper`.
  - nouveau statut `"already-installed"` sur `PiperInstallOutcome` (mêmes
    champs que `"installed"`).
  - `installPiperVoice()` appelle ce contrôle en tout premier, avant même
    la vérification de plateforme supportée et le dialogue de consentement
    — retourne immédiatement `{status: "already-installed", ...}` si les
    deux fichiers sont présents, sans aucun appel réseau.
- `vscode-extension/src/pipeline/Pipeline.ts`, `reportPiperInstallOutcome` :
  nouveau message "LLM Voice : la voix française (Piper) est déjà installée
  et prête à l'emploi." pour ce statut.
- `vscode-extension/src/tts/AutoVoiceInstall.ts` : `nextActionFor` traite
  `"already-installed"` comme `"resumed"` (au même titre que `"installed"`)
  ; `fallbackMessageFor` étend son switch exhaustif (TypeScript a forcé
  cette mise à jour partout où le type est utilisé — aucun site oublié,
  confirmé par `tsc` sans erreur après l'ajout du nouveau statut).

## Résultat des vérifications

```
cd vscode-extension
npx tsc -p ./ --noEmit                                    → No errors found
npx eslint src/tts/PiperSetup.ts src/tts/AutoVoiceInstall.ts \
  src/pipeline/Pipeline.ts test/unit/tts/PiperSetup.test.ts \
  test/unit/tts/AutoVoiceInstall.test.ts --max-warnings=0   → No issues found
npm run test:unit   → Test Files 109 passed (109) / Tests 1887 passed (1887)
```

Nouveaux tests dans `test/unit/tts/PiperSetup.test.ts` :
- `isPiperAlreadyInstalled` : retourne `undefined` sur un dossier vide,
  retourne les chemins corrects une fois les deux fichiers présents.
- `installPiperVoice` reporte `"already-installed"` sans jamais appeler
  `prompt.confirm` ni `download` (linux et win32, nom de binaire `.exe`
  vérifié séparément).
- Une installation partielle (un seul des deux fichiers) ne déclenche PAS
  le court-circuit — repasse bien par le dialogue de consentement habituel.
- Test préexistant adapté : "leaves a previously-working install untouched
  when a retry fails" simulait une installation complète déjà en place —
  désormais ce cas précis est couvert par le court-circuit lui-même (aucun
  téléchargement n'est même tenté). Le test a été réécrit pour simuler une
  tentative *partielle* antérieure (un seul fichier), qui continue de
  démontrer la vraie propriété de sécurité visée : l'échange atomique
  (`fsp.rename`) ne touche jamais `binDir`/`voicesDir` avant qu'un
  téléchargement complet n'ait réussi.

## Reconstruction et réinstallation réelles

`npm run package:linux-x64` puis `code --install-extension
llm-voice-linux-x64.vsix --force` ; vérifié sur le fichier réellement
installé (`~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/`), pas
seulement le dépôt source.

## Relecture Sentinel et corrections apportées

Relecture indépendante (`agent-optimizer`, 2026-11-05) : **accepté avec
réserves — une réserve bloquante pour annoncer le problème utilisateur
entièrement résolu (pas pour le correctif lui-même)**.

- **Réserve bloquante (pour la communication utilisateur, pas pour le
  code)** : la plainte initiale avait deux volets — "il me refait
  télécharger en boucle" (corrigé par cette carte) et "je n'ai aucun moyen
  de réellement choisir une voix" (non traité ici). Vérifié : une fois
  Piper détecté par `SystemTtsProvider`, `listVoices()` ne renvoie qu'**une
  seule voix** (`SystemTtsProvider.ts` ligne ~697-698, `case "piper":
  return [{ id: PIPER_VOICE_ID, ... }]`) — il n'y a structurellement rien à
  "choisir" dans ce palier. Pour un vrai choix de voix, il faut passer par
  l'éditeur de profil (Chatterbox/Kokoro/Kyutai, ou espeak-ng avant que
  Piper ne prenne la priorité). Ce n'est pas un bug de cette carte, mais un
  fait à communiquer honnêtement plutôt que de déclarer "résolu" sans
  nuance.
- **Corrigée** : `autoTtsCache` n'était invalidé que sur `"installed"`, pas
  sur `"already-installed"` — un cache `auto` périmé pourrait continuer à
  utiliser l'ancien provider jusqu'à expiration du TTL même après le
  message "déjà installée et prête". Ajouté `this.autoTtsCache =
  undefined;` dans ce branchement aussi.
- Non corrigées, non bloquantes (notées pour une carte future si
  retenues) : `PIPER_ASSETS.voiceId` et `PIPER_VOICE_ID` sont deux
  constantes séparées avec la même valeur aujourd'hui, sans garantie
  qu'elles ne divergent jamais ; une installation présente mais corrompue
  (fichier tronqué) ne peut plus être réparée depuis l'interface (le
  court-circuit répond "already-installed" indéfiniment, sans contrôle de
  taille/hash).

## Risques et limites

- Aucune commande "Réinstaller/Forcer la réinstallation de Piper" n'existe
  — si l'utilisateur veut un jour réparer une installation corrompue sans
  la supprimer manuellement, ce sera une carte séparée (hors demande
  actuelle).
- La preuve finale de "ça ne boucle plus" reste manuelle de la part de
  l'utilisateur (pas d'outil de clic Wayland sur ce poste) ; la preuve
  automatisée se limite à la logique testée unitairement.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
