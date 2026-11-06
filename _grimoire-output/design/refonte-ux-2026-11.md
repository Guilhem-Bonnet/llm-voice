# Maquette de la refonte UX — novembre 2026

- **Canvas** : https://claude.ai/artifact/MKLSqQJXmNhPBc2LczJonj (privé), 30 vues, validée par guilhem-bonnet le 2026-11-05 (« oui pour le tout »).
- **Remplace** : la maquette de septembre https://claude.ai/artifact/28tcdY8BgnvMLoFQmSxyVJ, conservée et non modifiée.
- **Audit de départ** : `docs/ux/audit-2026-11-05.md`.

## Décisions portées
- Voix globale séparée du mode de lecture ; le mot « profil » quitte l'interface.
- 20 voix Kyutai retenues ; échantillons compressés inclus dans le VSIX ; écran de crédits.
- Mode Auto et direction de lecture en emplacements réservés ; Documents, Dialogue, tri des réponses et client bureau hors périmètre.

## Vues
Galerie (interactive, états, clair), crédits, Panneau (premier lancement, lecture, préparation, pause, document modifié, sans document, préparation IA, erreur, incidents, situations système, 260 et 500 px, clair), accueil, lecture dans l'éditeur, menus, clic droit et raccourcis, réponses de Claude, préparer une voix, ma voix et ses erreurs, réglages (et clair), modes (liste et édition), diagnostic, services distants, système visuel, emplacements réservés.

## Limites
- Rendu non contrôlé par l'agent : contrôle statique des boutons (nowrap, pas d'étirement) et validation humaine uniquement.
- Contenus d'exemple illustratifs. Glyphes provisoires, à remplacer par des Codicons. Couleurs en valeurs fixes du thème sombre et clair ; le code utilisera `--vscode-*`.
