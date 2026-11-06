# Enveloppe de tâche — GAO-audit-ux-com-001

## Objectif

Produire un audit UI/UX complet, honnête et actionnable de toutes les
surfaces visibles de l'extension LLM Voice, à partir du retour direct et
répété d'un utilisateur réel ("je ne comprends rien de ce qui se passe"),
pour servir de base à une refonte priorisée — au lieu de continuer à corriger
des symptômes isolés un par un.

## Déclencheur

Deux correctifs ponctuels déjà faits (GAO-fix-provider-001 : provider Kyutai
absent du sélecteur ; GAO-fix-liste-de-001 : jargon technique visible dans le
panneau Profils) ont chacun résolu un symptôme précis, mais l'utilisateur a
explicitement dit, après les deux : "il manque encore des choses à travailler.
C'est pas bon [...] je veux que toute l'interface soit retravaillée avec un
UI/UX spécialiste."

## Périmètre outillé

Surfaces à auditer (inventaire fait avant dispatch, toutes dans
`vscode-extension/`) :

- `src/views/player/playerHtml.ts` + `media/player/*` — panneau "Lecture en
  cours" (barre latérale).
- `src/views/profiles/profileTreeItems.ts` + `ProfilesTreeProvider.ts` —
  panneau "Profils" (déjà partiellement retravaillé, GAO-fix-liste-de-001 —
  à réévaluer dans son contexte global, pas comme acquis).
- `src/views/profileEditor/profileEditorHtml.ts` + `ProfileEditorPanel.ts` +
  `media/profileEditor/*` — éditeur de profil (webview séparée).
- `src/onboarding/SetupVoice.ts` + `voiceTiers.ts` + `Walkthrough.ts` +
  `UseOwnVoice.ts`/`useOwnVoiceFlow.ts` — assistant d'installation / premiers
  pas.
- `src/ui/StatusBar.ts` + `statusBarText.ts` + `providerStatusText.ts` —
  barre de statut.
- `src/ui/notifications.ts` — messages/toasts.
- `src/ui/CodeLensProvider.ts`, `src/ui/heading.ts` — annotations dans
  l'éditeur de texte lui-même.

## Hors périmètre (pour cette carte)

- Implémenter les corrections : cette carte produit un rapport et des
  recommandations, pas du code. Chaque correction retenue devient sa propre
  carte ensuite.
- Les providers TTS/narrateurs eux-mêmes (ADR-016, ADR-009, etc.) : seule
  leur représentation à l'écran est en jeu ici.

## Critères de sortie

- Rapport déposé dans `docs/ux/audit-2026-11-05.md`, couvrant chaque surface
  listée ci-dessus : ce qui existe, ce qui ne se comprend pas sans connaître
  le code, et une proposition concrète par problème (pas seulement un
  diagnostic).
- Relu par un second agent indépendant (Sentinel, `agent-optimizer`), pas
  l'auteur du rapport.
- Priorisation claire (ce qui bloque la compréhension de base vs. ce qui est
  cosmétique).
