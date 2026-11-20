# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-adr-015-dire-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | L'architecture en cinq rôles a été acceptée par guilhem-bonnet le 2026-09-29 | décision | brief de dispatch du concierge (pas d'entrée `decisions-log.md` lue) | hypothèse | moyenne | utiliser ; à journaliser par le concierge |
| CL-002 | Le contrat du narrateur est `{segments:[{sourceIds, spokenText}]}` | fait | `vscode-extension/src/narrator/narrationContract.ts` l. 10-30 | prouvé | élevée | utiliser |
| CL-003 | `NarrationSegment` porte un champ libre `metadata` | fait | `src/core/narration.ts` l. 13-20 | prouvé | élevée | utiliser |
| CL-004 | `ChatterboxProvider` déclare `exaggeration` 0–2 (0,5), `cfg_weight` 0–1 (0,5), `temperature` 0,05–2 (0,8), aucun paramètre de vitesse | fait | `src/tts/ChatterboxProvider.ts` l. 60-94 | prouvé | élevée | utiliser |
| CL-005 | Une instance `ChatterboxProvider` par tuple `providerId/baseUrl/referenceAudio` (registre `Pipeline.ttsFor`) | fait | en-tête de `ChatterboxProvider.ts` l. 32-35 ; `Pipeline.ts` non lu | prouvé (par le commentaire) | moyenne | utiliser ; à confirmer dans `Pipeline.ts` à l'étape 2 |
| CL-006 | `SystemTtsProvider` n'expose que `speed` 0,5–2 | fait | `src/tts/SystemTtsProvider.ts` l. 178-189 | prouvé | élevée | utiliser |
| CL-007 | Le Core v1 `enqueue` n'a ni silence, ni fondu, ni coupe | fait | `contracts/core-v1/http/enqueue.request.schema.json` (`additionalProperties: false`) | prouvé | élevée | utiliser |
| CL-008 | Le cache audio ne doit contenir que de l'audio ; SQLite rejeté | fait | ADR-004 §2 et alternatives | prouvé | élevée | utiliser |
| CL-009 | 0 JSON invalide sur 144 appels du narrateur avec `format` | résultat | `GAO-valuation-f-001/evidence-pack.md` l. 30 | prouvé | élevée | utiliser |
| CL-010 | Négations 55–89 % au départ, 80,6–97,2 % avec styles-v2, un passage | résultat | `GAO-valuation-f-001/evidence-pack.md` l. 21-37, 62-77 | prouvé (bruit d'un passage) | moyenne | utiliser comme motivation du contrôleur |
| CL-011 | SemIf `qwen2.5:7b` enrichi : 75 % (38/51), p50 256 ms, étiquettes non validées | résultat | `GAO-valuation-m-001/evidence-pack.md` l. 3-7, 44 | prouvé (réserve étiquettes) | moyenne | utiliser pour le choix de voix, avec la réserve |
| CL-012 | Narrateur `qwen2.5:7b` p50 3,6–4,9 s par texte | résultat | `GAO-valuation-f-001/evidence-pack.md` l. 69-71 | prouvé | moyenne | utiliser pour l'ordre de grandeur du premier son |
| CL-013 | Latence du metteur en scène, cohabitation VRAM Ollama + Chatterbox, `num_ctx` de `qwen2.5:7b` | hypothèse | aucune mesure | hypothèse | faible | vérifier à l'étape 5 |
| CL-014 | Qwen3-TTS : texte libre (VoiceDesign, CustomVoice), FR officiel, code Apache-2.0 ; poids Apache-2.0 selon des tiers ; ROCm non documenté | fait (veille) | `moteurs-expressifs.md` l. 9 | prouvé pour la veille, non revérifié | moyenne | vérifier au banc 1 bis et sur la carte HF |
| CL-015 | Fish S2 Pro sous Fish Audio Research License (code et poids) | fait (veille) | `moteurs-expressifs.md` l. 10 | prouvé pour la veille | moyenne | licence à trancher avant tout usage produit |
| CL-016 | Pocket TTS : FR officiel, CPU temps réel annoncé, aucun contrôle de style | fait (veille) | `moteurs-expressifs.md` l. 12 | prouvé pour la veille ; latence = chiffre éditeur | moyenne | vérifier au banc |
| CL-017 | Chatterbox Multilingual jette les balises ; Turbo anglais seulement | fait (veille) | `moteurs-expressifs.md` l. 14-15 (sources tierces) | hypothèse | moyenne | vérifier au banc |
| CL-018 | Une licence de corpus ne vaut pas consentement au clonage ; droit à la voix français non vérifié | fait (veille) + hypothèse juridique | `voix-de-reference.md` l. 3, 27 | hypothèse juridique | moyenne | validation juridique avant distribution publique |
| CL-019 | Voix Kyutai données CC0 : 228 voix vérifiées ; langues précises non vérifiées | fait (veille) | `voix-de-reference.md` l. 15 | prouvé pour la veille | moyenne | vérifier à l'étape 1 ter |
| CL-020 | SSML : `break`, `prosody`, `emphasis` ; BookNLP pour l'attribution | hypothèse | connaissance générale, aucun accès web | hypothèse | moyenne | non porteur ; ne change pas la décision |
| CL-021 | Valeurs K/W/L/N, budget 1,5 s, ratio 2×, tolérance 40 ms, A/B 7/10 | hypothèse | propositions de l'auteur | hypothèse | faible | étalonner aux étapes 5, 6, 8 |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`,
`hypothèse`, `contredit`. Confiance : `faible`, `moyenne`, `élevée`. Décision :
`utiliser`, `vérifier`, `rejeter`.

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | aucune pour un ADR au statut Proposé ; CL-001 doit être journalisée dans `decisions-log.md` |
| Contradictions détectées | aucune ; écart mineur : `exaggeration` 0–2 déclaré par le provider contre 0,25–2,0 selon la veille (repris tel quel dans l'ADR) |
| Hypothèses acceptées temporairement | CL-013, CL-017, CL-018, CL-020, CL-021 |
| Preuves à obtenir avant livraison du code | validation de l'ADR par guilhem-bonnet ; banc moteurs 1 bis ; mesures de latence (étape 5) ; étalonnage du banc de direction (étape 6) |
