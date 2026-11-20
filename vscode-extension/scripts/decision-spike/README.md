# Spike de décision — mode « Auto » (GAO-spike-valuat-001)

Compare, sur des réponses Claude réelles de l'inbox, trois façons de choisir un profil de
lecture (A = lecture intégrale / `faithful`-`system-voice`, B = résumé / `llm-summary`,
C = révision rapide / `quick-review`) contre un témoin à règles. Protocole défini en
`_grimoire-output/planning-artifacts/decision-models-jev-v1.md` §10 et
`_grimoire/_memory/decisions-log.md` (« Mode Auto : SemIf sur Ollama retenu », 2026-09-27).

Node 22, ESM natif (`.mjs`), **zéro dépendance npm nouvelle** — `fetch` natif vers Ollama en
local (`127.0.0.1:11434`) uniquement, aucune sortie réseau externe.

## Fichiers

| Fichier | Rôle |
|---|---|
| `common.mjs` | helpers partagés (chemins, jsonl, stats, cosinus, erreurs) |
| `export-dataset.mjs` | exporte l'inbox réelle vers un jeu non étiqueté ; `--synthetic` pour un jeu de fumée |
| `baseline-rules.mjs` | témoin à règles (longueur, part de code, questions) |
| `semif-ollama.mjs` | technique SemIf : une lettre + `logprobs` sur `/api/generate` |
| `embeddings-knn.mjs` | calcule/cache les embeddings (`/api/embed`) ; k-NN leave-one-out si des labels existent |
| `run-all.mjs` | enchaîne les trois méthodes, tableau Markdown comparatif |

## Usage

```bash
# 1. Exporter le jeu réel (lit ~/.llm-voice/inbox/, écrit ~/.llm-voice/eval/decision-spike-v1.jsonl)
node vscode-extension/scripts/decision-spike/export-dataset.mjs

# 1bis. Si l'inbox est vide (hook « llm-voice-capture » non installé), jeu de fumée pour
#       vérifier que la chaîne fonctionne (ne compte jamais comme preuve de qualité) :
node vscode-extension/scripts/decision-spike/export-dataset.mjs --synthetic

# 2. Étiqueter ~/.llm-voice/eval/decision-spike-v1.jsonl à la main
#    (voir le README généré dans ce même dossier ~/.llm-voice/eval/README.md)

# 3. Comparer les méthodes
node vscode-extension/scripts/decision-spike/run-all.mjs
node vscode-extension/scripts/decision-spike/run-all.mjs ~/.llm-voice/eval/decision-spike-smoke.jsonl
```

Options communes : `--model=qwen2.5:3b` (SemIf), `--embed-model=nomic-embed-text` (embeddings),
premier argument positionnel = chemin du jsonl (par défaut `~/.llm-voice/eval/decision-spike-v1.jsonl`).

## Protocole

1. Exporter (non étiqueté aujourd'hui — voir écart ci-dessous).
2. **L'utilisateur étiquette lui-même** chaque ligne (jamais un LLM : sinon le spike apprend le
   goût du LLM, pas celui de l'utilisateur).
3. Relancer `run-all.mjs` : distribution par méthode, accord inter-méthodes, latence
   médiane/p95, exactitude dès qu'au moins un label existe.
4. Répéter à mesure que le jeu s'étoffe (cible : ~50 réponses étiquetées).

## Critère de décision

**On n'embarque une méthode (SemIf ou embeddings) dans le produit que si elle bat le témoin à
règles** sur l'exactitude mesurée, à latence et poids d'installation acceptables (SemIf :
aucune installation nouvelle, réutilise le narrateur Ollama existant ; embeddings : modèle
`nomic-embed-text` déjà présent, mais non multilingue — réserve documentée en §10 du document
de décision). Si aucune méthode ne bat les règles, le témoin reste le mode « Auto » par défaut.

## Écart connu au 2026-09-27

L'inbox `~/.llm-voice/inbox/` est **vide** sur cette machine : le hook Claude
« llm-voice-capture » n'est pas installé dans `~/.claude/settings.json`, donc aucune réponse
n'a encore été capturée. Le critère « 50 réponses exportées » n'est pas atteignable aujourd'hui.
Prérequis avant un vrai spike : exécuter la commande VS Code **« LLM Voice: Install Claude
Hook »** puis laisser tourner quelques sessions Claude Code. En attendant, `--synthetic` prouve
que la chaîne `export-dataset.mjs` → `run-all.mjs` fonctionne de bout en bout, sur un jeu
inventé qui n'a aucune valeur de décision.

## Banc d'évaluation du mode « Auto » (GAO-valuation-m-001, 2026-09-29)

Jeu versionné `dataset/auto-eval-v1.jsonl` : 51 réponses finales d'agent de code **inventées** (aucune
donnée personnelle, aucune capture d'inbox), 16 catégories, étiquetées sur les **quatre profils réels**
(`faithful-local`, `llm-summary`, `technical-teacher`, `quick-review` ; `system-voice` = même mode que
`faithful-local`). **Étiquettes proposées par Claude (`labelSource: "claude-proposed"`), non validées** :
les scores mesurent l'accord avec ces propositions. Relecture : `dataset/LABELS-TO-REVIEW.md`, puis
`node apply-labels.mjs` (écrit `userLabel` + `labelSource: "user"`, lu en priorité par le banc).

| Fichier | Rôle |
|---|---|
| `auto-profiles.mjs` | profils candidats (miroir de `src/profiles/defaults.ts`), exemples de prompt hors jeu |
| `auto-classifiers.mjs` | témoins à règles, SemIf (lettres, prompt enrichi, noms, calibration), hybride, JSON contraint |
| `embeddings-knn.mjs` | + `embedItems` (sans cache) et `knnLooProfiles` (LOO, k par CV imbriquée) |
| `run-all.mjs` | toutes les approches, tableau final et gagnante (p95 < 1 s) en une commande |
| `apply-labels.mjs` | `--generate` le tableau de relecture ; sans option, applique les corrections |

```bash
node vscode-extension/scripts/decision-spike/run-all.mjs            # tout, ~6 min (gpt-oss:20b inclus)
node vscode-extension/scripts/decision-spike/run-all.mjs --quick    # sans gpt-oss:20b
node vscode-extension/scripts/decision-spike/run-all.mjs --only=rules,7b-letters --json-out=/tmp/r.json
```

Anti-fuite : seuils, prompts et exemples fixés a priori ; k-NN en leave-one-out avec k choisi par
validation croisée imbriquée ; calibration contextuelle sur une entrée « N/A » (sans étiquette).
Réserve : choisir la meilleure de ~30 variantes sur 51 cas surestime son score (biais du gagnant).
Résultats et configuration gagnante : `_grimoire-output/evidence/GAO-valuation-m-001/evidence-pack.md`.
