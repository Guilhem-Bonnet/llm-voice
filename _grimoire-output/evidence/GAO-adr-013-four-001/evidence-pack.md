# Agentic Evidence Pack

## Summary

- Task id: GAO-adr-013-four-001
- Profile: controlled
- Outcome: ADR-013 « Fournisseur de décision typée (`DecisionProvider`) et mode « Auto » » rédigé, statut **Proposé** ; index `docs/adr/README.md` mis à jour.
- Final state: livré pour vérification indépendante (2026-09-27). Aucune commande exécutée par cet agent (pas de Bash) ; le gate `--strict` reste à lancer par l'orchestrateur.

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Enveloppe de tâche (écrite avant toute modification) | `_grimoire-output/evidence/GAO-adr-013-four-001/task-envelope.md` | platform-architect (Opus) | écrite |
| ADR-013 | `docs/adr/ADR-013-decision-provider.md` | platform-architect (Opus) | écrit : statut, contexte, décision (6 sous-sections + diagramme Mermaid de séquence + tableau P0), conséquences, alternatives rejetées, plan de vérification |
| Index des ADR | `docs/adr/README.md` | platform-architect | une ligne ADR-013 ajoutée ; phrase de fin corrigée (« ADR-001 à 011 acceptés, ADR-013 proposé, ADR-012 non versé »). Le fichier n'a pas de marqueur `grimoire:managed` : index manuel, modifié comme le brief l'autorisait |

### Fichiers lus (tous en entier sauf mention)

- `_grimoire/kit/agents/platform-architect.md`, `_grimoire/_memory/shared-context.md`
- `docs/adr/README.md`, `ADR-005-provider-contracts.md`, `ADR-009-tts-tiers.md`, `ADR-010-egress-guard.md`
- `_grimoire-output/planning-artifacts/decision-models-jev-v1.md` (§1–§10), `decision-points-map-v1.md`
- `_grimoire/_memory/decisions-log.md` (entrée 2026-09-27 « Mode Auto » comprise)
- `vscode-extension/src/core/narration.ts`, `core/profile.schema.ts`, `core/health.ts`,
  `narrator/createNarratorProvider.ts`, `net/EgressGuard.ts`, `profiles/bySource.ts`, `profiles/migrations.ts`,
  `profiles/profileForm.ts`
- `vscode-extension/src/profiles/defaults.ts` (lignes 100–128 seulement), `vscode-extension/package.json` (lignes 560–749 seulement)
- `_grimoire-output/evidence/GAO-diagnostic-s-001/task-envelope.md` et `evidence-pack.md`, `GAO-narrateur-in-001/task-envelope.md` (gabarits)

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Choix tranchés dans l'ADR

