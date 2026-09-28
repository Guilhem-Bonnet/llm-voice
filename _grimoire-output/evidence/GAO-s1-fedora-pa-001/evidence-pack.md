
## Vérification concierge (2026-09-28)

| Vérification | Commande | Résultat |
|---|---|---|
| Packaging | `npm --prefix vscode-extension run package:linux-x64` | VSIX `llm-voice-linux-x64.vsix`, 1 435 819 octets |
| Contenu | `check-vsix.mjs --target linux-x64` | 23 fichiers (~4,38 Mio non compressés), aucun code de test, source, map ou secret ; `extension/bin/linux-x64/llm-voice-core` présent (2 959 616 octets) |
| Démarrage | `bash scripts/smoke-core-vsix.sh vscode-extension/llm-voice-linux-x64.vsix` | exit 0 — binaire extrait lancé, `/health` avec jeton, `protocolVersion=1.0`, arrêt propre |
| Hygiène git | `git check-ignore` | `vscode-extension/bin/` et le VSIX ignorés |
| CI | job `package-linux-x64` ajouté à `.github/workflows/ci.yml` (+32 lignes) | **en attente** : non prouvable sans push (approbation utilisateur requise) |

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
