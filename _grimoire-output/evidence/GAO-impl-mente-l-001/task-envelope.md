# Enveloppe de tâche — GAO-impl-mente-l-001

## Objectif

Implémenter les deux correctifs classés "bloque la compréhension de base"
par l'audit UX (`GAO-audit-ux-com-001`, rapport `docs/ux/audit-2026-11-05.md`,
relu et accepté avec réserves par un second agent indépendant).

## Périmètre outillé

1. **Retour visible persistant du choix de voix** :
   - `vscode-extension/src/profiles/ttsProviderLabel.ts` (nouveau) — fonction
     pure `friendlyTtsProviderLabel`.
   - `vscode-extension/src/pipeline/Pipeline.ts` — nouveau champ
     `currentVoiceLabel`, mis à jour aux 8 sites où `currentProfileLabel`
     l'est déjà, branché dans `statusBarModel()` et `pushPlayerState()`.
   - `vscode-extension/src/core/playback.ts` — nouveau champ `voice` sur
     `PlayerStateView`.
   - `vscode-extension/src/ui/statusBarText.ts` — nouveau champ
     `voiceLabel` sur `StatusBarViewModel`, intégré dans
     `formatStatusBarTooltip`.
   - `vscode-extension/src/views/player/playerHtml.ts` +
     `media/player/player.js` + `.css` — nouveau `#voice` dans le panneau
     lecture.
2. **Éditeur de profil sans jargon brut** :
   - `vscode-extension/src/views/profileEditor/profileEditorHtml.ts` —
     options de `<select>` réécrites en libellés explicatifs, fieldset
     "Narration" renommé, aide + exemple ajoutés sous "Consigne de
     narration", `lang="en"`→`"fr"`, titre traduit.
   - `media/profileEditor/profileEditor.css` — classe `.field-hint`.

## Hors périmètre (déclaré, limitation connue)

- **Ambiguïté Piper/voix système** (relecture Sentinel de l'audit) :
  `"system"` et `"piper"` résolvent au même `providerId`, donc
  `friendlyTtsProviderLabel` ne peut pas les distinguer de façon
  synchrone — reste labellisé "Voix système" pour les deux. Résoudre ça
  demanderait de câbler `SystemTtsProvider.detectEngine()` (async) jusqu'aux
  3 surfaces persistantes — carte séparée si retenue.
- Les points classés "gênant mais contournable" / "cosmétique" de l'audit
  (traductions anglais/français restantes, icônes du panneau Profils,
  sous-textes des boutons du player) — non traités ici.

## Critères de sortie

- `npm --prefix vscode-extension run test:unit` vert.
- `grimoire standard gate check --strict` vert.
- Correctif réellement packagé et réinstallé, vérifié sur le build
  effectivement présent dans VS Code (même méthode que les cartes
  précédentes).
