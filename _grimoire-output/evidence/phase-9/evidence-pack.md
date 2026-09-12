# Agentic Evidence Pack

## Summary

- Task id: phase-9
- Profile: starter
- Outcome: Les deux retours du test réel sont corrigés. La sélection de voix fonctionne, les profils hérités sont migrés, Piper présent dans le PATH est détecté et prioritaire sur espeak-ng. Le point d'entrée devient une vue dédiée dans la barre d'activité, révision assumée de l'ADR-011.
- Final state: done

## Origine

Test réel du 2026-09-12, version de développement 0.2 : « j'ai choisi la voix mais dès que je veux play il me dit aucune voix configurée » et « le raccourci ctrl+alt+v n'est pas intuitif en procédure de start, je préfère avoir une fenêtre dédiée à l'outil dans VS Code, comme Claude avec son chat ».

## Diagnostic

Le `profiles.json` réel de l'utilisateur, écrit par une version antérieure, épinglait les quatre profils sur Chatterbox — arrêté. Trois défauts distincts :

1. `Setup Voice` n'écrivait **jamais** `providerId` : le choix de voix n'atteignait pas le pipeline. Racine du symptôme.
2. Aucune migration d'un `profiles.json` existant : un utilisateur revenant d'une version antérieure restait épinglé indéfiniment.
3. Un `referenceAudio` introuvable faisait échouer toute la synthèse au lieu de replier sur une voix prédéfinie.

Deux défauts supplémentaires, trouvés en relisant le correctif, qui décidaient de ce qu'un utilisateur entend par défaut :

4. Piper présent dans le `PATH` (hors du dossier d'installation de l'extension) n'était pas détecté.
5. La présence d'espeak-ng suffisait à considérer une voix disponible, empêchant à jamais la proposition d'installer Piper — l'utilisateur aurait entendu une voix nettement plus robotique alors qu'une bien meilleure était à un clic.

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| PR #54 correctif | merge `3710fa0` | fix-loop-orchestrator (Sonnet) | 5 défauts corrigés, chacun avec échec constaté avant correction |
| PR #55 vue dédiée | merge `2fa25b9` | art-director + backend-engineer (Sonnet) | icône dans la barre d'activité, disposition `full` par défaut |
| Revue | `_grimoire-output/team-build/test-reports/phase-9-sentinel-review.md` | Sentinel (Sonnet) | mutation-tests sur les 3 correctifs principaux |
| Issue #50 | fermée | concierge + Sentinel | 10 exécutions consécutives vertes |

## Validation

| Check | Result |
|---|---|
| Unit | 942/942, couverture 93,7 % |
| Intégration xvfb | **10 exécutions consécutives, 10 vertes** |
| CI | 9/9 sur les deux PR |
| Traçabilité | tous les contrôles passés |
| Packaging | VSIX 311 Ko |

## Bénéfice collatéral

La correction des chemins `--user-data-dir` dans `.vscode-test.mjs` (PR #55) supprime un partage d'état entre exécutions parallèles de tests qui corrompait `profiles.json`. C'était la cause de l'instabilité suivie dans l'issue #50, fermée sur preuve.

## Leçon

Le test manuel de l'utilisateur a trouvé en cinq minutes un bug bloquant qu'aucun des 934 tests automatisés n'avait vu : aucun test ne partait d'un `profiles.json` hérité d'une version antérieure. Les tests créaient toujours un état neuf.

**Règle instaurée** : toute évolution du format de configuration exige une fixture issue de la version précédente et un test de migration.

## Deviations and accepted risks

| Deviation | Impact | Review trigger |
|---|---|---|
| Qualité de la voix Piper par défaut toujours non arbitrée par l'utilisateur | bloque la publication de la 0.2 | question posée, en attente |
| Reste de la checklist 0.2 non parcouru (inbox Claude, confidentialité) | couverture manuelle partielle | poursuite du test |

## Completion statement

Phase 9 complète : les deux retours sont corrigés, vérifiés par mutation-tests et par dix exécutions consécutives.
