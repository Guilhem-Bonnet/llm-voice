# Evidence Pack — GAO-spike-valuat-001

## Commandes exécutées

```
$ node vscode-extension/scripts/decision-spike/export-dataset.mjs
Inbox vide : 0 fichier dans ~/.llm-voice/inbox/ (le hook Claude « llm-voice-capture » n'est
probablement pas installé). 0 ligne exportée. Exécuter la commande VS Code « LLM Voice: Install
Claude Hook », laisser tourner quelques sessions, puis relancer ce script.
exit=0
```

```
$ node vscode-extension/scripts/decision-spike/run-all.mjs
Jeu de données vide (~/.llm-voice/eval/decision-spike-v1.jsonl) — aucune comparaison possible.
exit=0
```

```
$ node vscode-extension/scripts/decision-spike/export-dataset.mjs --synthetic
Jeu synthétique écrit : 9 lignes (3 par catégorie A/B/C, invention de démonstration, jamais
destiné à l'étiquetage ni à la décision réelle).
exit=0
```

```
$ node vscode-extension/scripts/decision-spike/run-all.mjs ~/.llm-voice/eval/decision-spike-smoke.jsonl
Jeu : ~/.llm-voice/eval/decision-spike-smoke.jsonl — 9 entrée(s), 9 étiquetée(s).
AVERTISSEMENT : jeu synthétique (réponses inventées) — preuve de fonctionnement de la chaîne
uniquement, ne vaut pas comme mesure de qualité pour la décision du spike.

| Méthode | Distribution A/B/C | Latence médiane | Latence p95 | Exactitude |
|---|---|---|---|---|
| Témoin (règles) | A:6 B:0 C:3 | 0 ms | 0 ms | 67% (6/9, sur 9 étiquetée(s)) |
| SemIf (Ollama qwen2.5:3b) | A:0 B:8 C:1 | 252 ms | 2758 ms | 22% (2/9, sur 9 étiquetée(s)) |
| Embeddings k-NN (nomic-embed-text) | A:4 B:5 C:0 | 38 ms | 1135 ms | 44% (4/9, sur 9 étiquetée(s)) |

| Paire | Accord |
|---|---|
| Témoin ↔ SemIf | 0% (0/9) |
| Témoin ↔ Embeddings | 33% (3/9) |
| SemIf ↔ Embeddings | 44% (4/9) |
exit=0
```

```
$ npm --prefix vscode-extension run lint
ESLint: No issues found
exit=0
```
(`eslint.config.mjs` ignore déjà `*.mjs` à la racine du projet lintée — `scripts/decision-spike/**`
est donc hors périmètre du lint TypeScript ; confirmé en relisant `vscode-extension/eslint.config.mjs`,
et la commande ci-dessus est verte.)

## Constats

- **Inbox réelle vide** : `~/.llm-voice/inbox/` contient 0 fichier `*.json` et aucun sous-dossier
  `archive/`. Confirmé par `find`/`ls` avant tout export.
- **Chaîne bout-en-bout fonctionnelle** sur le jeu de fumée (9 réponses inventées, `synthetic: true`) :
  export, témoin à règles, SemIf sur Ollama (`qwen2.5:3b`, `logprobs`/`top_logprobs` réels), embeddings
  (`nomic-embed-text`, cache + k-NN leave-one-out) et tableau Markdown produits sans erreur, code de
  sortie 0 sur chaque étape.
- **Schéma Ollama vérifié par appel réel** avant d'écrire `semif-ollama.mjs` : `POST /api/generate`
  (Ollama 0.21.0) renvoie `logprobs: [{ token, logprob, bytes, top_logprobs: [{ token, logprob, bytes }] }]` ;
  `POST /api/embed` renvoie `embeddings: number[][]`.
