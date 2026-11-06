# Revue Sentinel — ADR-013 (fournisseur de décision, mode « Auto »)

- **Relecteur** : Sentinel (agent-optimizer), contexte neuf, non auteur de l'ADR
- **Modèle** : Sonnet 5 (claude-sonnet-5)
- **Date** : 2026-09-27
- **Cible** : `docs/adr/ADR-013-decision-provider.md`

## Grille de relecture

### 1. Format et index README
**OK.** Sections Statut/Contexte/Décision/Conséquences/Alternatives rejetées/Plan de vérification présentes,
conformes au MADR annoncé par `docs/adr/README.md:3-4`. Ligne indexée dans le tableau
`docs/adr/README.md:19` avec statut « proposé » et pointeur vers le spike, cohérent avec
`ADR-013-decision-provider.md:3-7`.

### 2. Fidélité à la décision du journal
**OK.** Chaque clause de `decisions-log.md:158-163` est reprise sans déformation : SemIf sur
`/api/generate` natif (`ADR-013:27-33` vs `decisions-log.md:160`), Laya en réserve conditionnée à un
témoin à règles (`ADR-013:34-35, 426-428` vs `decisions-log.md:160`), Kev/Nimble/NanoJev/OpenJev écartés
(`ADR-013:348-349`), Jev cloud jamais par défaut (`ADR-013:36-37, 342-344`), repli `profiles.bySource`
(`ADR-013:160, 291-296` vs `decisions-log.md:160` « sans Ollama, Auto se replie sur profiles.bySource »),
aucun code avant le spike (`ADR-013:456-458`), calendrier 0.4 après ADR-012 (`ADR-013:7, 461` vs
`decisions-log.md:162`).

### 3. Invariants P0
**OK, avec une réserve mineure.** Tableau dédié `ADR-013:391-397` traite les 5 invariants un à un.
Zéro autoplay : `decide()` n'est appelée que depuis `startInternal`, atteint uniquement par commande
utilisateur (`ADR-013:393`), cohérent avec le commentaire cité par `decision-points-map-v1.md:34-40`
(« zero autoplay: only ever reached from a command the user triggered »). Passage obligatoire par
EgressGuard : `ADR-013:248-255` (`egress.fetch` uniquement, `EgressDeniedError` → dégradé sans octet émis),
conforme au point de passage unique d'ADR-010 (`ADR-010-egress-guard.md:18-32`). Réserve : le diagramme
de séquence (`ADR-013:361-386`) ne montre pas explicitement le refus de `EgressGuard` avant l'appel réseau
lui-même (la branche `else` mélange refus réseau et sortie inexploitable) — lisible mais un peu elliptique,
non bloquant car le texte au-dessus (§ Réseau) est sans ambiguïté.

### 4. Cohérence `DecisionProvider` / `NarratorProvider`
**OK.** Le contrat calque explicitement `NarratorProvider` (`ADR-013:105` « Calqué sur
`NarrationDegradedReason`… ») : jamais de rejet (`ADR-013:146` vs `narration.ts:70` « Must resolve with
`degraded: true` rather than reject »), `health()` (`ADR-013:144, 171-172` vs `narration.ts:66`),
`getCapabilities()` — l'ADR note lui-même la différence assumée : obligatoire ici contre optionnel chez
`NarratorProvider` (`ADR-013:167-169` vs `narration.ts:67-69`), justifiée par le besoin de connaître
`calibratedProbabilities` avant tout usage. Écart intentionnel et documenté, pas une incohérence.

### 5. Traitement des logprobs
**OK.** Renormalisation sur les lettres autorisées : agrégation par variantes normalisées puis division
par la masse totale (`ADR-013:218-222`), avec test dédié prévu (« somme = 1 à 1e-9 près », `ADR-013:470-471`).
Lettre manquante du top-k : `P = 0`, listée dans `missingOptionIds`, justification écrite de pourquoi
l'argmax reste correct et pourquoi un tirage uniforme de la masse résiduelle est rejeté (`ADR-013:223-228`).
Distribution = classement, pas confiance calibrée : affirmé au moins trois fois de façon cohérente
(`ADR-013:42-43`, `136`, `257-262`, `calibratedProbabilities: false` dans le contrat `ADR-013:136`) et
répercuté dans l'UI (« n'affiche aucun pourcentage », `ADR-013:259-260`).

