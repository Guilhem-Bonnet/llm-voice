# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-images-docke-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Les trois images se construisent en local | résultat | `build-rocm.log`, `build-cuda.log`, `build-models.log` (rc=0), `image-sizes.txt` | prouvé | élevée | utiliser |
| CL-002 | L'image ROCm démarre et synthétise sans aucun réseau | résultat | `container.txt` (network_mode=none, connexion injoignable), `health-after.json`, `figee-image-rocm.wav` | prouvé | élevée | utiliser |
| CL-003 | L'init copie modèles et voix une fois, empreintes vérifiées, voix créées jamais écrasées | résultat | `qwen3-data.log`, `qwen3-data-second-run.log` | prouvé | élevée | utiliser |
| CL-004 | 10 voix servies (1 catalogue + 9 créées) | résultat | `voices.json` | prouvé | élevée | utiliser |
| CL-005 | La phrase française est intelligible | résultat | `wer.json` (WER 0,0, faster-whisper small) | prouvé | élevée | utiliser |
| CL-006 | L'image CUDA fonctionne sur GPU NVIDIA | hypothèse | construction et `import qwen_tts` seulement, aucune carte NVIDIA | non prouvé | faible | signaler |
| CL-007 | Les tailles reflètent l'espace disque réel | hypothèse | `docker image inspect .Size` avec magasin containerd (peut additionner couches compressées et décompressées) | non vérifié | moyenne | signaler |
| CL-008 | Le gate strict est rouge à cause d'un test unitaire hors périmètre | résultat | `test-run.json` : `voiceGallery.behavior.test.ts`, fichiers `vscode-extension/` modifiés non commités, d'une autre session | prouvé | élevée | signaler |
