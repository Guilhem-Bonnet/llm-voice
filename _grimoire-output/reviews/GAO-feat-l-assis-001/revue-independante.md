# Revue indépendante — GAO-feat-l-assis-001

Lecture seule. `npm test:unit` et `grimoire task show` NON exécutés (pas d'outil d'exécution). Tests et fichiers de preuve de la carte non lus.

## Constats

- IMPORTANT — `src/onboarding/handleVoiceTier.ts:88,96-97`. Le choix « piper » est appliqué au profil avant l'installation (`applyProviderChoice` ligne 88), puis `browseVoices()` s'ouvre sans regarder le résultat de `executeCommand(INSTALL_PIPER_VOICE_COMMAND)`. Scénario : l'utilisateur choisit Piper, refuse le téléchargement (`declined`) ou l'installation échoue ; le profil pointe quand même vers Piper non installé et le sélecteur s'ouvre sur ce moteur. La commande ne renvoie pas d'issue exploitable (`Pipeline.ts:1503` utilise `reportPiperInstallOutcome` qui renvoie `void`).
- IMPORTANT — `src/pipeline/Pipeline.ts:1060-1083`. Annulation et erreurs du sélecteur : l'annulation retourne silencieusement (OK), mais si le provider n'a pas de `listVoices` ou liste vide, on affiche un toast et on termine sans voix : l'assistant se conclut sans voix choisie et sans avertissement dans le flux Setup. Cas voisin : pas de rollback du palier appliqué à la ligne 88 si l'utilisateur annule le sélecteur.
- MINEUR — `src/tts/PiperSetup.ts:162-173`. `isPiperAlreadyInstalled` ne teste que `piper` et `<voice>.onnx`, pas le fichier de config `.onnx.json` ni l'exécutabilité. Une installation partielle (config manquante) est déclarée « déjà installée » et ne se répare jamais : l'utilisateur ne peut plus relancer le téléchargement par l'assistant.
- MINEUR — `src/onboarding/SetupVoice.ts:60-63`. `showQuickPick` annulé : retour propre, rien n'est appliqué (correct).

## Boucle d'origine
Fermée côté code lu : `installPiperVoice` renvoie `already-installed` avant tout dialogue ni téléchargement (`PiperSetup.ts:210-213`) et `Pipeline.ts:1529-1540` vide `autoTtsCache` et informe. Je n'ai pas trouvé de chemin qui reproposerait le téléchargement quand les deux fichiers existent. Reste le cas partiel ci-dessus.

## Voix choisie appliquée
`browseVoices` écrit `tts.voice = picked.id` via `profiles.update` puis rafraîchit le badge (`Pipeline.ts:1067-1076`) : appliqué. Non vérifié : que `ttsFor(profile)` à la ligne 1094 reflète bien le provider fraîchement persisté.

## Verdict
NOT READY — non pas pour un bloquant, mais parce que le premier constat IMPORTANT laisse l'assistant dans un état incohérent (Piper sélectionné sans être installé) et que je n'ai pas pu exécuter la suite de tests. À corriger : conditionner `browseVoices` et le maintien du choix à l'issue réelle de l'installation. Réévaluable en READY après correction ou acceptation explicite par le validateur.


## Suites données par le concierge (2026-11-05)

- Taille impaire d'un flux coupé : corrigée, `test/unit/core/wavRepair.test.ts`.
- Installation partielle de Piper : corrigée, `.onnx.json` exigé, `test/unit/tts/PiperSetup.test.ts`.
- « Profil pointant vers Piper non installé » : constat non retenu. `ttsBindingForTier("piper")` vaut `{ providerId: "system" }` (`test/unit/onboarding/handleVoiceTier.test.ts:170`), donc une voix fonctionnelle reste active si l'installation est refusée.
- Limite conservée : un flux coupé proprement par le serveur reste indiscernable d'un flux complet, faute de taille annoncée fiable ; le WAV tronqué reste en cache pour sa clé.
- La revue n'a pas exécuté les tests : rejoués par le concierge, `npm --prefix vscode-extension run test:unit` vert.
