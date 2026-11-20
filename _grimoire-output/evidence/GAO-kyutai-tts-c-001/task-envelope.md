# Enveloppe de tâche — GAO-kyutai-tts-c-001

## Objectif

Produire `docs/adr/ADR-016-kyutai-tts-provider.md` (statut Proposé), relu par
un vérificateur indépendant, décrivant l'ajout de Kyutai TTS (Pocket TTS /
TTS 1.6B) comme palier TTS supplémentaire derrière l'interface provider
existante (ADR-005/ADR-009), avec vérification préalable : support français
réel, licence des modèles, taille/VRAM, et solution au problème d'accent
anglophone déjà loggé (Chatterbox) via le clonage vocal + word-timing natif
de Kyutai.

## Périmètre outillé

- Autorisé : lecture de `docs/adr/*`, `_grimoire/_memory/shared-context.md`,
  `vscode-extension/src/tts/**` (lecture seule pour ce tour) ; recherche web
  sur licences/specs Hugging Face Kyutai ; écriture de `docs/adr/ADR-016-*.md`
  et des artefacts de preuve sous `_grimoire-output/evidence/GAO-kyutai-tts-c-001/`.
- Exclu : implémentation du provider TypeScript (hors périmètre de cette
  carte — carte de suivi séparée si l'ADR est accepté) ; modification de
  Gradium ou tout ajout de dépendance cloud par défaut (invariant P0-2).

## Critères de sortie

- `docs/adr/ADR-016-kyutai-tts-provider.md` existe, statut Proposé, et cite
  des sources vérifiées (licence, support FR, tailles modèles).
- Relecture indépendante (agent-optimizer / Sentinel) sans point bloquant,
  consignée dans l'evidence-pack.
- `grimoire standard gate check --task-id GAO-kyutai-tts-c-001 --strict` vert.
