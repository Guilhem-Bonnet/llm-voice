# Agentic Acceptance Record

Un livrable métier n'est accepté que par celui qui le reçoit. Ce dossier relie
chaque critère d'acceptation à sa preuve et porte la décision du client ou du
validateur : accepter, refuser, demander un ajustement.

- Task id: GAO-narrateur-in-001
- Profile: controlled
- Deliverable: Narrateur : installer qwen2.5:7b (modèle par défaut) sur la machine dev et prouver la santé du narrateur Ollama
- Validator: guilhem-bonnet

## Critères d'acceptation

| ID | Critère | Preuve | Statut |
|---|---|---|---|
| AC-001 | test : ollama list contient qwen2.5:7b et POST /api/chat avec format JSON Schema renvoie un JSON valide (sortie journalisée dans evidence-pack) | `evidence-pack.md` §ollama list + `payload.json`/`response.json`/`headers.txt` ; recontrôle orchestrateur `ollama list` 2026-09-27 | passé |
| AC-002 | gate : grimoire standard gate check --strict vert | `grimoire standard gate check --task-id GAO-narrateur-in-001 --strict` → OK (2026-09-27, orchestrateur) | passé |

Statuts : `passé`, `partiel`, `échoué`, `à vérifier`. Preuve : un test, une
capture, une revue, une commande ou un document — un chemin ou une commande,
pas une phrase.

## Vérifications

| Vérification | Résultat | Preuve |
|---|---|---|
| Tests | passé | requête `/api/chat` structurée HTTP 200, JSON validé par script |
| Build / lint | non applicable | aucun code produit modifié |
| Sécurité | passé | cible loopback 127.0.0.1:11434 uniquement, aucun secret dans les preuves |
| Design / accessibilité | non applicable | — |
| Evals IA | non applicable | — |

## Risques et limites

| Risque ou limite | Impact | Décision |
|---|---|---|
| Latence 11,47 s mesurée à froid (chargement du modèle inclus) | première narration lente après inactivité d'Ollama | acceptée ; le warmup du narrateur reste un sujet produit distinct |
| Santé non vérifiée depuis l'extension elle-même (CL-004) | risque faible : même endpoint, même schéma | à couvrir au prochain E2E réel |

## Décision

| Décision | Validateur | Date | Commentaire |
|---|---|---|---|
| accepté | concierge (Marcel), par délégation de guilhem-bonnet (demande du 2026-09-27 : « lance les sous-agents pour chacune des tâches ») — ratification utilisateur attendue | 2026-09-27 | critères AC-001 et AC-002 passés, preuves recontrôlées par l'orchestrateur |

Décisions : `accepté`, `refusé`, `ajustement demandé`, `en attente`. Une
décision `accepté` sans validateur ni date n'en est pas une.
