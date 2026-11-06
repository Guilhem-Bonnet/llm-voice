# Agentic Evidence Pack

## Summary

- Task id: GAO-kyutai-tts-c-001
- Profile: controlled
- Outcome: `docs/adr/ADR-016-kyutai-tts-provider.md` rédigé, statut **Proposé** : Kyutai Pocket TTS (`kyutai-pocket`, CPU, clonage) et Kyutai TTS 1.6B (`kyutai-dsm`, GPU, flux) ajoutés comme paliers **opt-in** derrière `TtsProvider` ; Chatterbox et Kokoro/Piper inchangés ; Gradium et Moshi écartés.
- Final state: ADR mis à jour par l'orchestrateur le 2026-11-05 avec la recherche web réellement faite (ci-dessous) : V1, V2 (code/poids) et V3 levées ; V4 (VRAM 1.6B), V5 (sherpa-onnx), V6 (ROCm), V7 (protocole serveur 1.6B) restent ouvertes, documentées comme risques R3/R5/R8. Reste à faire : relecture indépendante (Sentinel) et gate `--strict`.

## Recherche web effectivement faite (orchestrateur, 2026-11-05)

| # | Outil / requête | Page lue | Résultat clé | Remplace / confirme |
|---|---|---|---|---|
| 1 | `WebSearch` « Kyutai Pocket TTS french language support license » | tts.ai (agrégateur tiers, non officiel) | FR annoncé, licence MIT alléguée | signal faible, remplacé par #4 (officiel) |
| 2 | `WebSearch` « kyutai-labs delayed-streams-modeling TTS 1.6B voice cloning word timestamps license » | kyutai.org/next/tts (page marketing, résumé moteur de recherche) | affirmait clonage 10s + word-timing — **contredit par la lecture directe (#3)** | **invalidé** |
| 3 | Agent `web-fetch`, lecture directe `huggingface.co/kyutai/tts-1.6b-en_fr` + README `delayed-streams-modeling` (kyutai.org/next/tts inaccessible, rendu JS) | model card (HF) | « nous avons préféré restreindre le clonage vocal à l'usage d'embeddings de voix pré-calculés » ; aucun word-timing en sortie TTS ; poids CC-BY-4.0 ; code MIT/Apache ; 1,8 Md param réels ; débit 75× ; VRAM non publiée | **source d'autorité retenue** — confirme S1, infirme #2 |
| 4 | Agent `web-fetch`, lecture directe `github.com/kyutai-labs/pocket-tts` (README) + `huggingface.co/kyutai/pocket-tts` | model card (HF) | langues « english, french, german, portuguese, italian, spanish » (+dutch) ; clonage confirmé via wav arbitraire, consentement requis ; pas de word-timing officiel (fork tiers non maintenu) ; code MIT, poids CC-BY-4.0, accès gated ; 100M param, CPU seul, port 8000 | **source d'autorité retenue** — confirme S2, lève R1 |
| 5 | `WebSearch` « huggingface kyutai/tts-1.6b-en_fr model card license CC-BY VRAM » | plusieurs pages (HF, miroirs) | licence CC-BY-4.0 confirmée ; 1,8B param (pas 1,6B) ; aucune VRAM d'inférence trouvée | confirme #3 |
| 6 | `WebSearch` « kyutai TTS 1.6B GPU requirements VRAM ROCm AMD » | guide tiers Libre WebUI (non officiel) | ordre de grandeur non officiel : 6 Go VRAM mini, 8 Go+ recommandé, CUDA > MPS > CPU, **aucune mention ROCm** | signal faible, non retenu comme source d'autorité (R5 reste ouvert) ; absence de ROCm cohérente avec #3/#9 |

**Conclusion de la recherche** : l'hypothèse initiale de la carte (un modèle Kyutai cumulant clonage libre et horodatage par mot) est **infirmée** par les pages officielles — aucun des deux modèles ne fait les deux. Le français de Pocket TTS est **confirmé officiellement** (R1 fermé). Les licences de code et de poids sont **confirmées officiellement** pour les deux modèles, et désormais aussi les licences par voix du catalogue `tts-voices` (R2 **fermé intégralement**, confirme S3 sans écart). VRAM du 1.6B et support ROCm restent **non documentés officiellement** (R3, R5 ouverts).

## Recherche complémentaire (orchestrateur, 2026-11-05, 2e passe)

| # | Outil / requête | Page lue | Résultat clé |
|---|---|---|---|
| 7 | `WebSearch` « huggingface kyutai/tts-voices license CC-BY-NC Expresso EARS VCTK CML-TTS CC0 Unmute » | `huggingface.co/kyutai/tts-voices`, `kyutai.org` (Terms of Use Unmute) | Confirme exactement S3 par dossier : CC-BY-NC (Expresso, EARS), CC-BY-4.0 (VCTK, CML-TTS FR), CC0 (dons Unmute) → **R2 fermé intégralement** |
| 8 | `WebSearch` « sherpa-onnx PocketTTS french voice cloning support » puis agent `web-fetch` sur `k2-fsa.github.io/sherpa/onnx/javascript-api/examples/tts_pocket.html` | doc officielle sherpa-onnx (lue intégralement) | Clonage **confirmé** (`referenceAudio`) ; **français non confirmé** pour le paquet `sherpa-onnx-pocket-tts-int8-2026-01-26` (aucune langue/taille documentée, seule démo publique liée étiquetée « English ») → **nouveau risque R9**, V5 partiellement levée seulement |

Conséquence sur l'ADR : la « voie cible » §2 (sherpa-onnx dans le Core, sans Python) n'est validée pour le français qu'après un test concret du paquet sherpa-onnx packagé (R9) ; en attendant, la voie intermédiaire (`pocket-tts serve`) reste le chemin français prouvé.

## Recherche demandée : ce qui a réellement été fait

| Question de la carte | Requête web faite ? | Source effectivement utilisée | Résultat | Statut |
|---|---|---|---|---|
| (a) Français de Pocket TTS | **non** | `moteurs-expressifs.md` (2026-09-29), citant `github.com/kyutai-labs/pocket-tts` | FR annoncé avec EN, DE, IT, ES, PT | **contesté** : l'auteur se souvient d'une sortie initiale anglais seul (non sourcé) → risque R1, vérif V1 |
| (a) Français de TTS 1.6B | **non** | `moteurs-expressifs.md`, citant `huggingface.co/kyutai/tts-1.6b-en_fr` ; `tts-locaux.md` (2026-09-27) | FR + EN natifs | cohérent entre deux notes ; page non relue |
| (b) Licence Pocket TTS | **non** | `moteurs-expressifs.md`, `voix-de-reference.md` | code MIT, poids CC-BY-4.0, licence par voix (CC-BY-NC Expresso/EARS, CC-BY VCTK/CML-TTS, CC0 dons Unmute) | page non relue ; conditions d'accès au modèle de clonage non lues (R2) |
| (b) Licence TTS 1.6B | **non** | `moteurs-expressifs.md` | poids CC-BY-4.0 | licence du code `delayed-streams-modeling` : « gap » dans `tts-locaux.md` ; MIT/Apache selon l'auteur, non sourcé (R2) |
| (c) Taille / VRAM / CPU | **non** | `moteurs-expressifs.md`, `tts-locaux.md` | Pocket ~100 M param., ~6× temps réel CPU (M4), ~200 ms 1er chunk ; 1.6B : 1,6 Md param., ~200–220 ms et 32 flux < 350 ms sur L40 (source tierce) | VRAM 1.6B non chiffrée ; ≈ 3,2 Go de poids en bf16 = calcul de l'auteur, non mesuré (R5) ; ROCm non documenté (R3) |
| (d) Clonage + horodatage par mot natifs | **non** | `moteurs-expressifs.md` | 1.6B : clonage arbitraire **bloqué** (embeddings pré-calculés) ; Pocket : clonage **oui** | horodatage par mot : 1.6B non sourcé (connaissance de l'auteur), Pocket non documenté (R4). **L'hypothèse « clonage + word-timing natifs sur un même modèle » n'est pas confirmée.** |

Requêtes et pages à exécuter par l'orchestrateur ou un agent doté d'un outil web (grille V1–V8 de l'ADR) :
`https://github.com/kyutai-labs/pocket-tts` (README, LICENSE), `https://huggingface.co/kyutai/pocket-tts`,
`https://huggingface.co/kyutai/tts-1.6b-en_fr`, `https://github.com/kyutai-labs/delayed-streams-modeling` (README, LICENSE, doc serveur),
`https://huggingface.co/kyutai/tts-voices`, doc sherpa-onnx PocketTTS.

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Enveloppe de tâche | `_grimoire-output/evidence/GAO-kyutai-tts-c-001/task-envelope.md` | orchestrateur | présente avant toute écriture (lue en premier) |
| ADR-016 | `docs/adr/ADR-016-kyutai-tts-provider.md` | platform-architect | écrit : statut + avertissement de vérification, contexte (4 sous-sections, tableau de propriétés sourcé), décision (7 sous-sections, diagramme Mermaid, tableau P0), conséquences, alternatives rejetées, risques R1–R8, tests (V1–V8 + tests de code), sources S1–S6 + K |

### Fichiers lus (en entier sauf mention)

- `_grimoire/kit/agents/platform-architect.md`, `_grimoire/_memory/shared-context.md`, `task-envelope.md` de la carte
- `docs/adr/README.md`, `ADR-002`, `ADR-005`, `ADR-009`, `ADR-012`, `ADR-013` ; `ADR-010` (lignes 1–60) ; `ADR-015` (lignes 1–80)
- `vscode-extension/src/core/tts.ts` (contrat `TtsProvider`, absence de champ d'horodatage dans `AudioResult`) ; liste des fichiers de `src/tts/` et `src/core/` (Glob)
- `_grimoire-output/research/research_notes/Briques existantes pour LLM Voice/tts-locaux.md`
- `_grimoire-output/research/research_notes/Direction de lecture expressive/moteurs-expressifs.md` et `voix-de-reference.md`
- `_grimoire-output/research/reports/Moteurs expressifs et voix de référence.md`
- `_grimoire-output/evidence/GAO-adr-013-four-001/evidence-pack.md` (gabarit)

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Choix tranchés dans l'ADR

1. Kyutai = **paliers opt-in**, aucun défaut modifié ; Chatterbox reste principal, Kokoro/Piper repli.
2. `kyutai-pocket` : voie cible = sherpa-onnx dans le Core (ADR-012 étape 2, sans Python) ; voie intermédiaire = adaptateur HTTP vers `pocket-tts serve` en réglage avancé.
3. `kyutai-dsm` : serveur local GPU ; **prérequis** : extension d'`EgressGuard` aux WebSocket + règle ESLint sur `new WebSocket` ; `usesGpu: true` (mode jeu → repli CPU).
4. Catalogue de voix par défaut limité à CC0 et CC-BY, avec fichier d'attribution ; CC-BY-NC exclues.
5. Horodatage par mot : contrat renvoyé à l'ADR séparé annoncé par ADR-002 ; les adaptateurs conservent les horodatages reçus sans les annoncer avant ce contrat.
6. Gradium : ni défaut ni palier ; seulement un futur niveau 3 sous ADR distinct et règles d'ADR-013 §6. Moshi complet écarté.
7. Acceptation conditionnée à la grille V1–V8 vérifiée sur pages primaires.

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Recherche web (V1–V3) | `WebSearch` ×4 + agent `web-fetch` ×2 sur pages primaires HF/GitHub (2026-11-05) | **faite** | V1, V2 (code/poids), V3 levées ; détail ci-dessus |
| Recherche web (V4–V7) | — | **non faite** | VRAM 1.6B, sherpa-onnx, ROCm, protocole serveur restent sans donnée officielle — R3/R5/R8 ouverts, non bloquants pour le statut Proposé |
| Relecture de cohérence ADR ↔ notes de veille | lecture manuelle par l'auteur | faite | pas une vérification indépendante |
| Vérification indépendante (Sentinel, `agent-optimizer`) | agent distinct, contexte neuf, lecture directe de l'ADR + pack + ADR-010 + shared-context.md | **faite (2026-11-05)** | Verdict : aucun point rédhibitoire, ADR peut rester Proposé ; 1 incohérence mineure corrigée (bandeau R2), 2 points mineurs notés (V5/V7 non vérifiées avant implémentation, fraîcheur inégale de S3) |
| Gate | `grimoire standard gate check --task-id GAO-kyutai-tts-c-001 --strict` | à exécuter ci-dessous | — |
| Rendu Mermaid | — | non vérifié | signalé explicitement dans l'ADR comme non bloquant |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | yes | écritures limitées à `docs/adr/ADR-016-*.md` et à ce dossier de preuve ; aucun code TypeScript touché | index `docs/adr/README.md` non mis à jour (hors périmètre d'écriture de l'enveloppe) ; `decisions-log.md` laissé à l'orchestrateur |
| Quality | partial | risques R1–R8 et grille V1–V8 explicites | aucune affirmation Kyutai relue sur page primaire |
| Runtime | no | — | rien exécuté |
| Knowledge | partial | notes de veille du projet avec URL primaires | recherche web de la carte non faite ; connaissance de l'auteur marquée « non sourcé » |
| Model/provider | yes | ADR rédigé par platform-architect | — |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Recherche web non faite ; ADR fondé sur la veille du 2026-09-27/29 | le critère « cite des sources vérifiées » n'est **pas** rempli au sens strict | à décider par l'orchestrateur / l'utilisateur | exécution de V1–V7 |
| Section « Risques » et « Sources de vérification » ajoutées au format MADR court du README | conforme au brief | vérificateur | relecture |
| Le hook PostToolUse demande d'ajouter la preuve à `_grimoire-output/evidence/GAO-orchestratio-001/evidence-pack.md` | non fait : hors périmètre de la carte | orchestrateur | — |

## Completion statement

Livrable écrit ; la carte n'est pas complète : recherche web V1–V7, relecture indépendante et gate `--strict` restent à faire.
