# Evidence Pack — GAO-adr-015-4-co-001 (ADR-015 étape 4, contrôleur de partition)

## Livrables

- `vscode-extension/src/direction/controller/fidelity.ts` : contrôles déterministes (nombres y compris en lettres FR/EN, versions, identifiants, négations à ±8 mots, chiffres absents de la source, équivalence lexicale du profil `faithful`). Réimplémentation de production de la logique du script de mesure du narrateur, sans import depuis `scripts/`.
- `vscode-extension/src/direction/controller/PartitionController.ts` : `PartitionController.check` (verdict) et `.run` (politique de renvois), `neutralPartitionForSource`.
- `vscode-extension/src/direction/controller/index.ts`.
- Tests : `vscode-extension/test/unit/direction/controller/{fidelity,partitionController,properties}.test.ts`, `helpers.ts`, `fixtures/trapped-texts.jsonl` (copie des 24 textes piégés du jeu de données du narrateur).
- `src/core/direction.ts` : non modifié.

## Commandes exécutées (sortie réelle)

| Commande | Résultat |
|---|---|
| `npm run test:unit` avant (début de tâche) | 87 fichiers, 1 127 tests verts |
| `npm run test:unit` après | 97 fichiers, 1 662 tests verts (dont 3 fichiers / 365 tests du contrôleur ; le reste vient des deux autres agents en parallèle) |
| `npm run typecheck` | sans erreur (après correction du TS2352 de `partitionController.test.ts` : narrowing `outcome.kind !== "neutral"` au lieu d'un cast) |
| `npm run lint` | `ESLint: No issues found` |
| Mutation manuelle (production modifiée puis restaurée) | 5 mutants tués : négations désactivées (32 échecs), chiffres inventés désactivés (53), locuteur inconnu ignoré (2), budget de renvois +1 (13), couverture désactivée (25) |

## Couverture des tests de l'ADR

- Test 7 (fidélité) : sur les 24 textes piégés — texte lu tel quel, forme orale (chiffres en lettres), nombre supprimé, nombre remplacé (perdu + inventé), chiffre inventé, négations supprimées, identifiants supprimés, paraphrase ; à travers `fidelity.ts` et à travers le contrôleur (profil normal et `faithful`).
- Test 10 (renvois et repli) : 1 appel si bon ; renvoi avec motifs par segment ; accepté au 2e renvoi ; au-delà, partition neutre (1 cue narrateur par segment, tempo 1, pauses 0, texte du segment) qui repasse elle-même le contrôleur ; budget configurable ; panne du metteur en scène, réponse non JSON, abandon (AbortSignal), fenêtre vide : jamais de blocage ni d'exception.
- Propriétés (10 graines) : la partition neutre est toujours acceptable ; toute réponse (déchets, valeurs extrêmes, locuteurs et ids inconnus) → aucune exception, verdict pur et déterministe, accepté ⇒ schéma + couverture + locuteurs connus + ids uniques + silences ≤ 3 000 ms + aucun chiffre hors source, rejeté ⇒ liste de renvoi exploitable ; un chiffre supprimé est toujours renvoyé ; un metteur en scène instable donne toujours une partition valide et complète en ≤ N+1 appels.

## Écarts avec l'ADR et limites (à trancher ou à savoir)

1. **Marge de longueur** : ADR §7 dit `spokenText` ≤ 2 × le segment ; le code applique 2 × + 40 caractères (`DEFAULT_LENGTH_SLACK_CHARS`), car « 0.3.1 » ou « 22 050 Hz » écrits en lettres multiplient un segment très court par plus de 2. Ratio et marge sont des options ; valeurs non mesurées.
2. **Cohérence bible** : « un locuteur garde sa voix » est rendu par `bibleIssues` (voix de la bible différente de `voicesInUse`, voix du narrateur réutilisée, rôle en double), signalées sans bloquer : un renvoi ne peut pas les corriger. Sont bloquants et renvoyés : locuteur inconnu, clé de voix/moteur émise par le metteur en scène (`voice-override`, ADR §5.1). `check` ne reçoit pas de voix par cue (la partition n'en porte pas).
3. **Repli** : toute la fenêtre passe en consignes neutres (ADR §2), pas seulement les segments fautifs.
4. **Bloc de code** (`type: "code"`) : couverture et chiffres inventés vérifiés, mais nombres/identifiants/négations non exigés mot à mot (hypothèse du contrôleur, absente de l'ADR).
5. **Limites connues de `fidelity.ts`** : nombre ≥ 1 million ou identifiant numérique long à garder en chiffres ; une date ISO dite avec un nom de mois est vue comme chiffre perdu (faux positif, coûte un renvoi puis repli) ; identifiants vérifiés par leurs parties alphabétiques ; négations : un mot-clé de négation dans ±8 mots et un nombre de négations non décroissant, sans analyse syntaxique ; les détails de violation citent la source (pour le renvoi) et ne doivent jamais être journalisés, `trace` et `bounds` ne portent que des compteurs.
6. **Manque dans `src/core/direction.ts`** : aucun bloquant. `DirectionIssueCode` est fermé, d'où un mapping local pour `BibleIssue`.
7. **Non vérifié** : aucun test d'intégration avec un vrai Ollama (mode jeu actif, hors périmètre) ; taux de faux positifs sur des sorties réelles du metteur en scène non mesuré.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