- **Dégradation propre vérifiée** (tests de robustesse, non répétés dans cette liste par consigne du
  coordinateur qui a demandé d'arrêter ces tests une fois la preuve obtenue) : modèle Ollama absent (404)
  et serveur injoignable produisent un message clair côté `run-all.mjs` (`indisponible (...)`, colonnes
  `n/d`) sans interrompre les autres méthodes ni faire planter le script (exit 0 dans tous les cas).
- **Confidentialité (AC-SEC-07)** : aucune sortie de commande ci-dessus, ni aucun fichier sous
  `vscode-extension/` ou `_grimoire-output/`, ne contient de texte de message d'inbox — seuls des
  comptages et métriques y figurent. Le seul endroit où `message` est stocké en clair est
  `~/.llm-voice/eval/*.jsonl`, hors dépôt git.
- **Chiffres de latence SemIf/embeddings** ci-dessus mesurés sur le jeu synthétique (9 réponses) sur
  cette machine, un seul run : à titre indicatif de fonctionnement, pas de performance en régime réel.

## Écart déclaré

Le critère du brief « jusqu'à 50 lignes exportées depuis l'inbox réelle » **n'est pas atteignable
aujourd'hui** : l'inbox `~/.llm-voice/inbox/` est vide car le hook Claude Code « llm-voice-capture »
n'est pas installé dans `~/.claude/settings.json` sur cette machine (confirmé par le coordinateur).
Aucune réponse Claude réelle n'a donc jamais été capturée.

**Prérequis avant de rejouer le spike avec de vraies données** : l'utilisateur exécute la commande
VS Code **« LLM Voice: Install Claude Hook »**, laisse tourner quelques sessions Claude Code pour
peupler l'inbox, puis relance `node vscode-extension/scripts/decision-spike/export-dataset.mjs`
(sans `--synthetic`) et étiquette lui-même `~/.llm-voice/eval/decision-spike-v1.jsonl` avant de
relancer `run-all.mjs`.

En attendant, le mode `--synthetic` (9 réponses françaises inventées par l'agent, jamais des données
réelles) prouve que la chaîne export → étiquetage → comparaison fonctionne de bout en bout ; le
tableau produit sur ce jeu **ne vaut que comme preuve d'exécution**, jamais comme mesure de qualité
ni comme base de l'arbitrage SemIf/Laya/embeddings du §10 de `decision-models-jev-v1.md`.

## Fichiers produits

- `vscode-extension/scripts/decision-spike/common.mjs`
- `vscode-extension/scripts/decision-spike/export-dataset.mjs`
- `vscode-extension/scripts/decision-spike/baseline-rules.mjs`
- `vscode-extension/scripts/decision-spike/semif-ollama.mjs`
- `vscode-extension/scripts/decision-spike/embeddings-knn.mjs`
- `vscode-extension/scripts/decision-spike/run-all.mjs`
- `vscode-extension/scripts/decision-spike/README.md`
- `~/.llm-voice/eval/README.md` (hors dépôt, généré par `export-dataset.mjs`)
- `_grimoire-output/evidence/GAO-spike-valuat-001/task-envelope.md`
- `_grimoire-output/evidence/GAO-spike-valuat-001/evidence-pack.md` (ce fichier)

Aucune modification sous `vscode-extension/src/**`, `_grimoire/_memory/**`, ni dans un autre dossier
de preuve. Aucun `git commit` effectué.


## Recontrôle par l'orchestrateur (2026-09-27)

Ré-exécution indépendante : `export-dataset.mjs` (inbox vide → 0 ligne, exit 0), `export-dataset.mjs --synthetic` (9 lignes), `run-all.mjs` sur le jeu synthétique → tableau complet : règles A:6 B:0 C:3 (67 %), SemIf qwen2.5:3b A:0 B:8 C:1 (22 %, médiane 198 ms, p95 222 ms), embeddings k-NN nomic-embed-text A:4 B:5 C:0 (44 %). Accord règles↔SemIf 0 %. **Ces chiffres prouvent la chaîne, pas la qualité** (jeu inventé). Signal à garder en tête pour le spike réel : SemIf répond presque toujours « B » — biais de prompt ou de modèle à examiner.

Écart confirmé : critère « 50 réponses exportées » non atteignable (hook Claude absent chez l'utilisateur, inbox vide). La carte est close sur l'outillage ; la mesure réelle reste la condition d'entrée de `GAO-mode-auto-im-001` (ADR-013 §Plan de vérification).

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
