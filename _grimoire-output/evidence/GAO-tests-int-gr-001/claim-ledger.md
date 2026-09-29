# Agentic Claim Ledger

- Task id: GAO-tests-int-gr-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Extension entière (VS Code xvfb, engine native, vrai Core, Piper) joue le Markdown de 3 phrases et le banc le transcrit (WER 0,1364, non silencieux) | résultat | `run-green.json`, `native-real.sh` exit 0 | prouvé | élevée | utiliser |
| CL-002 | Le test aurait attrapé le bogue `segmentId "session-4:0"` : sans `encodeSegmentId`, test rouge (`enqueue refused (invalid_request)`), banc `silent: true`, script exit 1 | résultat | `run-counterproof.json`, sortie mocha (evidence-pack) | prouvé | élevée | utiliser |
| CL-003 | `NativeAudioSink.ts` restauré (aucune trace de la contre-preuve) | résultat | `git diff` vide sur le fichier ; build refait | prouvé | élevée | utiliser |
| CL-004 | La suite est sautée sans `LLM_VOICE_NATIVE_REAL=1` (CI sans audio verte) | affirmation de conception | `(enabled ? suite : suite.skip)` ; `LLM_VOICE_NATIVE_REAL= npx vscode-test --label native-real` → `0 passing, 1 pending` | prouvé | élevée | utiliser |
| CL-005 | Les segments « terminés » sont prouvés par l'état final `completed` et l'index de chunk, pas par les événements Core | limite | test | prouvé comme limite | moyenne | accepter |
| CL-006 | Reproductibilité hors cette machine (Fedora/PipeWire, Piper dans `~/.llm-voice/voices`) | hypothèse | — | non vérifié | faible | vérifier ailleurs |

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | aucune |
| Contradictions détectées | 1re contre-preuve rouge seulement par délai ; corrigé (échec rapide sur le journal) |
| Hypothèses acceptées | CL-006 |
