# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-kyutai-tts-c-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Pocket TTS supporte nativement le français | fait | README `github.com/kyutai-labs/pocket-tts` + model card HF, lus le 2026-11-05 (citation exacte dans evidence-pack #4) | prouvé | élevée | utiliser |
| CL-002 | Pocket TTS permet le clonage vocal à partir d'un wav arbitraire fourni par l'utilisateur | fait | idem, citation exacte « L'argument `--voice` peut aussi prendre un fichier wav... » | prouvé | élevée | utiliser |
| CL-003 | Kyutai TTS 1.6B (`kyutai/tts-1.6b-en_fr`) ne permet pas le clonage libre (embeddings pré-calculés seulement) | fait | model card HF, lue le 2026-11-05 (citation exacte dans evidence-pack #3) | prouvé | élevée | utiliser |
| CL-004 | Ni Pocket TTS ni TTS 1.6B ne produisent d'horodatage par mot en sortie, officiellement | fait | model card HF (1.6B) + README Pocket TTS, lus le 2026-11-05 | prouvé | élevée | utiliser |
| CL-005 | Poids CC-BY-4.0 et code MIT/Apache pour les deux modèles | fait | model cards HF + README officiels | prouvé | élevée | utiliser |
| CL-006 | VRAM minimale requise par TTS 1.6B en inférence | hypothèse | aucune donnée officielle Kyutai ; signal faible non officiel (guide Libre WebUI, non retenu comme source d'autorité) | non vérifié | faible | vérifier (V4, mesure locale avant d'activer `kyutai-dsm`) |
| CL-007 | Chemin ROCm/AMD RDNA4 pour le serveur TTS 1.6B | hypothèse | aucune mention dans README/model card officiels | non vérifié | faible | vérifier (V6, risque R3) |
| CL-008 | Protocole réseau exact du serveur TTS 1.6B (WebSocket ou autre) | hypothèse | README `delayed-streams-modeling` ne détaille pas le protocole | non vérifié | faible | vérifier (V7, risque R8) |
| CL-009 | Licences par voix du catalogue `kyutai/tts-voices` : CC-BY-NC (Expresso, EARS), CC-BY-4.0 (VCTK, CML-TTS FR), CC0 (dons Unmute) | fait | `huggingface.co/kyutai/tts-voices` + Terms of Use Unmute, lus le 2026-11-05 (confirme S3 sans écart) | prouvé | élevée | utiliser |
| CL-010 | sherpa-onnx expose le clonage vocal de Pocket TTS via `referenceAudio` | fait | doc officielle sherpa-onnx `tts_pocket.html`, lue le 2026-11-05 | prouvé | élevée | utiliser |
| CL-011 | Le paquet sherpa-onnx packagé de Pocket TTS supporte le français | hypothèse | aucune langue documentée sur le paquet ; seule démo publique liée étiquetée « English » | non vérifié | faible | vérifier (V5 complémentaire, risque R9) avant d'écrire le `CoreTtsProvider` |

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | Aucune pour le statut Proposé : CL-006/007/008 ne bloquent que l'implémentation de `kyutai-dsm`, pas la proposition d'architecture. |
| Contradictions détectées | Une, résolue : l'hypothèse initiale de la carte (clonage + word-timing sur un même modèle) est infirmée par CL-003/CL-004 ; l'ADR a été corrigé en conséquence le 2026-11-05. |
| Hypothèses acceptées temporairement | CL-006, CL-007, CL-008 — chacune a une conduite de vérification assignée (V4, V6, V7) avant toute carte d'implémentation. |
| Preuves à obtenir avant livraison | Licences voix une à une (`kyutai/tts-voices`), accès gated à Pocket TTS, support sherpa-onnx (V2 résiduel, V5) — avant code, pas avant acceptation de l'ADR. |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`,
`hypothèse` (ou `non vérifié`, son synonyme), `contredit`, `réfuté`. Confiance :
`faible`, `moyenne`, `élevée`. Décision : `utiliser`, `vérifier`, `rejeter`,
`écarter`. Une précision entre parenthèses ou après `;` est tolérée
(`prouvé (par lecture)`) ; une barre dans une cellule s'écrit `\|`.

## Preuve minimale par type d'affirmation

| Type | Preuve minimale |
|---|---|
| Fichier ou code | chemin lu, diff ou extrait |
| Test | commande et résultat |
| API ou norme | contrat, documentation officielle ou code |
| Design | charte, design system, maquette ou validation |
| Sécurité | scan, règle, revue ou threat model |
| Mémoire | source originale, date, score, portée |
| Décision client | validation explicite ou ticket |

