# Enveloppe de tâche — GAO-fix-voix-fra-001

## Objectif

Corriger la voix par défaut de Kyutai Pocket TTS, trouvée fausse en testant
en conditions réelles (serveur `pocket-tts serve --language french`
réellement installé et lancé par l'orchestrateur, à la demande de
l'utilisateur) : `"alba"` est étiquetée anglaise par le README officiel
(`github.com/kyutai-labs/pocket-tts`, liste "Trying it with the CLI"),
`"estelle"` est la seule voix taguée `(fr)` dans cette même liste.

## Périmètre outillé

- `vscode-extension/src/tts/KyutaiPocketProvider.ts` (catalogue de voix),
  `vscode-extension/src/tts/presets.ts` (voix par défaut du preset),
  `vscode-extension/test/unit/tts/presets.test.ts` (assertion à corriger).
- Preuve E2E réelle hors du code TypeScript : serveur Python
  `pocket-tts serve` local, script `scripts/audio-proof/analyze.py`
  (faster-whisper, outillage déjà existant du projet).

## Critères de sortie

- `KYUTAI_POCKET_VOICE_CATALOG` contient `"estelle"` taguée `fr`.
- `KYUTAI_POCKET_LOCAL_PRESET.voice === "estelle"`.
- `npm --prefix vscode-extension run test:unit` vert.
- `grimoire standard gate check --strict` vert.
- Preuve E2E conservée : WAV généré par le vrai serveur avec `voice_url:
  estelle`, transcrit par `analyze.py`, résultat `pass: true`.
