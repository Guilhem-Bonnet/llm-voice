# Agentic Evidence Pack

## Summary

- Task id: GAO-adr-015-dire-001
- Profile: controlled
- Outcome: ADR-015 « Direction de lecture : partition par segment, distribution des voix et mémoire (« bible ») » rédigé, statut **Proposé (2026-09-29), à valider par guilhem-bonnet** ; index `docs/adr/README.md` mis à jour. Section « moteur à consignes » (§5.5) complétée en cours de tâche d'après la veille `GAO-veille-moteu-001` (message du concierge), choix du moteur laissé ouvert jusqu'au banc d'une journée.
- Final state: écrit par l'auteur, **non vérifié par un tiers**. Aucun fichier de code modifié, aucun commit, aucune commande exécutée (pas de Bash dans la frontière d'outils de platform-architect).

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Enveloppe (écrite avant l'ADR) | `_grimoire-output/evidence/GAO-adr-015-dire-001/task-envelope.md` | platform-architect (Opus) | écrite |
| ADR-015 | `docs/adr/ADR-015-reading-direction.md` | platform-architect (Opus) | statut ; contexte (demande, code actuel, mesures, contraintes, prior art) ; décision en 11 sous-sections (vue d'ensemble Mermaid, 5 rôles + `DirectionProvider`, schéma de partition, schéma de bible + portées + stockage, traduction par capacités + table moteurs + bibliothèque de voix + silences + §5.5 moteur à consignes, texte sonore, garde-fous, latence/cache/« Préparer » + séquence Mermaid, compatibilité ascendante, invariants P0, emplacement du code) ; ce qui reste ouvert (8 points) ; conséquences ; 9 alternatives rejetées ; 13 tests automatisables + écoute A/B ; plan de livraison (étapes 0 à 9, 1 bis, 1 ter, Core 1.1 conditionnel) |
| Index des ADR | `docs/adr/README.md` | platform-architect | ligne ADR-015 ; phrase de statut ; mention « aucun fichier ADR-014 dans ce dossier » |
| Context bundle | `grimoire task context GAO-adr-015-dire-001` | à exécuter par le concierge | non exécuté |
| Decision trace | `grimoire standard decision trace --task-id GAO-adr-015-dire-001` | à exécuter par le concierge | non exécuté |

### Fichiers lus

- `_grimoire/kit/agents/platform-architect.md`, `_grimoire/kit/framework/agent-base-compact.md`
- `_grimoire/_memory/shared-context.md`
- `docs/adr/README.md`, `ADR-004`, `ADR-005`, `ADR-009`, `ADR-012`, `ADR-013` (en entier)
- `vscode-extension/src/narrator/narrationContract.ts`, `src/core/narration.ts`, `src/core/tts.ts` (en entier)
- `vscode-extension/src/tts/ChatterboxProvider.ts` (en entier), `SystemTtsProvider.ts` (lignes 1-320)
- `contracts/core-v1/common.schema.json`, `http/enqueue.request.schema.json`, `examples/valid/health.response.json`
- `_grimoire-output/evidence/GAO-valuation-f-001/evidence-pack.md`, `GAO-valuation-m-001/evidence-pack.md`
- `_grimoire-output/evidence/GAO-adr-012-lect-001/` (enveloppe, pack, claim-ledger : gabarit)
- `scripts/audio-proof/README.md`
- `_grimoire-output/research/research_notes/Direction de lecture expressive/moteurs-expressifs.md`, `voix-de-reference.md` (veille, reçues en cours de tâche)

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Choix tranchés dans l'ADR (au-delà du brief)

1. La direction est une étape **après** la narration : le narrateur décide quoi dire, la direction qui et comment ; le metteur en scène ne paraphrase pas (forme orale seulement).
2. Contrat `DirectionProvider` (`analyze`, `direct`, jamais de rejet) dans `src/core/direction.ts` ; première implémentation Ollama `/api/chat` + `format`.
3. Choix de voix d'un personnage = décision fermée par le `DecisionProvider` d'ADR-013 parmi les voix candidates filtrées par code ; la voix du narrateur est exclue des candidats.
4. Bible = journal d'événements en ajout seul ; précédence document > série > utilisateur, mais un fait `user`/`locked` n'est jamais remplacé par un fait LLM ; portée implicite `source:<id>` pour l'inbox ; sélection et presse-papiers non persistés.
5. Stockage sous `globalStorageUri/direction/`, **hors** `cache/` (ADR-004 §2 : le cache ne contient que de l'audio).
6. `TtsCapabilities.direction` optionnel (additif) ; projection linéaire d'étalonnage déclarée par le provider — pas de détection par id.
7. Pauses exactes par **segments de silence** mis en file avec l'`enqueue` existant du Core v1 : aucun changement de protocole ; coupe des silences de bord et fondus laissés ouverts (Core 1.1 conditionnel).
8. Valeurs hors bornes **ramenées** dans la borne et comptées, pas rejetées.
9. Direction désactivée par défaut jusqu'au verdict de l'écoute A/B ; consigne neutre = `TtsRequest` d'aujourd'hui au champ près.
10. Veille intégrée : shortlist Qwen3-TTS 1,7 B / Fish S2 Pro (qualité seule) / Pocket TTS, témoin Chatterbox, réserve CosyVoice 3 ; règle de décision du banc = meilleur respect de consigne avec ROCm fonctionnel ; moteur à consignes = palier Python optionnel en boucle locale.

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Relecture indépendante | agent-optimizer (Sonnet, contexte neuf) | **non faite** | à dispatcher par le concierge |
| Gate strict | `grimoire standard gate check --task-id GAO-adr-015-dire-001 --strict` | **non exécuté** | pas de Bash pour cet agent |
| Standard | `grimoire standard verify .` | **non exécuté** | idem |
| Lint Markdown | diagnostics de l'IDE remontés par le hook après écriture | avertissements MD060 seulement (style des lignes séparatrices `|---|`, même style que les ADR existants) | aucune erreur signalée |
| Rendu Mermaid | — | non vérifié | mention dans l'ADR sous chaque diagramme |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | yes | carte ledger ; statut Proposé ; décision laissée à guilhem-bonnet | validation utilisateur à obtenir |
| Quality | partial | auto-relecture ; non-vérifiés marqués | relecture indépendante à faire |
| Runtime | no | ADR seul | tests portés par les cartes du plan |
| Knowledge | yes | faits cités avec leur fichier source ; réserves de la veille reprises | prior art hors veille = connaissance générale, marqué non vérifié |
| Model/provider | yes | Opus rédaction | vérification Sonnet à dispatcher |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Brief initial : section « moteur à consignes » marquée EN ATTENTE ; message du concierge en cours de tâche : la compléter d'après la veille. Fait (§5.5, §5.3, ouvert n°1, étapes 1 bis, 1 ter, 9, test 13) | l'ADR ne contient plus « EN ATTENTE » ; le choix du moteur reste ouvert | platform-architect sur instruction du concierge | résultat du banc 1 bis → amendement |
| Aucune commande grimoire exécutée (frontière read/edit) | context bundle, decision trace et gate absents tant que le concierge ne les lance pas | concierge (brief) | avant `needs_verification` |
| Valeurs proposées non mesurées : K/W/L/N, budget 1,5 s, ratio de longueur 2×, tolérance pauses 40 ms, critère A/B 7/10, plafond `exaggeration` | marquées « non mesuré » dans l'ADR | platform-architect | étapes 5 et 6 |
| Faits de la veille non revérifiés par l'auteur (licences, latences éditeur, ROCm, qualité FR) | repris avec leurs réserves | platform-architect | banc 1 bis ; lecture des cartes HF |
| Numéro ADR-014 absent du dossier `docs/adr/` | aucun ; signalé dans le README | platform-architect | si un ADR-014 existe ailleurs, corriger l'index |
| Hooks « bootstrap » (preuve à ajouter à `evidence/bootstrap/`) ignorés | aucun | brief du concierge | — |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.

## Relecture indépendante (Sentinel, agent-optimizer, 2026-09-29)

Lu en entier : ADR-015, `shared-context.md`, `narrationContract.ts`. Lu par recoupement ciblé (grep, pas en entier) : ADR-013, evidence packs `GAO-valuation-f-001` et `-m-001`, notes de veille. **ADR-005 et ADR-012 : non relus ici** (cohérence jugée sur leur citation dans ADR-015 seulement, non vérifiée). Aucune commande d'exécution, rendu Mermaid non vérifié.

**Verdict : ACCEPTER AVEC CORRECTIONS** (3 bloquantes, quelques non bloquantes).

### Couverture de la demande (L28-42)
- Traités : pas de règles codées (L165-167, L732-736), consigne par segment via LLM (§2-3), partition + `spokenText`/`direction` (L254-260), mémoire des personnages (bible, traits/états, L330-345), narrateur exclu des voix de personnages (L562), même chemin pour les trois genres (L162-164, test 8).
- Écart non déclaré : « un LLM qui connaît tout le contexte » devient fenêtre W/K/L + bible (L601-604) ; compromis raisonnable mais à énoncer comme tel.
- Garde-fous L551-568 : de vraies bornes (plages, plafonds, anti-injection) ; seules réserves douces : `nonverbal` = vocabulaire fermé (L240), projection « linéaire » (L414-418, défendable comme étalonnage). Rien n'encadre le contenu des prompts analyste/metteur en scène, où les règles de style peuvent se réfugier : à interdire par principe.

### Corrections bloquantes
1. **Mode jeu (gpu-yield) ignoré** (L620-623, L563-564). Le pack `GAO-valuation-f-001` (l. 32) montre que le mode jeu a rendu les latences inexploitables (p50 7b 27 s contre 7,5 s). L'ADR ne cite que la contention Ollama/Chatterbox. Ajouter : comportement de la direction (suspendue, consignes neutres, pas de blocage de file) quand le mode jeu est actif, et test associé.
2. **Portée d'écriture des faits proposés par le LLM** non définie (L339-345, L351-359). La conséquence « pire cas = jeu étrange sur ce document » (L725-728) n'est vraie que si les faits LLM ne vont que dans la portée `document`. Sinon un texte hostile empoisonne `series`/`user` durablement. Préciser : faits LLM en `document` seulement, promotion par action utilisateur ; ajouter un test.
3. **Chiffres de fidélité durcis** (L70-75). « 80,6 à 97,2 % avec styles-v2 » cache que technical-teacher **baisse** (85,7 → 80,6 %, pack f-001 l. 71). « 55 à 89 % au départ » vient d'un baseline écrasé par erreur (l. 73-75) ; l'invention « 22 050 Hz » vient d'une première passe **non conservée** (l. 38) : non reproductible. Reformuler avec ces réserves.

### Non bloquantes
4. Latence : budget d'attente 1,5 s (L564) face à ~3,6-4,9 s mesurés pour un appel narrateur (L80-81) ; la sortie du metteur en scène est plus riche. Préciser que 1,5 s vaut en régime établi, et poser un bilan débit (segments lus/s contre segments dirigés/s). Le chiffre 3,6-4,9 s est bien « mode jeu inactif » (pack f-001 l. 62), correct.
5. Choix de voix par `DecisionProvider` (L156-160) : le 75 % de `GAO-valuation-m-001` porte sur le choix de profil, pas de voix ; le dire (L78, L686-688). Rappeler IC ≈ ±12 points et jeu synthétique (pack m-001 l. 119-121). ADR-013 encore « Proposé » : dépendance à mentionner au statut.
6. Silences mis en file (L464-478) : comportement de Précédent/Suivant, du surlignage et des `sourceIds` sur un segment de silence non traité (voir aussi l'alignement des ids de segment avec le contrat du Core).
7. Bible persistante par défaut pour l'inbox `source:claude-code` (L352) : envisager l'opt-in ; « distribuées par l'extension » (L457) : préciser le mécanisme hors VSIX (téléchargement) pour P0 n°5.
8. Rétrocompat : cohérente avec `narrationContract.ts` (`{sourceIds, spokenText}` est bien un sous-ensemble, L633-636 ; schéma actuel sans `additionalProperties:false`, pas de conflit). Le test doré (test 2) est le bon garde-fou ; la compatibilité ADR-012/ADR-005 reste à confirmer sur les textes.
9. Faits de veille : repris avec réserves, conformes aux notes vérifiées (Chatterbox 0,25-2,0 / deux boutons / tokenizer, 228 voix, 20,9 %). « 97 ms », licences, Pocket TTS/M4 : non recoupés par moi.

### Lisibilité (~7 500 mots) : à déplacer en annexes, sans réécrire
- Schémas JSON complets L189-249 et L270-328 (garder 5 lignes de sémantique).
- §5.5 (table candidats + protocole du banc, L480-537) et bibliothèque de voix L431-462 : annexe « moteur et voix ».
- Diagramme de séquence L570-599 et détail des 13 tests L763-823 (garder un tableau test → invariant).
- Plan de livraison L825-844 : garder, il est court.
Noyau à valider en 10 minutes : Statut, demande, 5 rôles, garde-fous, compat, P0, ouvert, conséquences, alternatives.
