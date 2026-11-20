# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-fix-voix-fra-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | "alba" est une voix anglaise, "estelle" est la seule voix taguée (fr), dans le catalogue officiel Kyutai Pocket TTS | fait | README `github.com/kyutai-labs/pocket-tts`, section "Trying it with the CLI" (agent `web-fetch`, lecture directe, 2026-11-05) ; non recoupé une seconde fois par l'orchestrateur lui-même | prouvé (par lecture d'un agent dédié) | élevée | utiliser |
| CL-002 | La synthèse réelle du serveur `pocket-tts serve --language french` avec `voice_url=estelle` produit du français intelligible | résultat | `estelle-test.wav` (136.9K, RIFF/WAVE PCM 16bit/24kHz, confirmé indépendamment par l'orchestrateur : `ls -la` + `file`) transcrit par `scripts/audio-proof/analyze.py` (faster-whisper) → `{"wer":0.1111,"pass":true}`, sous le seuil 0.25 documenté dans `scripts/audio-proof/README.md` | prouvé | élevée | utiliser |
| CL-003 | Le correctif (`"alba"`→`"estelle"`) ne casse aucune autre voie du code (`chatterbox`, `kokoro`, `system`, `openai-compatible`) | résultat | `npx tsc -p ./ --noEmit` → No errors ; `npx eslint ... --max-warnings=0` → No issues ; `npm run test:unit` → 108/108 fichiers, 1869/1869 tests, ré-exécuté indépendamment par l'orchestrateur après la relecture Sentinel | prouvé | élevée | utiliser |
| CL-004 | `createTtsProvider` ne lit jamais `preset.voice` pour `kind: "kyutai-pocket"` — seul `options.defaultVoice` explicite compte, donc ce changement de preset est documentaire, sans effet runtime direct sur la construction du provider | fait | lecture de `presets.ts` (Sentinel, confirmée par la relecture de l'orchestrateur à la carte GAO-kyutai-pocke-002) | prouvé | élevée | utiliser |

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | Aucune : les 4 affirmations ci-dessus sont prouvées, CL-002 et CL-003 par exécution réelle re-vérifiée indépendamment par l'orchestrateur après la relecture Sentinel. |
| Contradictions détectées | Aucune. |
| Hypothèses acceptées temporairement | Aucune — ce correctif est entièrement vérifié, contrairement au bug qu'il corrige (livré sans vérification E2E dans les cartes précédentes). |
| Preuves à obtenir avant livraison | Aucune restante pour ce correctif ; le catalogue de voix complet (toutes les voix, licences une à une) reste la carte séparée déjà annoncée par ADR-016 §4. |

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

