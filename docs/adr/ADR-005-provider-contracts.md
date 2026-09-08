# ADR-005 — Contrats de providers : TTS, narrateur, sources, réseau

- Statut : accepté
- Date : 2026-09-08
- Décideurs : Archie (platform-architect), sur cadrage D2/D9/D10
- Références : CdC §10, §20, §23, §28, §51, §52, §60-§62, §78 ; décisions D2, D8, D9, D10

## Contexte

Trois familles de composants remplaçables : d'où vient le texte
(`SourceAdapter`), comment il est reformulé (`NarratorProvider`), comment il
devient de l'audio (`TtsProvider`). Il faut un contrat qui couvre local,
entreprise et cloud (D9) sans trois implémentations, prépare le streaming de 0.2
(D2) et rende la garantie « rien ne sort » vérifiable plutôt que promise (D10).
Ces contrats vivent dans `src/core/` **sans aucun import de `vscode`** : c'est
ce qui les rend testables en pur Node et implémentables par un fake (§78).

## Décision

### `TtsProvider`

```ts
interface TtsProvider {
  readonly id: string;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  getCapabilities(signal?: AbortSignal): Promise<TtsCapabilities>;
  listVoices?(signal?: AbortSignal): Promise<Voice[]>;
  synthesize(req: TtsRequest, signal?: AbortSignal): Promise<AudioResult>;
  synthesizeStream?(req: TtsRequest, signal?: AbortSignal): AsyncIterable<AudioFrame>;
}
```
`getCapabilities()` remplace toute détection par `instanceof` ou par id :
`streaming: boolean` (le player 0.2 bascule sur Web Audio API pour les providers
qui l'annoncent **et** exposent `synthesizeStream`, D2), `voices` (alimente le
Quick Pick sans appel supplémentaire), `parameters: TtsParameterDescriptor[]`
(type, bornes et défaut de chaque réglage, ce qui permet de générer l'UI et le
JSON Schema des profils au lieu de les coder en dur), plus `formats`,
`languages`, `maxTextLength?`. `synthesizeStream` est **optionnel** : aucun
provider ne l'implémente en 0.1, l'appelant ne le présume jamais.

### `NarratorProvider`

`transform(request, signal?): Promise<NarrationResult>`.

- **Structured output** : la requête porte un nom de contrat
  (`narration-segments`), le provider demande une sortie JSON conforme (`format`
  d'Ollama, `response_format` OpenAI), revalidée côté extension : un modèle qui
  promet du JSON n'en produit pas toujours.
- **Mode dégradé obligatoire** : narrateur injoignable, budget dépassé,
  annulation ou JSON invalide → `transform` **ne jette pas**, il renvoie
  `{segments: <fidèles>, degraded: true, degradedReason}`. Son échec ne doit
  jamais empêcher d'écouter, et l'UI le signale.

### `SourceAdapter`, santé et registre

`canCapture(context)` / `capture(context, signal?)`, où `CaptureContext` est
neutre (uri, texte, sélection, curseur en lignes/colonnes) : traduire depuis
`vscode.TextEditor` revient à la couche d'intégration, pas à l'adaptateur.

`health()` renvoie un statut fermé
(`ok | degraded | unreachable | unauthorized | unverified`), un `checkedAt`, une
latence et un `endpoint` réduit à hôte + chemin — **jamais** de corps ni
d'en-tête (D10). `unverified` sert à dire « non vérifiable » plutôt qu'afficher
un faux vert (`Verify Local Mode`). Un `ProviderRegistry<T>` indexé par `id`
porte les providers : les profils référencent un `providerId`, jamais une
classe, ce qui laisse les fakes (§78) se substituer sans branche conditionnelle.

### `EgressGuard` : obligatoire pour tout accès réseau (D10)

Aucun module métier n'appelle `fetch` directement : tout passe par
`EgressGuard.fetch(request, init, signal)`, qui résout le DNS **avant**
connexion et exige une IP dans `127.0.0.0/8` ou `::1` en mode local, impose TLS
hors boucle locale, refuse toute redirection changeant d'hôte, journalise hôte
et chemin sans le corps, et honore `LLM_VOICE_STRICT_LOCAL=1` (mode bunker) et
`llmVoice.network.trustedHosts` (verrouillable par politique DSI).
`EgressDecision` est discriminé : un refus est une valeur, pas une exception.
`AbortSignal` est propagé partout — `capture`, `transform`, `synthesize`,
`synthesizeStream`, `health`, `fetch` : un `Stop` annule la synthèse en cours et
tout le prefetch (CdC §62).

### Validation des profils : `zod` en dépendance de production

`profile.schema.ts` valide au runtime tout `VoiceProfile` importé ou lu depuis
`profiles.json` avec `zod@^4` (AC-SEC-05) : refuser un profil malformé avant
qu'il n'atteigne `EgressGuard` ou un provider vaut mieux qu'un `as VoiceProfile`
non vérifié. C'est la seule dépendance de production de l'extension.
`npm run package` (`vsce package --no-dependencies`) produit à ce jour un VSIX
de **9.81 Ko** sans `zod` : `--no-dependencies` et `.vscodeignore`
(`node_modules/**`) l'excluent tous deux du paquet, et rien ne le signale au
build. Ça ne casse rien **pour l'instant** parce qu'aucun point d'activation
n'importe encore `src/core/profile.schema.ts` (`profile.schema.js` est mort
côté runtime packagé). Dès qu'une PR câble le chargement de `profiles.json`
dans `extension.ts`, l'extension installée plantera à l'activation
(`Cannot find module 'zod'`) tant que ce point n'est pas corrigé : soit
bundler avec `esbuild` (déjà en devDependency, non câblé dans `scripts`), soit
retirer `--no-dependencies` du script `package`. À trancher avant la PR qui
active `profile.schema.ts` en dur.

