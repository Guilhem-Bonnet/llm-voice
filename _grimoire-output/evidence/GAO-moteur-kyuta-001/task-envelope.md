# Agentic Task Envelope

## Task

- Task id: GAO-moteur-kyuta-001
- Request: Moteur Kyutai TTS 1.6B dans l'extension : serveur local sur carte AMD, voix françaises prénommées, galerie
- Owner agent: guilhem-bonnet
- Profile: controlled
- Current state: `executing`
- Risk level: `medium`

## Ambiguïtés résolues

Toute ambiguïté bloquante rencontrée pendant la tâche, et comment elle a été
résolue — par contexte vérifié (relecture, source faisant autorité) ou par
question ciblée posée au demandeur. Une hypothèse non vérifiée reste une
hypothèse, jamais un fait tant que la colonne « Source » ne le dit pas.

| Question posée | Résolution | Source (contexte vérifié / question ciblée / hypothèse) |
|---|---|---|
| Quelle voix d'abord, quel moteur ? | Kyutai TTS 1.6B, voix `cml-577_394` (Camille) en tête | Question ciblée : choix de guilhem-bonnet du 2026-11-06, transmis par le concierge |
| Le serveur écoute 127.0.0.1, or un port publié par Docker ne joint pas le 127.0.0.1 du conteneur | Défaut du serveur : 127.0.0.1. Dans le conteneur seul, `KYUTAI16_HOST=0.0.0.0`, et Docker ne publie que `127.0.0.1:8020` | Contexte vérifié : fonctionnement du réseau bridge ; écart signalé dans le rapport |
| `estelle` existe dans le catalogue Pocket et dans celui de 1.6B : comment distinguer les cartes ? | Identifiant de carte `kyutai16:<voix>`, identifiant de voix inchangé dans la configuration et sur le serveur | Contexte vérifié : `galleryModel.ts` indexe les cartes par id |
| Licences | CML-TTS CC BY 4.0, Estelle CC0 : donnée du brief. Poids du modèle CC-BY 4.0 lus dans le README du cache Hugging Face ; code moshi MIT lu dans `moshi-0.2.11.dist-info/METADATA` | Contexte vérifié (modèle, code) ; brief du concierge (voix) |

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Context bundle | _grimoire-output/context/GAO-moteur-kyuta-001/context-bundle.yaml | généré par le kit depuis le Mission Ledger | 2026-11-06 | n/a |

## Knowledge base usage

| Knowledge source | Query or index | Trust level | Used as source of truth? | Notes |
|---|---|---|---:|---|
|  |  |  | no |  |

## Memory usage

| Memory surface | Read/write | Purpose | Integrity check |
|---|---|---|---|
|  | read |  |  |

## Tool boundary

| Tool | Permission | Scope | Blast-radius limit |
|---|---|---|---|
| `npm --prefix vscode-extension run test:unit` | execute | tests du projet (gate run-tests) | racine du projet |
| typecheck, lint, build, `vscode-test --label fake-tts`, test:integration-voice, `package:linux-x64` | execute | vérification de l'extension | dossier `vscode-extension/`, aucun fichier utilisateur (`~/.llm-voice` non écrit, voix non changée) |
| `python3 deploy/kyutai16/test_server.py` | execute | serveur avec faux modèle sur un port éphémère | aucune charge GPU, aucun réseau hors boucle locale |
| `docker compose config`, `docker run` de l'image existante sans `/dev/kfd` ni `/dev/dri`, sans réseau | execute | valider le manifeste, Python 3.10 de l'image | aucun GPU, image non modifiée |

Hors périmètre de cette tranche : commit, push, avance de la carte, charge GPU (preuve audio réelle faite par le concierge).

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
|  |  |  |  |  |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | Brief du concierge du 2026-11-06 : serveur, service Docker à profil, provider réutilisé, catalogue à part, section de galerie ; hypothèses dans « Ambiguïtés résolues » | done |
| Implementation complete | Points 1 à 5 du brief livrés, voir evidence-pack.md | done, hors preuve audio réelle |
| Validation complete | Sorties dans evidence-pack.md ; AC-002, AC-003 et AC-004 restent à faire | partial |
| Deviations documented | Section « Deviations » d'evidence-pack.md | done |
