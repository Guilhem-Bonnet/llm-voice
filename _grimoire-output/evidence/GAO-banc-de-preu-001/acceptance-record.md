# Agentic Acceptance Record

- Task id: GAO-banc-de-preu-001
- Profile: controlled
- Deliverable: banc de preuve audio autonome `scripts/audio-proof/` (setup.sh, prove.sh, analyze.py, selftest.sh, README.md) + sonde autoplay `audible-probe.test.ts` copiée dans `vscode-extension/test/integration-security/`
- Validator : gate automatique (`grimoire standard gate check --strict`) ; vérification indépendante à faire par guilhem-bonnet ou un agent tiers

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | test : code de sortie 0 sur le WAV de référence (transcription contient la phrase attendue) | `scripts/audio-proof/selftest.sh`, sortie `{"wer": 0.0, ..., "pass": true}`, `reference_exit=0` (deux exécutions consécutives) | passé |
| AC-002 | test : code de sortie non nul sur un WAV silencieux | même exécution, `{"wer": 1.0, "silent": true, "pass": false}`, `silence_exit=1` | passé |
| AC-003 | gate : `grimoire standard gate check --task-id GAO-banc-de-preu-001 --strict` vert | sortie : « OK evidence gates for task GAO-banc-de-preu-001 (state: review) », tests `npm --prefix vscode-extension run test:unit` vert (exit 0) | passé |

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests | vert | gate ci-dessus ; `test-run.json` de la tâche |
| Build / lint | non applicable | scripts bash/Python autonomes, pas de build du produit |
| Sécurité | passé | sink PipeWire nettoyé par `trap` dans tous les cas testés (succès, échec, silence) ; aucune donnée envoyée hors machine (faster-whisper local, cpu) |
| Design / accessibilité | non applicable | — |
| Evals IA | non applicable | — |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Seuil WER 0,25 validé sur une seule phrase (marge mesurée 0,0–0,11) | pourrait être trop permissif ou trop strict sur d'autres phrases/voix | accepté (documenté en claim-ledger CL-008) ; à recalibrer si ce banc devient un gate strict |
| Root cause « module-stream-restore » et fix `pw-play` spécifiques à cette machine ; non vérifiés sur une autre installation Fedora/PipeWire | le script échoue explicitement (message clair) si `pw-play` est absent plutôt que de retomber silencieusement en mode dégradé | accepté ; documenté dans `README.md` et en tête de `prove.sh` |
| Sonde autoplay copiée non exécutée (nécessite l'Extension Test Host VS Code) | pas de preuve d'exécution de ce fichier précis dans ce pack | accepté ; carte de diagnostic autoplay dédiée à prévoir |
| `cc-verify.sh --stack py` (garde-fou du skill meta-toolsmithing) non exécuté | outil bash/Python hors périmètre npm du dépôt | accepté, signalé en déviation dans `evidence-pack.md` |

## Décision

Accepter sous réserve de vérification indépendante (gate automatique vert ; validation humaine finale à guilhem-bonnet).