## Conséquences

- Local, entreprise et cloud partagent un seul `OpenAICompatibleTtsProvider`
  paramétré par `baseUrl` (D9) ; seul le TTS système aura du code propre.
- Interdire `fetch` direct est une règle **outillée** (ESLint
  `no-restricted-globals`), sinon elle sera contournée par mégarde.
- Le mode dégradé rend les appelants plus verbeux, et `getCapabilities()` étant
  asynchrone l'UI doit gérer un état « capacités inconnues » : prix à payer.

## Alternatives rejetées

- **Capacités déduites de l'`id`** : chaque nouveau provider obligerait à
  modifier le player — ce que le contrat doit justement éviter.
- **`synthesize` toujours `AsyncIterable`** : impose du streaming à des
  providers qui n'en font pas, complique cache et seek pour rien en 0.1.
- **Narrateur qui jette** : un composant optionnel rendrait la lecture impossible.
- **`CancellationToken` de VS Code dans les contrats** : réintroduit `vscode`
  dans le cœur et rend les tests unitaires impossibles.
- **`fetch` libre + revue humaine** : une garantie qui repose sur la discipline
  n'en est pas une (D10).
- **Providers narrateurs cloud** : hors périmètre, les LLM tiers alimentent
  l'inbox en texte sans jamais être des voix (D8).

## Tests qui prouvent la décision

- Unitaire : un `FakeTtsProvider` sans `synthesizeStream` et `streaming: false`
  est accepté par la file, qui n'emprunte pas le chemin streaming.
- Unitaire : `synthesize` avec un `AbortSignal` déjà avorté rejette en
  `AbortError` sans requête émise ; `transform` renvoie `degraded: true` et les
  segments fidèles pour provider injoignable, JSON invalide, timeout, annulation.
- Unitaire : `EgressGuard.check` autorise `http://127.0.0.1:8004` ; refuse
  `http://example.com` en local, `http://localhost` résolvant vers une IP
  publique (rebinding DNS), une redirection croisant l'hôte, et un hôte de
  confiance sous `LLM_VOICE_STRICT_LOCAL=1`.
- Unitaire : `ProviderHealth.endpoint` ne porte ni query string ni corps.
- Statique : la règle ESLint interdisant `fetch` hors `net/` échoue sur un
  fichier volontairement fautif.
- Intégration : un scénario complet en local n'émet aucune requête sortante
  (AC-SEC-01, couche HTTP interceptée) ; et `profile.schema.test.ts` (livré)
  prouve qu'un `baseUrl` hors loopback est accepté mais classé distant.
