# Agentic Claim Ledger

Une affirmation sans preuve reste une hypothèse. Ce registre relie chaque
affirmation qui pèse sur une décision ou une livraison à ce qui la prouve.

- Task id: GAO-spike-valuat-001
- Profile: controlled

## Claims

| ID | Affirmation | Type | Source ou preuve | Statut | Confiance | Décision |
|---|---|---|---|---|---|---|
| CL-001 | Les cinq scripts du spike s'exécutent de bout en bout (export, règles, SemIf, embeddings, run-all) et produisent le tableau exactitude/latence | test | `node export-dataset.mjs [--synthetic]` puis `node run-all.mjs ~/.llm-voice/eval/decision-spike-smoke.jsonl`, exit 0, ré-exécutés par l'orchestrateur le 2026-09-27 (evidence-pack.md) | prouvé | élevée | utiliser |
| CL-002 | L'API native Ollama `/api/generate` renvoie bien `logprobs`/`top_logprobs` exploitables (approche SemIf) | test | `semif-ollama.mjs` sur `qwen2.5:3b` : distribution A/B/C lue, latence médiane 198 ms, p95 222 ms | prouvé | élevée | utiliser |
| CL-003 | L'inbox réelle est vide (0 fichier) car le hook Claude `llm-voice-capture` n'est pas installé dans `~/.claude/settings.json` | fait | `ls ~/.llm-voice/inbox/` et lecture de `~/.claude/settings.json` par l'orchestrateur | prouvé | élevée | utiliser — écart déclaré |
| CL-004 | Les exactitudes mesurées sur le jeu synthétique (règles 67 %, SemIf 22 %, embeddings 44 %) disent quelque chose de la qualité des méthodes | hypothèse | 9 réponses inventées, étiquetées par leur auteur : preuve de fonctionnement seulement | contredit | faible | rejeter — aucune conclusion de qualité avant le jeu réel étiqueté par l'utilisateur |
| CL-005 | SemIf avec `qwen2.5:3b` répond « B » sur 8 réponses sur 9 du jeu synthétique | résultat | tableau run-all (evidence-pack.md) | prouvé | moyenne | vérifier — biais de prompt ou de modèle à examiner lors du spike réel, avant de conclure |

Types : `fait`, `hypothèse`, `résultat`, `décision`. Statuts : `prouvé`,
`hypothèse`, `contredit`. Confiance : `faible`, `moyenne`, `élevée`. Décision :
`utiliser`, `vérifier`, `rejeter`.

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

## Synthèse

| Question | Réponse |
|---|---|
| Affirmations bloquantes non prouvées | aucune pour l'outillage ; la mesure de qualité elle-même reste à faire |
| Contradictions détectées | CL-004 : le jeu synthétique ne vaut pas mesure |
| Hypothèses acceptées temporairement | CL-005 (biais « B » de SemIf) |
| Preuves à obtenir avant livraison | 50 réponses Claude réelles étiquetées par l'utilisateur (prérequis : « LLM Voice: Install Claude Hook »), puis `run-all` sur ce jeu |
