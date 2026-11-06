# Pack de preuve — GAO-kyutai-pocke-001

## Fichiers livrés

- `vscode-extension/src/tts/KyutaiPocketProvider.ts` (nouveau) — `TtsProvider`
  HTTP vers `pocket-tts serve` (ADR-016 §2, voie intermédiaire, opt-in).
- `vscode-extension/test/unit/tts/KyutaiPocketProvider.test.ts` (nouveau) —
  20 tests, convention `test/unit/tts/` (même emplacement que
  `ChatterboxProvider.test.ts`/`KokoroProvider.test.ts`/
  `OpenAICompatibleTtsProvider.test.ts`), fake HTTP local (`node:http` sur
  `127.0.0.1`, port éphémère) construit directement dans le fichier de test —
  aucun fichier partagé (`test/fakes/mockTtsServer.ts`) modifié.
- Aucun autre fichier de provider, profil par défaut ou `ProviderRegistry.ts`
  touché (voir « Décisions et écarts » ci-dessous).

## Commandes exécutées et résultats

### 1. Tests unitaires ciblés

```
cd /mnt/Travail/Projets/Dev/TTS-Voice/vscode-extension
npx vitest run --config vitest.config.ts test/unit/tts/KyutaiPocketProvider.test.ts
```

Résultat : `numTotalTests: 20, numPassedTests: 20, numFailedTests: 0, success: true`
(rapport JSON, `.vitest/json/output.json`, horodaté `startTime: 1793894586292`).

### 2. Suite complète (critère de sortie exact de la carte)

```
cd /mnt/Travail/Projets/Dev/TTS-Voice
npm --prefix vscode-extension run test:unit
```

Résultat :
```
Test Files  108 passed (108)
     Tests  1865 passed (1865)
  Duration  5.08s
```
Vert, zéro régression sur les 108 fichiers de test existants (exécuté deux
fois, résultat stable).

### 3. Vérification statique

```
cd /mnt/Travail/Projets/Dev/TTS-Voice/vscode-extension
npx tsc -p ./ --noEmit
```
→ `No errors found`.

```
npx eslint src/tts/KyutaiPocketProvider.ts test/unit/tts/KyutaiPocketProvider.test.ts --max-warnings=0
```
→ `No issues found` (y compris la règle qui interdit un `fetch` direct hors
`net/` : le provider n'appelle que `this.egress.fetch`).

### 4. Gate de la carte

`grimoire standard gate check --task-id GAO-kyutai-pocke-001 --strict` —
**non exécuté dans cette session** : la carte ne figurait pas encore dans le
Mission Ledger local sous cet id au moment du travail (seule
`task-envelope.md` existait) et aucun accès `grimoire task` n'a été fait ici.
À exécuter par l'orchestrateur avant `task close`.

## Correspondance avec les critères de sortie de l'enveloppe

| Critère (task-envelope.md) | Preuve |
|---|---|
| `test:unit` vert contre un fake HTTP (pas un serveur réel) | §1-2 ci-dessus ; fake `FakePocketServer` dans le fichier de test, contrat `GET /health` + `POST /tts` multipart |
| `AbortSignal` déjà avorté → `AbortError` sans requête réseau | Test « rejects immediately on an already-aborted signal, without any network request » : `rejects.toMatchObject({name: "AbortError"})` + `server.requests` reste vide |
| `health()` → `unreachable` si injoignable ou erreur, jamais faux `ok` | 4 tests `health()` : `{status:"healthy"}` → `ok` ; `{status:"starting"}` → `unreachable` ; HTTP 500 sur `/health` → `unreachable` ; port fermé (`127.0.0.1:1`) → `unreachable` |
| Aucune requête hors `127.0.0.1`/`trustedHosts` | 2 tests avec le vrai `EgressGuardHandle` (`createEgressGuard({mode: "local", ...})`, pas de fake) contre `http://example.com` : `synthesize()` rejette (`EgressDeniedError`, message `/denied/i`), `health()` répond `unreachable` sans lancer |
| `getCapabilities()` : pas d'horodatage par mot, `streaming: false`, pas de `direction` tant que le banc n'a rien mesuré | Test dédié : `streaming === false`, `capabilities.direction` est `undefined`, `languages` reflète exactement l'option du constructeur (jamais détecté) |

## Décisions et écarts pris pendant l'implémentation

1. **`presets.ts` / `ProviderRegistry.ts` non modifiés.** L'énoncé de la
   carte autorisait d'y toucher « seulement si c'est le seul moyen
   d'enregistrer le provider en opt-in » — aucun critère de sortie de
   `task-envelope.md` n'exige l'enregistrement dans un preset ou un profil
   par défaut (le périmètre outillé exclut explicitement « toute
   modification des défauts de profil »). `KyutaiPocketProvider` est donc
   livré comme classe autonome, instanciable directement
   (`new KyutaiPocketProvider({...})`), pas encore câblée dans
   `createTtsProvider`/`TTS_PROVIDER_PRESETS` — ce câblage, s'il est voulu,
   relève d'une carte séparée (UI de réglage avancé, ADR-016 §2).
2. **`voice_url` : toute valeur non vide est transmise telle quelle**, qu'elle
   « ressemble à une URL » (`http://`, `https://`, `hf://`) ou qu'elle
   provienne du catalogue statique (ex. `"alba"`) — les deux cas finissent
   par le même appel `form.append("voice_url", voice)`, il n'y a pas deux
   chemins de code différents (seulement deux cas testés séparément, cf.
   tests « forwards a voice-cloning reference URL » et « forwards a
   static-catalogue built-in voice name »). Une chaîne vide explicite est
   traitée comme une absence de voix (jamais envoyée).
3. **`voice_wav` n'est jamais construit** : ce provider n'a aucun chemin de
   téléversement de fichier local (contrairement à `ChatterboxProvider`).
   Un test vérifie explicitement que les seules clés envoyées au serveur
   sont `text` et, optionnellement, `voice_url`.
4. **Catalogue de voix statique réduit à une entrée** (`{id: "alba", label:
   "Alba"}`) avec un commentaire renvoyant à ADR-016 §4 pour le catalogue
   complet (licences par voix, attribution, voix françaises CML-TTS) — carte
   séparée, hors périmètre ici.

## `grimoire-uncertainties`

Voir le bloc dédié dans la réponse finale à l'agent appelant (format
`[{"where","what","why"}]`), puisque cette consigne (bloc en fin de réponse)
vient de l'orchestrateur et non de l'enveloppe de carte.

