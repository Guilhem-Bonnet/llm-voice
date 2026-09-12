# Agentic Evidence Pack

## Summary

- Task id: phase-8
- Profile: starter
- Outcome: Autonomie sans Docker (exigence utilisateur), confort de choix des voix et éditeur de profils, dette d'outillage résorbée. Trois PR mergées, 919 tests unitaires verts, VSIX 307 Ko.
- Final state: done

## Origine

Retour utilisateur du 2026-09-11 : « le fait que Docker manque est un souci car les utilisateurs grand public ne l'installent pas eux-mêmes, il faut que tout soit autonome ».

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| PR #48 voix autonome par défaut | merge `ed5eb39` | backend-engineer (Sonnet) | Piper retenu après rejet argumenté du moteur intégré ; correction bloquante trouvée en revue : erreur de permission Windows sur le renommage atomique des profils |
| PR #49 navigateur de voix, ma voix, éditeur de profils | merge `c345e9a` | backend-engineer + art-director (Sonnet) | 3 commandes ; bug réel corrigé : `listVoices()` renvoyait des identifiants vides ; champs réalignés sur le cahier des charges avec migration testée ; 2 alertes CodeQL corrigées |
| PR #47 dette d'outillage | merge `89c2a0c` | pipeline-architect (Sonnet) | vitest 5, eslint 10, actions v7 ; 8 PR Dependabot fermées |
| Revue | `_grimoire-output/team-build/test-reports/phase-8-sentinel-review.md` | Sentinel (Sonnet) | verdict AC-07 argumenté |
| Ticket de suivi | issue #50 | concierge | test d'acceptation instable à stabiliser |

## Décision technique majeure

Évaluation réelle du moteur intégré au processus (`kokoro-js`) avant tout code : rejeté sur preuves — 737 Mo de dépendances, 3 CVE hautes via `sharp`, et surtout **aucune voix française réellement disponible** dans le modèle ONNX documenté (échec constaté à l'exécution). Piper retenu : téléchargé à la demande (~60 Mo), aucun ajout au VSIX, facteur temps réel 0,038 (6,6 s d'audio en 0,25 s), soit environ trente fois plus rapide que Chatterbox.

Chatterbox rétrogradé en option avancée explicitement marquée « nécessite Docker », jamais nommé dans un message destiné à quelqu'un qui ne l'a pas configuré.

## Validation

| Check | Result |
|---|---|
| Unit | 919/919 (78 fichiers) |
| Lint / typecheck | propres |
| Intégration xvfb | tous profils verts, exit 0 |
| Packaging | VSIX 24 fichiers, 306,7 Ko |
| Vulnérabilités dev | 10 → 4 ; `npm audit --omit=dev` = 0 |
| Écoute réelle | voix Piper française jouée à l'utilisateur (facteur temps réel 0,038) |
| E2E réel | 11/11 tests contre Ollama et Chatterbox |
| Traçabilité | 27 critères couverts, 0 partiel, 0 non couvert |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| La meilleure qualité (Chatterbox + clonage) reste derrière Docker | compromis affiché, pas caché | utilisateur informé | si un moteur natif de qualité équivalente apparaît |
| Qualité de la voix Piper par défaut non validée à l'oreille par l'utilisateur | le défaut grand public n'est pas arbitré | concierge | question posée, en attente de réponse |
| `@types/node` maintenu en 22.x | volontaire : runtime Node 22 | concierge | montée de Node |
| Test d'acceptation AC-07 instable sous Ubuntu | risque de masquer une régression future | concierge | issue #50 |
| 4 vulnérabilités de développement subsistent | hors VSIX | concierge | montée de `@vscode/test-cli` |

## Completion statement

Phase 8 complète : l'extension n'exige plus Docker sur son chemin par défaut, le choix des voix est autonome, l'outillage est à jour.
