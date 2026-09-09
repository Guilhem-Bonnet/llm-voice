# Documentation — LLM Voice

Index complet de la documentation du projet.

## Pour commencer

- **[user-guide.md](user-guide.md)** — Guide utilisateur complet : installation, premiers pas, profils, dépannage, mode local, raccourcis.
- **[install-linux.md](install-linux.md)** — Instructions d'installation Linux détaillées : VS Code (RPM/Flatpak/Snap), Ollama, Chatterbox (CUDA/ROCm/CPU).
- **[providers.md](providers.md)** — Guide des providers TTS et Narrator : contrats d'interface, presets, sélection du provider adapté.
- **[privacy.md](privacy.md)** — Politique de confidentialité : données locales, transmission distante, télémétrie (désactivée par défaut).

## Conception et architecture

- **[adr/README.md](adr/README.md)** — Index des 11 Architectural Decision Records (ADRs).
  - ADR-001 : Architecture générale
  - ADR-002 : Parsing Markdown
  - ADR-003 : Segmentation
  - ADR-004 : Cache audio LRU
  - ADR-005 : Narrator structured output
  - ... (voir adr/README.md)
- **[security/local-mode.md](security/local-mode.md)** — Mode local technique : EgressGuard, vérification stricte localhost, DNS rebinding resistance.

## Traçabilité et sécurité

- **[traceability.md](traceability.md)** — Matrice de traçabilité AC-01..17 (critères d'acceptation MVP) et AC-SEC-01..10 (critères sécurité) vers fichiers de test.
- **Security Review** — Voir `_grimoire-output/planning-artifacts/security-privacy-review-v1.md` pour l'analyse STRIDE complète (findings F-01..12 et contrôles).

## État du projet

- **[../cahier-des-charges.md](../cahier-des-charges.md)** — Cahier des charges fonctionnel complet : vision, cas d'usage, spécifications, phases.
- **[../CHANGELOG.md](../CHANGELOG.md)** — Historique des versions et phases (0.1.0 complet).
- **[../README.md](../README.md)** — Page d'accueil du projet.

## Développement

- **Testing** : voir `vscode-extension/docs/testing.md` (FakeTtsProvider, FakeAudioSink, fixtures).
- **Structure du repo** :
  ```
  vscode-extension/      # Extension VS Code (TypeScript)
  docs/                  # Cette documentation
  .github/workflows/     # CI (lint, tests, package)
  cahier-des-charges.md  # Specs fonctionnelles
  CHANGELOG.md           # Versions
  ```

---

**Version** : 0.1.0  
**Plateforme** : Linux (validée) • Windows/macOS (CI, validation manuelle requise)  
**Licence** : MIT
