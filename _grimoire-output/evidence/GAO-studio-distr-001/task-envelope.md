# Task envelope — GAO-studio-distr-001

Studio > Distribution : panneau webview listant tous les personnages (ligne Narrateur + une par personnage), écoute d'une vraie réplique, changement de voix via `recordUserVoice`, création de voix Qwen3 (`POST /voices/create`), Lire / Refaire la distribution.

- Décisions : ADR-018 §3/§7 (étape 5), decisions-log 2026-11-07 « Distribution… ».
- Contrat serveur Qwen3 (livré ailleurs, `deploy/qwen3/` non touché) : `GET /voices` (origin catalogue|created), `POST /voices/create`, `GET /voices/<id>/sample`.
- Interdits : aucun son, aucun téléchargement, pas de push, pas de `global-voice.json` utilisateur, pas de `deploy/qwen3/`.
- Critère : typecheck, lint, test:unit, build, fake-tts, integration-security, test:integration-voice verts ; test d'intégration du panneau sur 07-theatre-noms-seuls.md ; captures 500/900 px.
