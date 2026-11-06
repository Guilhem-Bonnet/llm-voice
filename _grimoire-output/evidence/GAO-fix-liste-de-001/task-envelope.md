# Enveloppe de tâche — GAO-fix-liste-de-001

## Objectif

Rendre le panneau "Profils" compréhensible pour un utilisateur réel, sans
jargon technique visible par défaut.

## Périmètre outillé

- `vscode-extension/src/views/profiles/profileTreeItems.ts` (construction des
  lignes du Tree View "Profils").
- `vscode-extension/test/unit/views/profiles/profileTreeItems.test.ts`.

## Hors périmètre

- `src/profiles/profileQuickPick.ts` (le Quick Pick de changement rapide de
  profil, surface différente, garde pour l'instant la paire technique
  "narrateur · voix" — amélioration possible, pas demandée ici).
- Ajout d'un profil Kyutai par défaut (décision de migration séparée, pas
  tranchée ici).
- Les 3 boutons "Choisir une voix" (assistant d'onboarding) : vérifiés
  fonctionnels par lecture de code et tests existants
  (`test/unit/onboarding/voiceTiers.test.ts`,
  `test/unit/onboarding/handleVoiceTier.test.ts`), non modifiés.

## Critères de sortie

- La ligne visible de chaque profil par défaut dans le panneau "Profils"
  affiche sa description en français clair (`profile.description`), pas la
  paire technique provider/narrateur.
- Un profil sans description humaine (ex. créé/édité à la main) retombe sur
  l'ancien format technique, inchangé.
- `npm --prefix vscode-extension run test:unit` vert.
- `grimoire standard gate check --strict` vert.
