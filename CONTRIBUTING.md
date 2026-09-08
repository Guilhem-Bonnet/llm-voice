# Contribuer à LLM Voice

Merci de votre intérêt pour ce projet. Ce dépôt en est au stade précoce
(phase 1 du plan maître) : l'architecture n'est pas encore stabilisée.

## Avant de contribuer

1. Consultez [`cahier-des-charges.md`](./cahier-des-charges.md) et
   `_grimoire-output/planning-artifacts/` pour comprendre le périmètre et les
   décisions déjà prises.
2. Ouvrez une issue avant toute contribution non triviale, pour éviter le
   travail en double.

## Environnement de développement

- Node.js 22 (voir `.nvmrc`)
- `npm install --prefix vscode-extension`
- `npm run lint --prefix vscode-extension`
- `npm run typecheck --prefix vscode-extension`
- `npm run test:unit --prefix vscode-extension`
- `npm run test:integration --prefix vscode-extension` (nécessite un serveur
  d'affichage ; `xvfb-run -a` sur Linux headless)

## Convention de commit

[Conventional Commits](https://www.conventionalcommits.org/) : `feat:`,
`fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`.

## Pull requests

- Une PR = un sujet.
- Tests unitaires pour tout changement de comportement dans
  `vscode-extension/src/`.
- La CI (lint, typecheck, tests, packaging) doit être verte.
- `main` est protégée : au moins une revue approuvée est requise.

## Code de conduite

Ce projet applique le [Contributor Covenant](./CODE_OF_CONDUCT.md).
