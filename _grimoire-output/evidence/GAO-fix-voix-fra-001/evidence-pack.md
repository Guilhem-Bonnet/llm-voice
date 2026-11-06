# Evidence pack — GAO-fix-voix-fra-001

## Origine du correctif

En réponse à la question de l'utilisateur « on peut testé ? on peut choisir
des voix ? », vérification de la voix par défaut livrée (`"alba"`) contre le
README officiel `github.com/kyutai-labs/pocket-tts` ("Trying it with the CLI") :
`alba` y est taguée anglaise, `estelle` est la seule voix taguée `(fr)`.
Confirmé par agent `web-fetch` (lecture directe du README + du dépôt
`kyutai/tts-voices`, 2026-11-05) : `estelle` → fichier `developpeuse-3.wav`,
dossier `unmute-prod-website`.

## Diff

- `vscode-extension/src/tts/KyutaiPocketProvider.ts` :
  `KYUTAI_POCKET_VOICE_CATALOG` passe d'une seule entrée `"alba"` à deux
  entrées, `"estelle"` (fr, en premier, celle utilisée par défaut dans le
  preset) et `"alba"` (en, conservée comme alternative documentée).
- `vscode-extension/src/tts/presets.ts` : `KYUTAI_POCKET_LOCAL_PRESET.voice`
  passe de `"alba"` à `"estelle"`, commentaire mis à jour pour expliquer le
  pourquoi (pas juste le quoi).
- `vscode-extension/test/unit/tts/presets.test.ts` ligne 77 : assertion
  `toBe("alba")` → `toBe("estelle")`.

## Preuve E2E réelle (pas seulement du code relu)

1. `uv tool install pocket-tts` → `pocket-tts==4.0.1` installé.
2. `pocket-tts serve --language french` lancé en local (`127.0.0.1:8000`),
   confirmé vivant : `curl http://localhost:8000/health` → `{"status":"healthy"}`.
3. Synthèse réelle :
   ```
   curl -X POST http://localhost:8000/tts \
     -F "text=Bonjour, je suis Estelle, une voix de synthèse française." \
     -F "voice_url=estelle" -o estelle-test.wav
   ```
   → HTTP 200, `estelle-test.wav` (137 Ko, RIFF/WAVE PCM 16 bit mono 24000 Hz,
   confirmé par `file`). Conservé dans ce dossier de preuve.
4. Transcription automatique (pas d'écoute humaine comme seule preuve,
   convention du projet — `_grimoire/_memory/feedback-tests-autonomes-claude.md`) :
   ```
   ~/.llm-voice/tools/audio-proof-venv/bin/python scripts/audio-proof/analyze.py \
     --audio estelle-test.wav \
     --expect "Bonjour, je suis Estelle, une voix de synthèse française."
   ```
   → `{"wer": 0.1111, "transcription": "Bonjour, je suis Estelle, une voix de
   santé française.", "silence_max_ms": 620.0, "rms": 0.068176, "silent":
   false, "wer_ok": true, "pass": true}`. Un mot sur dix diffère ("santé" pour
   "synthèse", confusion phonétique plausible pour un modèle TTS court) —
   largement sous le seuil de 0.25. **La synthèse française fonctionne
   réellement avec la voix "estelle".**

   Note technique sans impact sur le code livré : le champ `duration_s` du
   script (41666.667) est manifestement faux pour un clip de quelques
   secondes — probable artefact du WAV streamé en chunked sans taille de
   data connue à l'avance côté serveur (déjà documenté comme tel dans
   ADR-016 §2 et le contrat de `KyutaiPocketProvider`, qui ne lit jamais ce
   champ et ne calcule pas `durationMs`). N'affecte ni le provider ni ce
   correctif ; à garder en tête si un futur usage lit cette taille de
   header directement.

## Résultat des vérifications

```
cd vscode-extension
npx tsc -p ./ --noEmit        → No errors found
npx eslint src/tts/KyutaiPocketProvider.ts src/tts/presets.ts \
  test/unit/tts/presets.test.ts --max-warnings=0  → No issues found
npm run test:unit             → Test Files 108 passed (108) / Tests 1869 passed (1869)
```

## Risques et limites

- Le serveur `pocket-tts serve` reste lancé en arrière-plan sur la machine de
  dev pour permettre d'autres tests manuels de l'utilisateur dans
  l'extension elle-même ; à arrêter quand l'utilisateur n'en a plus besoin
  (`pkill -f "pocket-tts serve"`).
- Catalogue de voix toujours minimal (2 entrées) : le travail complet
  (toutes les voix, licences une à une, fichier d'attribution) reste la
  carte séparée qu'ADR-016 §4 appelle déjà.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
