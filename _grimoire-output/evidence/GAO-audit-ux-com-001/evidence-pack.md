# Evidence pack — GAO-audit-ux-com-001

## Processus

1. Dispatch d'un agent `agent-optimizer` (compétence meta-art-direction) pour
   produire l'audit, sans toucher au code — rapport livré dans
   `docs/ux/audit-2026-11-05.md`, 7 surfaces couvertes (panneau lecture,
   panneau profils, éditeur de profil, assistant d'installation, barre de
   statut, notifications, annotations inline).
2. Dispatch d'un second agent `agent-optimizer` (relecteur indépendant,
   aucun lien avec l'auteur) pour vérifier chaque affirmation du rapport en
   relisant lui-même le code source cité — pas seulement la plausibilité du
   texte.
3. Verdict de la relecture : **accepté avec réserves, aucune bloquante** —
   le diagnostic central est confirmé exact par une seconde lecture
   indépendante du code, avec 4 corrections précises demandées.

## Constat central, confirmé par les deux agents indépendamment

`Pipeline.applyVoiceTierChoice` (`vscode-extension/src/pipeline/Pipeline.ts:1926-1937`)
réécrit le binding `tts` du profil actif mais ne touche jamais son `label`.
Les trois surfaces persistantes de l'extension (`player.js` `#profile`,
`ProfilesTreeProvider`, `StatusBar`/`statusBarText.ts`) n'affichent que ce
`label`, jamais le provider/la voix réellement choisie. Le seul retour
immédiat est un toast `showInformationMessage` transitoire. C'est, de façon
vérifiable dans le code (pas une impression), la cause la plus probable du
"il n'y a rien qui change" rapporté par l'utilisateur.

## Corrections apportées au rapport suite à la relecture Sentinel

1. **Ambiguïté Piper/système** : `ttsBindingForTier` fait pointer "Voix
   système" et "Voix française autonome (Piper)" vers le même
   `providerId: "system"` — une correction qui n'afficherait que ce
   `providerId` ne distinguerait donc toujours pas ces deux choix, alors que
   c'est exactement la comparaison que fait l'utilisateur. Ajouté au rapport
   (section 4, synthèse point 1).
2. **Nuance sur le panneau Profils** : remplacé "aucune surface" par "aucune
   surface visible sans survol" — son tooltip change déjà (paire technique),
   et l'arbre se rafraîchit déjà automatiquement (`extension.ts:168-169`).
3. **Erreur de nom corrigée** : `applyProviderChoice` → `applyVoiceTierChoice` ;
   la proposition "rafraîchir le panneau Profils" nuancée (le rafraîchissement
   existe déjà, la vraie action manquante est d'afficher le provider dans la
   ligne visible, pas de rafraîchir).
4. **Limite ajoutée** : les textes de `voiceTiers.ts` ne couvrent que 3
   niveaux de voix, pas les 5 moteurs de l'éditeur de profil — il faudra
   écrire de nouveaux textes pour Kokoro, Kyutai Pocket TTS et "Compatible
   OpenAI".
5. Points 1 et 3 de la synthèse priorisée fusionnés (même cause racine),
   comme suggéré par le relecteur.

## Ce que l'audit confirme déjà fonctionner (à ne pas refaire)

- Descriptions en clair des 5 profils par défaut + correctif
  `GAO-fix-liste-de-001` (panneau Profils).
- Textes des 3 options de "Choisir une voix" (`voiceTiers.ts`).
- Progression pédagogique des messages d'erreur TTS
  (`chooseTtsUnavailableMessage`).
- CodeLens "▶ Lire cette section" — cité en exemple de clarté.
- "LLM Voice" affiché par défaut dans la barre de statut dès l'activation.

## Limites déclarées (par les deux agents)

- Aucun rendu visuel réel observé dans VS Code — audit fondé sur la lecture
  de code source uniquement.
- `media/profileEditor/profileEditor.js`/`.css`, `UseOwnVoice.ts`,
  `package.json`, `extension.ts` (au-delà de la ligne citée) non lus en
  entier.
- Panneau "Inbox" hors périmètre de cette mission.
- Tests existants référencés mais non exécutés dans le cadre de cet audit.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
