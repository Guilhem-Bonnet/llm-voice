# ADR-008 — Intégration GitHub Copilot Chat : sélection puis participant `@voice`

## Statut

Accepté (2026-09-08). Remplace la version initiale d'ADR-008 (« narrateur
cloud Copilot ») suite à D8.

## Contexte

Le CdC §10.5 (`CopilotSource`) note que Copilot Chat n'expose pas d'accès à
son historique natif. D8 confirme : Copilot est une source de contenu lue
par notre TTS, jamais une voix, et aucun scraping du panneau Copilot Chat
n'est acceptable (CdC §45).

## Décision

- **0.1 — Sélection ou presse-papiers.** L'utilisateur sélectionne la
  réponse Copilot dans le panneau de chat (ou la copie), puis
  `Speak Selection` / `Speak Clipboard` la lit avec le profil courant.
  Aucune intégration API, aucun risque de rupture si l'UI Copilot change.
- **0.2 — Participant `@voice`.** Un chat participant VS Code `@voice` est
  enregistré ; l'utilisateur tape `@voice résume ce que tu viens de faire`
  dans Copilot Chat. La réponse est produite par le modèle Copilot via
  l'API `vscode.lm`, puis **déposée dans l'inbox ouverte** (même protocole
  qu'ADR-007, `provider: "copilot"`) plutôt que lue directement — l'inbox
  reste le point d'entrée unique, zéro autoplay.
- **Pas d'accès à l'historique Copilot natif** : ni en 0.1 ni en 0.2. Le
  participant `@voice` ne lit que ce qu'on lui demande explicitement dans
  son propre tour de conversation, il ne peut pas relire un tour Copilot
  précédent qu'il n'a pas produit lui-même.

## Conséquences

- Le MVP 0.1 ne dépend d'aucune API Copilot instable : `Speak Selection`/
  `Speak Clipboard` existent déjà pour d'autres sources (CdC §10.2/10.3).
  UC-17 (lecture Copilot) passe en P1, cohérent avec cette dépendance 0.2.
- Le participant `@voice` réutilise entièrement le pipeline inbox
  (icône provider, lecture à la demande, aucun autoplay), pas de code de
  lecture spécifique à Copilot.
- Limite assumée et documentée : impossible de lire une réponse Copilot
  déjà affichée avant l'invocation de `@voice` — l'utilisateur doit
  redemander via `@voice` ou utiliser la sélection/presse-papiers.

## Alternatives rejetées

- **Scraper le DOM/état interne du panneau Copilot Chat** : rejeté, aucune
  API publique stable, viole le principe de non-scraping (CdC §45), casse
  à chaque mise à jour de l'extension Copilot.
- **Narrateur cloud dédié à Copilot** (version initiale d'ADR-008) : rejeté
  par la correction D8 — Copilot ne doit jamais devenir une voix, seulement
  une source lue par notre TTS.
- **Lire automatiquement chaque réponse `@voice`** : rejeté, viole
  l'invariant « zéro autoplay » commun à toutes les sources de l'inbox.

## Tests qui prouvent la décision

- Intégration : `Speak Selection` sur un texte copié depuis Copilot Chat →
  lecture correcte avec le profil courant (0.1).
- Intégration : `@voice <prompt>` → appel `vscode.lm` → entrée inbox
  `provider: "copilot"` conforme au schéma ADR-007 → aucune lecture
  automatique déclenchée (0.2).
- Unit : le participant `@voice` ne fait aucun appel réseau hors
  `vscode.lm` (pas de contournement d'`EgressGuard`, cf. ADR-010).
