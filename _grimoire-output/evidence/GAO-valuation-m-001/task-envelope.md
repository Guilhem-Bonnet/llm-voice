# Agentic Task Envelope

## Task

- Task id: GAO-valuation-m-001
- Request: jeu d'évaluation du mode « Auto » (≥ 45 réponses finales d'agent de code, très variées),
  mesure de départ (règles, SemIf `qwen2.5:3b`, embeddings k-NN en leave-one-out), puis variantes
  d'amélioration mesurées sur le même jeu (a–f), sélection de la meilleure variante à p95 < 1 s,
  tableau final produit par `run-all.mjs` en une commande.
- Owner agent: backend-engineer (Stack) — scripts Node ESM sous `vscode-extension/scripts/decision-spike/`
- Profile: controlled
- Current state: `executing` (la carte reste `running` : la validation des étiquettes par l'utilisateur est un critère)
- Risk level: `low` (outillage hors VSIX, zéro dépendance npm, réseau limité à `127.0.0.1:11434`)

## Avertissement de méthode (à lire avant tout chiffre)

Les étiquettes du jeu `dataset/auto-eval-v1.jsonl` sont **PROPOSÉES par Claude** (`labelSource:
"claude-proposed"`) et **non validées** par l'utilisateur. Tout score de ce dossier mesure l'**accord avec
ces propositions**, pas la qualité ressentie par l'utilisateur. Le protocole §10 de
`decision-models-jev-v1.md` exige des étiquettes humaines : elles sont demandées via
`dataset/LABELS-TO-REVIEW.md`.

## Classes (profils réels, `vscode-extension/src/profiles/defaults.ts` + `core/profile.schema.ts`)

| id | libellé | mode | rôle dans « Auto » |
|---|---|---|---|
| `faithful-local` | Lecture fidèle (local) | faithful | lecture mot à mot |
| `llm-summary` | Résumé LLM | narrated | fait / limites / reste à faire |
| `technical-teacher` | Professeur technique | narrated | explication pédagogique |
| `quick-review` | Révision rapide | narrated | concepts, pièges, essentiel |

`system-voice` a le même mode `faithful` que `faithful-local` (il ne diffère que par la voix) : ce n'est pas
un choix de *manière de lire*, il n'est donc pas une classe distincte ; « Auto » en mode fidèle garde la voix
du profil courant.

## Garde-fous anti-fuite

- Aucun réglage (seuils, k, prompt, exemples) choisi en regardant les cas de test sans validation croisée.
- Exemples « 1 par profil » du prompt (b) écrits à part (`prompt-examples.mjs`), jamais tirés du jeu.
- k-NN : leave-one-out strict ; tout hyperparamètre (k) choisi par validation croisée imbriquée.
- Seuils du témoin à règles et de l'hybride (d) : fixés *a priori* dans le code avant la mesure, non réglés.
- Modèles chauffés par un appel hors jeu avant chaque mesure de latence (charge à froid exclue et notée).

## Tool boundary

| Tool | Permission | Scope |
|---|---|---|
| Écriture | write | `vscode-extension/scripts/decision-spike/**`, `_grimoire-output/evidence/GAO-valuation-m-001/**` |
| Exécution | execute | `node`, `curl` vers `127.0.0.1:11434`, CLI `grimoire` (lecture, context, trace, gate) |
| Interdits | — | `git commit`, changement d'état de la carte, `grimoire policies reset-session`, `ollama pull` |

## LLM routing

| Step | Provider | Model | Data policy |
|---|---|---|---|
| Rédaction du jeu, scripts, preuve | Anthropic | Claude (session) | textes inventés, aucune donnée personnelle |
| Classifieurs mesurés | Ollama local 0.21.0 | qwen2.5:3b, qwen2.5:7b, gpt-oss:20b, nomic-embed-text | loopback uniquement |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan / hypothèses | ce fichier | recorded |
| Jeu d'évaluation | `dataset/auto-eval-v1.jsonl` (≥ 45 cas) + `LABELS-TO-REVIEW.md` | pending |
| Mesures | sortie de `node run-all.mjs` consignée dans `evidence-pack.md` | pending |
| Validation étiquettes utilisateur | `acceptance-record.md` (hors de cette session) | pending — critère utilisateur |
| Gate strict | `grimoire standard gate check --task-id GAO-valuation-m-001 --strict` | pending |