### 6. Pseudo-profil « Auto » vs `VoiceProfileSchema`
**À corriger (documentation seulement, pas la décision).** Le choix « id réservé, jamais un champ » est
tranché et justifié (`ADR-013:280-282, 315-322`), et l'argument contre l'option « champ » est concret
(`tts`, `chunking`, `playback`, `mode`, `language` non falsifiables, `ADR-013:317-319`) — cohérent avec
`VoiceProfileObjectSchema` lu directement (`vscode-extension/src/core/profile.schema.ts:123-136`, ces
cinq champs bien non optionnels sauf `language`/`mode` qui sont requis aussi). Point non couvert : l'ADR
affirme que `profile.schema.ts` **exporte déjà** `RESERVED_PROFILE_IDS` (`ADR-013:288`) au présent de
l'indicatif (« ensemble `RESERVED_PROFILE_IDS` exporté par `profile.schema.ts` ») alors que ce fichier, lu
dans cette revue, ne contient aujourd'hui aucun symbole de ce nom (`profile.schema.ts:1-180`, recherche
négative) ni aucun refus de `id: "auto"` — `VoiceProfileObjectSchema.id` est un simple
`z.string().min(1)` (`profile.schema.ts:124`) et `ProfileCollectionSchema.defaultProfileId` de même
(`profile.schema.ts:177`). Ce n'est pas un défaut de la décision (l'ADR est proposé, pas encore
implémenté, et le plan de vérification prévoit bien le test de refus, `ADR-013:492-493`) mais une phrase
au mauvais temps qui laisse croire que le garde-fou existe déjà en code. De même, `schemaVersion` est
aujourd'hui `z.union([z.literal(1), z.literal(2)])` (`profile.schema.ts:176`) : le passage à `3` annoncé
(`ADR-013:309`) est cohérent avec un futur travail, mais l'ADR devrait dire explicitement « à créer »
plutôt que de citer le nom comme s'il existait déjà.

### 7. Plan de vérification
**OK.** Condition d'entrée explicite et vérifiable : le spike `GAO-spike-valuat-001` doit battre un témoin
à règles sur 50 réponses étiquetées, sinon amendement avant tout code (`ADR-013:452-458`). Tests nommés en
détail (charge utile, renormalisation, lettre absente, égalité, dégradation par cause, egress refusé,
troncature, journal, fabrique, schéma, résolution — `ADR-013:463-495`) et intégration (`ADR-013:497-501`).
Cohérent avec le format « tests qui prouvent la décision » annoncé par `docs/adr/README.md:3-4`.

### 8. Affirmations non sourcées ou chiffres sans preuve
L'ADR est exemplaire sur ce point : il marque lui-même chaque valeur non mesurée — seuil `optionMass` 0,5
« non mesuré » (`ADR-013:230`), troncatures 1 500/500/300-500 caractères « non mesurées »
(`ADR-013:239-240`), `maxInputChars` 4000 « proposés » (`ADR-013:242`), `timeoutMs` 3000 ms « non mesuré »
(`ADR-013:332`), plafond serveur de `top_logprobs` et forme exacte des champs « non vérifiés »
(`ADR-013:205-207`), version minimale d'Ollama exposant `logprobs` « pas vérifiée » (`ADR-013:234-235`),
format filaire de Jev « pas vérifié » (`ADR-013:350`), latence réelle « non mesurée » (`ADR-013:408`). Une
seule affirmation chiffrée présentée sans réserve explicite : « Un modèle de 1,5–7 B à `temperature 0`
rend des distributions quasi dégénérées (`1.000/0/0` le 2026-09-27) » (`ADR-013:258-259`) — la preuve du
2026-09-27 porte sur `qwen2.5:3b` uniquement (`decisions-log.md:159`, `ADR-013:32-33`) ; la généralisation
implicite à toute la plage « 1,5–7 B » n'est pas sourcée par un test sur une autre taille de modèle. Écart
mineur de formulation, sans conséquence sur la décision (le §5/§6 ci-dessus traitent déjà la distribution
comme un classement, pas une confiance).

## Corrections bloquantes

Aucune. Rien dans cette grille n'empêche d'accepter l'ADR en l'état de proposition (condition d'entrée =
spike, pas de code produit).

## Suggestions (non bloquantes)

1. `ADR-013:288` : reformuler « ensemble `RESERVED_PROFILE_IDS` exporté par `profile.schema.ts` » en
   « … à exporter » — ce symbole n'existe pas encore dans `vscode-extension/src/core/profile.schema.ts`
   (vérifié par lecture directe le 2026-09-27).
2. `ADR-013:258-259` : nuancer la généralisation « 1,5–7 B » à la seule preuve disponible (`qwen2.5:3b`),
   ou marquer explicitement le reste de la plage comme non testé, dans le même style que les autres
   réserves du document.
3. Diagramme de séquence (`ADR-013:361-386`) : distinguer visuellement le refus `EgressGuard` (avant tout
   octet émis) de la sortie Ollama inexploitable, pour éviter toute lecture rapide qui les confondrait.

## Verdict final

**ACCEPTER AVEC CORRECTIONS MINEURES** — les trois suggestions ci-dessus sont des corrections de
formulation (temps verbal, portée d'une preuve, lisibilité d'un diagramme), aucune ne touche la décision
elle-même, le contrat, les invariants P0 ou le plan de vérification.
