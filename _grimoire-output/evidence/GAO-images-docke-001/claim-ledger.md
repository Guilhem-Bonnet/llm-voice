# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-images-docke-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Les trois images se construisent en local | résultat | _grimoire-output/evidence/GAO-images-docke-001/build-rocm.log, _grimoire-output/evidence/GAO-images-docke-001/build-cuda.log, _grimoire-output/evidence/GAO-images-docke-001/build-models.log (rc=0), _grimoire-output/evidence/GAO-images-docke-001/image-sizes.txt | prouvé | élevée | utiliser |
| CL-002 | L'image ROCm démarre et synthétise sans aucun réseau | résultat | _grimoire-output/evidence/GAO-images-docke-001/container.txt (network_mode=none, connexion injoignable), _grimoire-output/evidence/GAO-images-docke-001/health-after.json, _grimoire-output/evidence/GAO-images-docke-001/figee-image-rocm.wav | prouvé | élevée | utiliser |
| CL-003 | L'init copie modèles et voix une fois, empreintes vérifiées, voix créées jamais écrasées | résultat | _grimoire-output/evidence/GAO-images-docke-001/qwen3-data.log, _grimoire-output/evidence/GAO-images-docke-001/qwen3-data-second-run.log | prouvé | élevée | utiliser |
| CL-004 | 10 voix servies (1 catalogue + 9 créées) | résultat | _grimoire-output/evidence/GAO-images-docke-001/voices.json | prouvé | élevée | utiliser |
| CL-005 | La phrase française est intelligible | résultat | _grimoire-output/evidence/GAO-images-docke-001/wer.json (WER 0,0, faster-whisper small) | prouvé | élevée | utiliser |
| CL-006 | L'image CUDA fonctionne sur GPU NVIDIA | hypothèse | construction et `import qwen_tts` seulement, aucune carte NVIDIA | hypothèse | faible | vérifier |
| CL-007 | Les tailles reflètent l'espace disque réel | hypothèse | `docker image inspect .Size` avec magasin containerd (peut additionner couches compressées et décompressées) | non vérifié | moyenne | vérifier |
| CL-008 | Un premier gate strict a été rouge à cause d'un test unitaire hors périmètre, vert au run suivant | résultat | _grimoire-output/evidence/GAO-images-docke-001/test-run.json , vscode-extension/test/unit/views/voiceGallery.behavior.test.ts (modifié, non commité, autre session) | prouvé | élevée | vérifier |
