# Agentic Task Envelope

## Task

- Task id: GAO-refonte-ux-0-004
- Request: Refonte UX 04 · Modèle voix globale et modes : migration des profils et sélection unifiée
- Owner agent: guilhem-bonnet
- Profile: controlled
- Current state: `executing`
- Risk level: `medium`

## Objectif, périmètre, critères (écrit avant la première modification)

**Objectif utilisateur** : la voix choisie est celle qu'on entend, partout. Dans le code :
voix globale séparée du mode de lecture, migration sans perte des profils existants.

**Spécification** : `docs/adr/ADR-017-voice-and-reading-mode.md` (accepté), lignes rattachées à la
carte 0-004 du § « Découpe en étapes » et du § Tests. Relectures :
`_grimoire-output/reviews/GAO-refonte-ux-0-002/`.

**Dans le périmètre (vscode-extension/ seulement)** : `global-voice.json` ; migration avec sauvegarde ;
`voiceMigration` et `hidden` au schéma (schéma JSON régénéré) ; `voiceResolution.ts`
(`hasOwnVoice`, `withEffectiveVoice`, `describeVoice`) ; `resolveReading`, `listEffective` ;
`ttsInstanceKey` et clé de cache ; vitesse côté moteur ; `chooseVoice`, `chooseMode` ; alias masqués
(`setupVoice`, `browseVoices`, `selectProfile`) ; option « Voix globale » de l'éditeur intérimaire ;
« Voix propre : X » dans la vue ; réglages (`defaultProfile` retiré, `modes.bySource`,
dépréciations) ; profil de test `voice-chain` et script `test:integration-voice`.

**Hors périmètre** (autres cartes) : galerie (0-005), panneau et vitesse côté lecteur (0-007), barre
d'état et titres français (0-009), écran de réglages (1-002), accueil (1-001), retrait de
`llmVoice.ui.layout`. Pas de commit, push, stash, reset, checkout ; la carte ne change pas d'état.
Le vrai `~/.config/Code` n'est ni lu ni modifié. Pas de banc audio ni de charge GPU.

**Critères** :
- Causes A, B, C, D : test qui échoue d'abord (échec réel noté dans `evidence-pack.md`), vert ensuite.
- V1 à V7, V9 (cliquet), V10, V11 à V14, V16 à V19, parts 0-004 de V8 et V11 ; V15 préparée (banc lancé
  par le concierge).
- Migration sur copie figée de la configuration réelle : voix globale Estelle, tous les modes héritent,
  lecture via `bySource` claude-code vers `llm-summary` en Estelle, rejeu sans effet.
- Verts, sortie réelle au pack : `typecheck`, `lint`, `test:unit`, profil `fake-tts`,
  `test:integration-voice`, profils existants touchés.
- Garanties conservées : zéro lecture automatique, aucune donnée perdue, aucun appel réseau sortant,
  boutons de taille fixe, `textContent` seul, CSP stricte, pas de deux systèmes parallèles.

**Règle de contradiction** : entre un détail de l'ADR et le code réel, choisir le plus sûr pour les
données de l'utilisateur et le signaler.

## Ambiguïtés résolues

Toute ambiguïté bloquante rencontrée pendant la tâche, et comment elle a été
résolue — par contexte vérifié (relecture, source faisant autorité) ou par
question ciblée posée au demandeur. Une hypothèse non vérifiée reste une
hypothèse, jamais un fait tant que la colonne « Source » ne le dit pas.

| Question posée | Résolution | Source (contexte vérifié / question ciblée / hypothèse) |
|---|---|---|
| V6 dit « libellé et description d'origine à valeur JSON égale », §2 dit qu'ils changent s'ils sont encore d'origine | §2 appliqué : la description de `faithful-local` citerait un moteur qui n'est plus le sien ; un texte personnalisé reste égal ; la sauvegarde garde tout | contexte vérifié (ADR §2), à confirmer par le concierge |
| Un `tts: {}` sans marque ni voix : recalcul interdit (§2) ou fichier écrit sous la 0.3 ? | La sauvegarde tranche : `tts` antérieur non vide, voix système et message ; sinon lecture par les réglages, comportement de la 0.3 conservé | choix le plus sûr pour les données, signalé |
| Le niveau Piper nomme sa voix (§1.3), mais espeak-ng refuserait ce nom si Piper n'est pas installé | `SystemTtsProvider` n'envoie ce nom qu'au moteur Piper | code lu et test unitaire |
| « Échantillon livré et voix nommée » : la sortie du JSON égal laissait le mode source en voix propre | Comparaison sur la forme complétée des deux côtés | contexte vérifié par test |

## Context orchestration

| Context item | Source | Reason selected | Freshness | Token budget |
|---|---|---|---|---:|
| Context bundle | _grimoire-output/context/GAO-refonte-ux-0-004/context-bundle.yaml | généré par le kit depuis le Mission Ledger | 2026-11-06 | n/a |

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

## LLM routing

| Step | Provider | Model or capability | Fallback | Data policy |
|---|---|---|---|---|
|  |  |  |  |  |

## Evidence gates

| Gate | Required evidence | Status |
|---|---|---|
| Plan accepted or autonomous assumption recorded | ADR-017 accepté ; choix autonomes ci-dessus | done |
| Implementation complete | `evidence-pack.md`, § Vérifications de l'ADR | done, V15 préparée seulement |
| Validation complete | `evidence-pack.md`, § Validation | partielle : `check:vsix` rouge pour un binaire local, banc et gate non lancés |
| Deviations documented | `evidence-pack.md`, § Deviations | done |