1. **Repli obligatoire dans la requête** : `fallbackOptionId` / `fallbackLevelId` / `fallback` requis ; `DecisionResult.outcome` toujours présent (valeur de repli si `degraded`, sans distribution). Écarte l'esquisse de `decision-points-map-v1.md` §B, où `outcome` était optionnel.
2. **« Auto » = id réservé `"auto"`**, jamais un `VoiceProfile` : refus par le schéma (`RESERVED_PROFILE_IDS`), migration de schéma v3 qui renomme un profil `auto` existant en `auto-custom`, repli = premier id réel de la chaîne `resolveDefaultProfileId` en sautant `"auto"`, jamais d'écriture dans `lastSelectedId`, et **opt-in en 0.4** (défaut `bySource` inchangé).
3. **Auto exclut les profils distants des candidats** (règle ajoutée, absente des sources).
4. Lettre absente du top-k → P = 0 (pas de masse résiduelle inventée) ; `response` ignoré au profit du top-k ; seules les lettres majuscules exactes comptent ; seuil `insufficient-option-mass` à 0,5 proposé.
5. `maxOptions = 10`, `top_logprobs = 20`, `maxInputChars` fournisseur = 4 000, `timeoutMs` = 3 000 ms : toutes ces valeurs sont **proposées, non mesurées**.
6. `getCapabilities()` obligatoire, avec `calibratedProbabilities` et `localOnly`. L'UI n'affiche aucun pourcentage.
7. Modèle et hôte de décision = ceux du narrateur par défaut.
8. `score` et `noul` se réduisent au choix par lettres (niveaux ordonnés ; A = oui / B = non).

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Relecture de cohérence ADR ↔ sources | lecture manuelle par l'auteur | faite | pas une vérification indépendante |
| Vérification indépendante | agent distinct, contexte neuf | **à faire** | demandée par le brief |
| Gate | `grimoire standard gate check --task-id GAO-adr-013-four-001 --strict` | **non exécuté** | pas de Bash dans cette tâche |
| Lint Markdown | diagnostics IDE après édition du README | avertissements MD060 sur la ligne 7 du README (`\|---\|---\|---\|`) | ligne antérieure, non modifiée ; aucun diagnostic signalé sur l'ADR-013 |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | yes | enveloppe écrite avant le livrable ; frontière respectée (aucune écriture sous `vscode-extension/src` ni `_grimoire/_memory`) | journalisation dans `decisions-log.md` laissée à l'orchestrateur |
| Quality | partial | plan de vérification détaillé dans l'ADR | aucun test n'existe encore (ADR proposé) |
| Runtime | no | — | rien n'a été exécuté |
| Knowledge | partial | faits Ollama limités à la preuve locale du 2026-09-27 | documentation Ollama et Jev non consultée |
| Model/provider | yes | routage Opus pour l'ADR, conforme à `shared-context.md` | — |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Titre de section « Plan de vérification » au lieu de « Tests qui prouvent la décision » (format du README) | cosmétique ; conforme au brief | à confirmer par le vérificateur | relecture |
| Le hook PostToolUse demande d'ajouter la preuve à `_grimoire-output/evidence/bootstrap/evidence-pack.md` | non fait : le brief interdit les autres dossiers de preuve, et `bootstrap` est hors board (`gate.task_not_on_board`) | orchestrateur | — |
| Esquisse de contrat de `decision-points-map-v1.md` §B modifiée (repli obligatoire, `getCapabilities`, raisons étendues) et « `RuleDecisionProvider` = repli » remplacé par « None = repli statique » | le témoin à règles reste un concurrent du spike, pas le repli produit | vérificateur | relecture |

## Points laissés ouverts

- Forme exacte des champs `logprobs`/`top_logprobs` dans la réponse d'Ollama 0.21, plafond serveur de `top_logprobs`, version minimale d'Ollama qui les expose : **non vérifiés**. Le fake doit être bâti sur une réponse réelle capturée.
- Troncature par usage, seuil `optionMass`, délai, modèle retenu, préfixe de signaux (longueur) : à fixer par le spike `GAO-spike-valuat-001`.
- Biais de position des lettres : non traité en v1 ; mesure attendue du spike.
- Format filaire Jev `/v1/systemone` : non vérifié (limite déclarée par l'étude, §9).
- Nombre de profils > 10 : l'ADR renvoie `invalid-request` + repli ; l'ergonomie de `autoCandidates` reste à valider.
- Portée de la migration v3 (renommage `auto` → `auto-custom`) : les réglages qui visaient ce profil basculent en mode Auto. Conséquence acceptée dans l'ADR, à confirmer par l'utilisateur.
- ADR-012 (son) absent de `docs/adr/` : le calendrier « après ADR-012 » est repris des sources sans vérifier l'état réel d'ADR-012.

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification. Ici : livrable écrit ; vérification indépendante et gate `--strict` en attente.


## Relecture indépendante et corrections (orchestrateur, 2026-09-27)

- Relecteur : `agent-optimizer` (Sentinel), modèle sonnet, contexte neuf, rapport `review-sentinel.md` (même dossier).
- Verdict : **ACCEPTER AVEC CORRECTIONS MINEURES** — 0 point bloquant, 3 suggestions de formulation.
- Suggestions 1 et 2 appliquées dans `docs/adr/ADR-013-decision-provider.md` : `RESERVED_PROFILE_IDS` et la migration `schemaVersion 3` sont maintenant écrits « à créer » (ils n'existent pas encore dans `profile.schema.ts`) ; la généralisation « 1,5–7 B » est restreinte à la seule preuve `qwen2.5:3b`, le reste marqué non testé.
- Suggestion 3 (lisibilité du diagramme de séquence, distinguer refus EgressGuard et sortie Ollama inexploitable) : **non appliquée**, différée à la carte d'implémentation `GAO-mode-auto-im-001`.