## Clarification de l'orchestrateur (2026-11-05)

L'incertitude de l'agent sur `voice_url="alba"` sans préfixe `http(s)://`/`hf://`
est **résolue, pas un bug** : la recherche directe du code source
`pocket_tts/main.py` faite avant cette carte (agent `web-fetch`, voir
`_grimoire-output/evidence/GAO-kyutai-pocke-001/task-envelope.md` et l'ADR-016
§2) avait établi que `voice_url` « accepte un nom de voix intégrée (ex.
`"alba"`, présent dans `_ORIGINS_OF_PREDEFINED_VOICES`), une URL `http://`,
`https://` ou `hf://`. Sinon, 400. » — le 400 ne frappe qu'un nom **non
reconnu** (ni préfixe valide, ni entrée du dictionnaire serveur des voix
prédéfinies), pas tout nom sans préfixe. `"alba"` est explicitement cité comme
exemple de nom reconnu dans cette source. Le choix de l'agent (un seul chemin
de code pour les deux cas) est donc correct **pour les entrées effectivement
présentes dans `_ORIGINS_OF_PREDEFINED_VOICES` côté serveur** — à vérifier
pour toute nouvelle entrée ajoutée au catalogue statique côté extension avant
de l'y ajouter (le nom doit exister côté serveur, sinon 400 réel).

## Relecture indépendante et contre-vérification (orchestrateur, 2026-11-05)

- **Sentinel (`agent-optimizer`, contexte neuf)** : **accepté, aucun point
  bloquant**. Vérification par lecture directe du code (lignes citées) pour
  les 7 points du brief de revue (contrat HTTP, EgressGuard, AbortSignal,
  health(), getCapabilities(), qualité des tests, point `voice_url`). Seule
  réserve : Sentinel n'avait pas Bash dans son rôle et n'a pas pu relancer
  `npm --prefix vscode-extension run test:unit` lui-même.
- **Contre-vérification de la suite complète par l'orchestrateur** (qui a
  Bash) : `npm --prefix vscode-extension run test:unit` ré-exécuté
  indépendamment le 2026-11-05 → **`Test Files 108 passed (108)` /
  `Tests 1865 passed (1865)`**, confirme exactement le résultat rapporté par
  l'auteur. Cette réserve de Sentinel est donc levée.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
