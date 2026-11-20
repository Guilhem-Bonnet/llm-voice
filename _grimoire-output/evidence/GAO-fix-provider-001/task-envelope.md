# Enveloppe de tâche — GAO-fix-provider-001

## Objectif

Rendre `kyutai-pocket` réellement sélectionnable depuis l'interface de
l'extension : après rebuild + réinstallation (GAO-fix-voix-fra-001), l'éditeur
de profil ne propose toujours pas ce provider dans son menu déroulant, et son
bouton « Parcourir les voix » serait de toute façon inopérant pour lui.

## Périmètre outillé

- `vscode-extension/src/views/profileEditor/profileEditorHtml.ts` (ajout de
  l'option `kyutai-pocket` au `<select id="field-tts-provider">`).
- `vscode-extension/src/tts/KyutaiPocketProvider.ts` (ajout de `listVoices()`,
  catalogue statique local, aucun appel réseau — cohérent avec
  `getCapabilities()` qui renvoie déjà ce même catalogue sans appeler le
  serveur).
- Tests unitaires associés
  (`vscode-extension/test/unit/tts/KyutaiPocketProvider.test.ts`,
  éventuellement `profileEditorHtml`/`ProfileEditorPanel` si testés).

## Hors périmètre

- Catalogue complet des voix (ADR-016 §4, carte séparée déjà annoncée).
- Provider `kyutai-dsm` (TTS 1.6B GPU), non implémenté.
- L'assistant d'onboarding simplifié (`SetupVoice.ts`) : ses 3 options sont un
  choix délibéré de simplicité pour un nouvel utilisateur, pas un oubli — ADR-
  016 qualifie Kyutai de palier avancé optionnel, atteint via l'éditeur de
  profil, pas l'onboarding initial.

## Critères de sortie

- `kyutai-pocket` apparaît comme option dans le `<select>` de l'éditeur de
  profil.
- `KyutaiPocketProvider.listVoices()` existe, retourne
  `KYUTAI_POCKET_VOICE_CATALOG` sans appel réseau (vérifiable par un test qui
  n'intercepte aucun `fetch`).
- `npm --prefix vscode-extension run test:unit` vert.
- `grimoire standard gate check --strict` vert.
