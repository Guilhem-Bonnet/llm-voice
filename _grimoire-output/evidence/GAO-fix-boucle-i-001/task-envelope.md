# Enveloppe de tâche — GAO-fix-boucle-i-001

## Objectif

Faire en sorte qu'une fois la voix Piper installée, re-choisir "Voix
française autonome" dans l'assistant ne déclenche plus un nouveau
téléchargement complet — reconnaître l'installation déjà présente.

## Origine

Utilisateur, en testant réellement l'assistant "Choisir une voix" : "il me
propose juste de télécharger quelque chose. Une fois téléchargé, en
recliquant à nouveau, il me refait télécharger la même chose en boucle. Je
n'ai aucun moyen de réellement choisir une voix via l'interface
actuellement."

Lecture du code : `installPiperVoice` (`src/tts/PiperSetup.ts`) n'avait
aucune vérification "déjà installé" — contrairement à
`SystemTtsProvider.detectManagedPiper()`, qui vérifie déjà
`bin/piper`+`voices/<voiceId>.onnx` pour détecter une installation gérée
existante, mais ce code n'est jamais consulté par le flux d'installation
lui-même.

## Périmètre outillé

- `vscode-extension/src/tts/PiperSetup.ts` : nouvelle fonction exportée
  `isPiperAlreadyInstalled()` (même vérification de fichiers que
  `detectManagedPiper`) ; nouveau statut `"already-installed"` sur
  `PiperInstallOutcome` ; court-circuit en tête d'`installPiperVoice()`,
  avant tout dialogue de consentement ou appel réseau.
- `vscode-extension/src/pipeline/Pipeline.ts`,
  `reportPiperInstallOutcome()` : nouveau message pour ce statut.
- `vscode-extension/src/tts/AutoVoiceInstall.ts` : `nextActionFor` et
  `fallbackMessageFor` mis à jour pour le nouveau statut (switches
  exhaustifs, TypeScript force la mise à jour).

## Hors périmètre

- Aucune commande "Réinstaller Piper" explicite n'est ajoutée (si
  l'utilisateur veut un jour forcer une réinstallation, ce sera une
  décision séparée).
- L'ambiguïté Piper/voix système dans l'indicateur de voix (toujours non
  résolue, cf. GAO-impl-mente-l-001) — sans lien avec ce bug.

## Critères de sortie

- `npm --prefix vscode-extension run test:unit` vert, avec des tests
  couvrant explicitement le court-circuit "déjà installé" (sans prompt, sans
  téléchargement) et sa non-déclenchement pour une installation
  partielle/corrompue.
- `grimoire standard gate check --strict` vert.
- Correctif réellement packagé et réinstallé, vérifié sur le build présent
  dans VS Code.
