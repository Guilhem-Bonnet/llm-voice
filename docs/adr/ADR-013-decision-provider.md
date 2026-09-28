# ADR-013 — Fournisseur de décision typée (`DecisionProvider`) et mode « Auto »

## Statut

Proposé (2026-09-27). Carte du Mission Ledger : `GAO-adr-013-four-001`.
Condition d'entrée de l'implémentation : spike `GAO-spike-valuat-001` concluant
(voir « Plan de vérification »). Livraison visée : 0.4, après ADR-012 (son).

## Contexte

L'utilisateur veut un pseudo-profil **« Auto »** qui choisit la manière de lire
une réponse Claude (lecture intégrale, résumé, révision…) parmi les profils
existants, visible et modifiable en un clic
(`_grimoire-output/planning-artifacts/decision-models-jev-v1.md` §1).

Ce besoin n'est pas de la génération de texte : c'est une **décision fermée**
(une option parmi N, 3 à 5 en pratique). Les modèles « de décision » de type Jev
formalisent ce genre de sortie en trois primitives typées avec probabilités :
`choice` (option + distribution), `score` (niveau ordinal + distribution),
`noul` (oui/non, P(vrai)). Deux autres usages futurs ont la même forme
(`decision-points-map-v1.md` §A) : triage de l'inbox et langue par document.

Arbitrage du 2026-09-27 (§10 de l'étude, qui corrige son §5 ;
`decisions-log.md`, entrée « Mode "Auto" : SemIf sur Ollama retenu », validée
par l'utilisateur) :

- **Retenu** : la technique SemIf — lire les probabilités du premier jeton
  parmi des options à une lettre — réimplémentée en TypeScript sur l'API
  **native** d'Ollama. Contrairement à ce qu'affirmait le §5, `POST
  /api/generate` renvoie bien `logprobs`/`top_logprobs` ; seule la couche
  compatible OpenAI les ignore (ollama/ollama#16117). Preuve locale : Ollama
  0.21.0, `qwen2.5:3b`, `temperature 0`, `num_predict 1`, trois options A/B/C
  → `response "A"`, distribution `A 1.000 / B 0.000 / C 0.000`.
- **Réserve** : Laya 322M multilingue (palier Python + fine-tuning), seulement
  si SemIf ne bat pas un témoin à règles.
- **Jamais par défaut** : Jev cloud (propriétaire, le texte quitterait la
  machine, invariant P0 n°2).

Contraintes : les cinq invariants P0 de `shared-context.md`, le mode dégradé
obligatoire de l'ADR-005, le point de passage réseau unique de l'ADR-010, la
décision « Zéro Docker » du 2026-09-11. La réserve de l'étude vaut pour toute
la suite : **un petit modèle est surconfiant** — la distribution obtenue est un
**classement**, pas une confiance calibrée.

## Décision

### 1. Contrat `DecisionProvider` dans `src/core/decision.ts`

Nouveau fichier du cœur, sans import de `vscode` (ADR-005), réexporté par
`src/core/index.ts`. Forme normative (les noms de champs peuvent être affinés à
l'implémentation ; la sémantique ci-dessous ne l'est pas) :

```ts
import type { Identified, ProviderHealth } from "./health.js";

export type DecisionKind = "choice" | "score" | "noul";

/** Une option fermée ; `label`/`description` sont montrés au modèle, `id` jamais. */
export interface DecisionOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

interface DecisionRequestBase {
  /** Question fermée, dans la langue de l'utilisateur. */
  readonly question: string;
  /** État textuel soumis au modèle, déjà tronqué par l'appelant (§4). */
  readonly input: string;
  readonly timeoutMs?: number;
}

export interface ChoiceRequest extends DecisionRequestBase {
  readonly kind: "choice";
  readonly options: readonly DecisionOption[]; // 2..capabilities.maxOptions, ids uniques
  /** Rendu tel quel en mode dégradé ; n'a pas à figurer dans `options`. */
  readonly fallbackOptionId: string;
}

export interface ScoreRequest extends DecisionRequestBase {
  readonly kind: "score";
  /** Niveaux ordonnés du plus bas au plus haut. */
  readonly levels: readonly DecisionOption[];
  readonly fallbackLevelId: string;
}

export interface NoulRequest extends DecisionRequestBase {
  readonly kind: "noul";
  readonly fallback: boolean;
}

export type DecisionRequest = ChoiceRequest | ScoreRequest | NoulRequest;

/** Probabilités sur les options proposées, de somme 1 (renormalisées). */
export interface DistributionEntry {
  readonly optionId: string;
  readonly probability: number;
}

export type DecisionOutcome =
  | { readonly kind: "choice"; readonly optionId: string; readonly distribution?: readonly DistributionEntry[] }
  | { readonly kind: "score"; readonly levelId: string; readonly levelIndex: number; readonly distribution?: readonly DistributionEntry[] }
  | { readonly kind: "noul"; readonly value: boolean; readonly probabilityTrue?: number };

/** Calqué sur `NarrationDegradedReason` (`src/core/narration.ts`), étendu au réseau et à la décision. */
export type DecisionDegradedReason =
  | "provider-unavailable"
  | "invalid-output"            // réponse illisible, champ `logprobs` absent…
  | "timeout"
  | "cancelled"
  | "budget-exceeded"
  | "user-disabled"             // aucun fournisseur de décision configuré (NoneDecisionProvider)
  | "egress-denied"             // EgressDeniedError, ou fournisseur distant sous localOnly
  | "invalid-request"           // < 2 options, trop d'options, ids dupliqués, entrée vide
  | "insufficient-option-mass"; // aucune lettre autorisée (ou trop peu de masse) dans le top-k

export interface DecisionResult {
  /** Toujours utilisable : la valeur de repli de la requête quand `degraded`. */
  readonly outcome: DecisionOutcome;
  readonly degraded: boolean;
  readonly degradedReason?: DecisionDegradedReason;
  readonly providerId: string;
  readonly latencyMs?: number;
  /** Diagnostic seulement, jamais montré comme une confiance (§3). */
  readonly diagnostics?: {
    /** Masse brute portée par les lettres autorisées avant renormalisation, ∈ [0, 1]. */
    readonly optionMass?: number;
    /** Options absentes du top-k, créditées d'une probabilité 0. */
    readonly missingOptionIds?: readonly string[];
  };
}

export interface DecisionCapabilities {
  readonly kinds: readonly DecisionKind[];
  /** `false` : la distribution est un classement, pas une probabilité calibrée. */
  readonly calibratedProbabilities: boolean;
  readonly maxOptions: number;
  readonly maxInputChars: number;
  /** Le fournisseur n'émet que vers la boucle locale (alimente le badge 🔒/☁). */
  readonly localOnly: boolean;
}

export interface DecisionProvider extends Identified {
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  getCapabilities(signal?: AbortSignal): Promise<DecisionCapabilities>;
  /** Ne rejette jamais : toute défaillance → `degraded: true` + raison + valeur de repli. */
  decide(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResult>;
}
```

Règles du contrat :

- **Mode dégradé obligatoire** (ADR-005) : `decide()` résout toujours, y
  compris sur annulation, délai dépassé, garde réseau, réponse inexploitable ou
  requête invalide. En mode dégradé, `outcome` porte la valeur de repli fournie
  par l'appelant, sans `distribution` ni `probabilityTrue`. Exiger le repli
  **dans la requête** (plutôt que laisser l'appelant le gérer après coup) rend
  l'oubli du repli impossible à la compilation : c'est l'équivalent des
  « segments fidèles » que `NarrationResult` renvoie en mode dégradé.
- **Jamais de texte généré** : la sortie est une valeur typée. Aucun appelant
  ne lit une chaîne produite par le modèle.
- **Choix = argmax** de la distribution renormalisée ; égalité → la première
  option dans l'ordre de la requête (déterministe). `score` : argmax
  également (le mode, pas l'espérance) ; `noul` : `value = probabilityTrue ≥
  0,5`, l'appelant reste libre d'appliquer son propre seuil sur
  `probabilityTrue`.
- **`getCapabilities()` obligatoire** (comme `TtsProvider`, pas optionnel comme
  `NarratorProvider`) : l'appelant doit savoir si les probabilités sont
  calibrées avant d'en faire autre chose qu'un classement.
- `AbortSignal` propagé partout (ADR-005) : un Stop annule la décision en cours.
- `health()` renvoie le `ProviderHealth` fermé existant (`ok | degraded |
  unreachable | unauthorized | unverified`).

### 2. `OllamaLogprobsDecisionProvider` — première implémentation (technique SemIf)

Fichier `src/decision/OllamaLogprobsDecisionProvider.ts`. Format filaire
**nouveau** : aucun code actuel n'appelle `/api/generate` ni ne lit `logprobs`
(`decision-points-map-v1.md` §C.1) — ce n'est pas une extension
d'`OllamaNarrator`, qui reste sur `/api/chat` + `format`.

**Requête** (une par décision) :

```json
POST {baseUrl}/api/generate
{
  "model": "<llmVoice.decision.model>",
  "system": "<consigne : répondre par une seule lettre parmi celles listées>",
  "prompt": "<question> + <options lettrées> + <entrée délimitée> + « Réponse (une lettre) : »",
  "stream": false,
  "options": { "temperature": 0, "num_predict": 1 },
  "logprobs": true,
  "top_logprobs": 20
}
```

- **Options à une lettre** : `A`, `B`, `C`… dans l'ordre de la requête, chacune
  suivie de son `label` et de sa `description`. Une lettre = un jeton pour les
  tokenizers courants, ce qui rend la lecture du premier jeton suffisante.
  `score` : niveaux lettrés du plus bas au plus haut ; `noul` : `A = oui`,
  `B = non`, `probabilityTrue = P(A)` renormalisée sur {A, B}. Les trois
  primitives se réduisent donc au même mécanisme.
- **`maxOptions = 10`** (A à J) pour ce fournisseur, et `top_logprobs = 20` :
  au moins deux fois le nombre d'options, pour laisser la place aux variantes
  de jeton d'une même lettre. Le plafond serveur de `top_logprobs` et la forme
  exacte des champs de réponse (`logprobs[0].top_logprobs[].token/logprob`)
  sont **non vérifiés** au-delà de la preuve du 2026-09-27 : le fake de test
  doit être construit à partir d'une réponse réelle capturée sur Ollama 0.21.

**Lecture de la réponse** :

1. Ne lire que le **premier** élément de `logprobs` et son `top_logprobs`. Le
   champ `response` (jeton tiré) n'est pas utilisé pour décider : si le modèle
   émet autre chose qu'une lettre mais que des lettres autorisées figurent
   dans le top-k, la décision se prend sur le top-k.
2. **Normaliser** chaque jeton par `trim()` ; ne retenir que ceux qui sont
   **exactement une lettre majuscule autorisée**. Les minuscules ne comptent
   pas (en français, `a` et `à` sont des mots courants, pas des réponses).
3. **Agréger** : `m(L) = Σ exp(logprob)` sur les variantes normalisées en `L`
   (`"A"`, `" A"`…).
4. **Renormaliser** sur les lettres autorisées :
   `P(L) = m(L) / Σ m(L')`. La masse brute `Σ m(L')` est rendue dans
   `diagnostics.optionMass`.
5. **Lettre attendue absente du top-k** : elle reçoit `P = 0` et son id est
   listé dans `diagnostics.missingOptionIds`. Justification : sa probabilité
   réelle est inférieure à celle du plus petit élément du top-k, donc
   inférieure à toute lettre présente — l'argmax est inchangé, et l'on
   n'invente pas de masse. Un tirage uniforme de la masse résiduelle est
   rejeté : il fabriquerait une distribution que le modèle n'a pas exprimée.
6. **Aucune lettre autorisée** dans le top-k, ou `optionMass` sous un seuil
   (0,5 proposé, **non mesuré**, calibré par le spike) → `degraded: true`,
   `insufficient-option-mass`, valeur de repli.
7. Réponse sans champ `logprobs` (Ollama trop ancien ou modèle ne les exposant
   pas) → `invalid-output` ; `health()` passe alors `degraded` avec un détail
   explicite. La version minimale d'Ollama exposant `logprobs` n'est **pas
   vérifiée** ; 0.21.0 est la seule version prouvée.

**Troncature de l'entrée** : à la charge de l'appelant, qui connaît l'usage
(Auto : ~1 500 caractères de tête, triage : ~500, langue : ~300–500 —
`decision-points-map-v1.md` §A, valeurs **non mesurées**, à fixer par le
spike). L'appelant peut préfixer des signaux bon marché calculés en amont
(longueur totale en caractères). Le fournisseur retronque défensivement à
`maxInputChars` (4 000 caractères proposés) pour ne jamais dépasser le
contexte du modèle. La troncature se fait **par points de code** (jamais au
milieu d'une paire de substitution) et est signalée par un marqueur `[…]`.
L'entrée est placée entre délimiteurs explicites, **après** la liste des
options et **avant** la consigne finale.

**Réseau** : le fournisseur reçoit l'`EgressGuardHandle` unique du `Pipeline`
et n'appelle que `egress.fetch` (ADR-010, règle ESLint existante). Un
`EgressDeniedError` devient `degraded: true`, `egress-denied`, **sans aucun
octet émis**. Pas de journal du corps : la trace de décision ne contient que
`providerId`, `kind`, ids d'options, distribution arrondie, `optionMass`,
latence et raison de dégradation — jamais `input` ni `question`. Le champ
`input` doit être ajouté à `BANNED_FIELDS` (`src/infrastructure/logger.ts`),
qui ne le couvre pas aujourd'hui.

**Ce que la distribution n'est pas** : `calibratedProbabilities: false`. Un
petit modèle à `temperature 0` rend des distributions quasi dégénérées
(`1.000/0/0` observé avec `qwen2.5:3b` le 2026-09-27 ; les autres tailles de la
plage 1,5–7 B ne sont pas testées, hypothèse à confirmer par le spike). L'UI **n'affiche aucun pourcentage** : elle montre
le profil choisi (« ✨ Auto → Résumé LLM ») et permet d'en changer en un clic.
La distribution sert au classement, au seuil `insufficient-option-mass` et au
spike, pas à rassurer l'utilisateur.

**Modèle et hôte** : par défaut ceux du narrateur (`llmVoice.narrator.baseUrl`,
`llmVoice.narrator.model`) — même instance Ollama, même modèle résident en
mémoire, aucune seconde installation (le modèle choisi reste à confirmer par
le spike).

### 3. `NoneDecisionProvider` — repli statique

`decide()` renvoie immédiatement la valeur de repli de la requête avec
`degraded: true`, `user-disabled`, **sans aucune requête réseau** ;
`health()` → `ok` (détail : « aucun fournisseur de décision, repli statique ») ;
`calibratedProbabilities: false`, `localOnly: true`. Pour « Auto », la valeur
de repli est celle de la chaîne statique existante (§4) : avec ce fournisseur,
le comportement est **exactement** celui d'aujourd'hui.

### 4. Pseudo-profil « Auto » : identifiant réservé, pas un champ de `VoiceProfile`

**Tranché : `"auto"` est un identifiant de profil réservé**, jamais un
`VoiceProfile`.

- Il peut apparaître partout où l'on désigne un profil **par id** hors de
  `profiles.json` : valeurs de `llmVoice.profiles.bySource`, `lastSelectedId`
  (sélection dans le Quick Pick). Il n'apparaît jamais dans `profiles.json` :
  `VoiceProfileSchema` refuse `id: "auto"` et `ProfileCollectionSchema` refuse
  `defaultProfileId: "auto"` (ensemble `RESERVED_PROFILE_IDS` **à créer et exporter** dans
  `profile.schema.ts` — ce symbole n'existe pas encore ; aujourd'hui `id` y est un simple
  `z.string().min(1)`).
- **Résolution** (`Pipeline.startInternal`, entre la capture et
  `getSelected`, `decision-points-map-v1.md` §C.1) : si la chaîne
  `resolveDefaultProfileId` (`bySource[source] → lastSelectedId →
  defaultProfileId`) donne `"auto"`, l'appelant calcule d'abord le **repli** =
  le premier id réel de la même chaîne en sautant `"auto"` (en dernier recours
  `defaultProfileId`, jamais réservé), puis appelle `decide()` avec
  `fallbackOptionId = repli`. `resolveDefaultProfileId` reste pure et
  synchrone, sans changement de signature.
- **Candidats** : `profiles.list()` lu au moment de la décision (jamais une liste
  figée), restreint par `llmVoice.decision.autoCandidates` s'il est renseigné,
  **à l'exclusion de tout profil dont un point de terminaison résolu n'est pas
  en boucle locale**. Auto ne choisit jamais un profil distant : il enverrait
  du texte hors de la machine sans que l'utilisateur ait choisi ce profil pour
  cette lecture. Plus de candidats que `maxOptions` → `invalid-request`, repli,
  message invitant à restreindre `autoCandidates`.
- L'id décidé **n'est jamais écrit** dans `lastSelectedId` : un choix manuel
  ultérieur ne doit pas être masqué par la dernière estimation d'Auto.
- **Opt-in en 0.4** : le défaut livré reste `bySource: { "claude-code":
  "llm-summary" }`. Passer le défaut à `"auto"` est une décision séparée, prise
  sur les résultats du spike.
- **Migration** (à créer) : `CURRENT_PROFILE_SCHEMA_VERSION` passera à 3 (aujourd'hui `schemaVersion` accepte 1 ou 2) ; un profil
  existant d'id `"auto"` (créé à la main ou par l'éditeur) est renommé
  `"auto-custom"` à la lecture, de façon idempotente, avec message à
  l'utilisateur. Les réglages qui visaient ce profil désignent désormais le
  mode Auto ; conséquence acceptée et documentée.

Justification contre l'option « champ » (profil portant `selection: "auto"`,
ou union discriminée dans `VoiceProfileSchema`) : un `VoiceProfile` impose
`tts`, `chunking`, `playback`, `mode`, `language`, qui n'ont aucun sens pour
Auto — soit on les falsifie, soit on transforme `VoiceProfile` en union et
chaque consommateur (`Pipeline`, éditeur, vue Profils, `isRemoteProfile`,
`SessionFactory`) doit apprendre à l'écarter. L'id réservé suit le précédent
déjà livré de `llmVoice.tts.provider: "auto"` (ADR-009, S7.1), ne touche que
la résolution, et `bySource` accepte déjà des chaînes libres.

### 5. Fabrique et réglages

`src/decision/createDecisionProvider.ts`, sur le modèle de
`createNarratorProvider` (arguments primitifs, pas de dépendance à
`src/pipeline`) : `"ollama"` → `OllamaLogprobsDecisionProvider` ; `"none"`,
`""` ou id inconnu → `NoneDecisionProvider`. Réglages proposés :
`llmVoice.decision.provider` (défaut `"ollama"`, n'émet rien tant qu'Auto
n'est pas choisi), `llmVoice.decision.baseUrl` et `llmVoice.decision.model`
(vides = ceux du narrateur), `llmVoice.decision.timeoutMs` (défaut 3 000 ms,
**non mesuré**), `llmVoice.decision.autoCandidates` (liste d'ids, vide = tous
les profils locaux).

`computeVerifyLocalMode` (`Pipeline.ts`) doit inspecter le point de
terminaison de décision résolu en plus de ceux du TTS et du narrateur, sans
quoi un futur fournisseur distant serait invisible au badge 🔒/☁.

### 6. Extensions futures : mêmes contrats, seule la fabrique change

- **`JevDecisionProvider`** (☁) : client HTTP `/v1/systemone`. Jamais par
  défaut ; la fabrique ne l'instancie que si `privacy.localOnly = false`, sinon
  elle rend un `NoneDecisionProvider` dont la raison est `egress-denied`. Hôte
  dans `trustedHosts`, TLS obligatoire (ADR-010), clé dans `SecretStorage`
  (`llmVoice.apiKey.jev`, ADR-004), badge ☁, `localOnly: false` dans ses
  capacités. Le même client servirait **Kev** (`kev.serve`, même API filaire
  annoncée) à l'identique, seule l'URL changeant ; Kev reste écarté par
  l'arbitrage du 2026-09-27, l'architecture ne l'empêche simplement pas. Le
  format filaire exact de Jev n'est **pas vérifié** (étude, §9).
- **`LayaDecisionProvider`** : palier Python optionnel, serveur `laya-serve` sur
  `127.0.0.1`, installé à la demande comme Piper, checkpoint fine-tuné
  téléchargé hors VSIX. Activé seulement si le spike le justifie.
- D'autres implémentations tiennent dans le même contrat sans le modifier : un
  fournisseur compatible OpenAI pour vLLM ou llama.cpp (qui exposent les
  logprobs sur `/v1/completions`), ou un classifieur sur embeddings Ollama,
  candidat du spike.

### Flux « Auto » (lecture d'une réponse Claude)

```mermaid
sequenceDiagram
    actor U as Utilisateur
    participant P as Pipeline.startInternal
    participant R as ProfileRepository
    participant D as DecisionProvider
    participant G as EgressGuard
    participant O as Ollama (127.0.0.1:11434)
    participant S as Session / TTS

    U->>P: commande Lire (geste utilisateur)
    P->>P: capture → doc.rawText
    P->>R: resolveDefaultProfileId(source)
    R-->>P: "auto"
    P->>P: repli = 1er id réel de la chaîne ; candidats = profils locaux
    P->>D: decide(choice, input tronqué, options A..J, fallbackOptionId)
    D->>G: fetch POST /api/generate
    alt loopback autorisé et réponse exploitable
        G->>O: temperature 0, num_predict 1, logprobs, top_logprobs
        O-->>D: premier jeton + top_logprobs
        D-->>P: optionId = argmax, degraded: false
    else refus réseau, délai, sortie inexploitable, Ollama absent
        D-->>P: optionId = repli, degraded: true, raison
    end
    P->>S: session avec le profil choisi (lastSelectedId inchangé)
    Note over P,S: La décision ne déclenche jamais play() :<br/>elle n'existe que dans une lecture déjà demandée.
```

### Invariants P0

| Invariant | Comment l'ADR le respecte |
|---|---|
| 1. Zéro autoplay | `decide()` ne connaît ni le player ni la session. Elle n'est appelée que dans `startInternal`, lui-même atteint uniquement par une commande utilisateur. Un futur usage « triage à l'arrivée d'un fichier » ne produit qu'une étiquette, jamais une lecture. |
| 2. Local-first | Fournisseur par défaut en boucle locale via `EgressGuard` ; Auto exclut les profils distants ; Jev uniquement sous `localOnly = false` ; aucune entrée journalisée. |
| 3. Provider agnostic | Contrat dans `src/core`, sélection par id via une fabrique ; Ollama, None, Laya, Jev interchangeables. |
| 4. Profils configurables | Auto choisit parmi les profils de l'utilisateur lus à l'exécution ; candidats restreignables ; aucun mode codé en dur. |
| 5. Aucun modèle dans le VSIX | Ollama sert le modèle déjà installé ; aucune dépendance de production ajoutée (pas de tokenizer, pas de runtime ONNX) ; Laya télécharge hors VSIX. |

## Conséquences

- Positives : une nouvelle famille de providers sans nouveau composant à
  installer ; le même contrat servira le triage de l'inbox et la langue par
  document ; le fournisseur None rend le comportement actuel strictement
  inchangé tant qu'Auto n'est pas choisi.
- **Latence sur le chemin de lecture** : la décision s'intercale avant la
  première synthèse, bornée par `timeoutMs` puis repli. Le premier appel après
  chargement du modèle peut dépasser ce délai (poids non résidents) et tomber
  en repli : attendu et visible, non bloquant. Latence réelle **non mesurée**
  (spike). Une même entrée relue (Précédent, relecture) réutilise la décision
  via un mémo en mémoire (clé : empreinte de l'entrée tronquée + ids candidats +
  modèle), jamais persisté.
- **Biais de position** : un petit modèle favorise souvent la première lettre.
  Pas de permutation des options en v1 (latence × k) ; le spike mesure l'effet.
- **Injection dans l'entrée** : une réponse Claude peut contenir « réponds A ».
  Conséquence bornée : un profil local légitime mal choisi, visible et
  changeable en un clic, sans action déclenchée ni donnée émise.
- Coûts : un format filaire nouveau vers Ollama à maintenir, un mock
  `/api/generate` à écrire, une migration de schéma (v3) pour l'id réservé, un
  champ de plus dans `computeVerifyLocalMode` et `BANNED_FIELDS`.
- Les primitives `score` et `noul` sont livrées dans le contrat sans
  consommateur en 0.4. Coût faible (même mécanisme de lettres) ; elles évitent
  de casser le contrat quand le triage ou un fournisseur Jev arriveront.

## Alternatives rejetées

- **Laya en premier** : Python + fine-tuning, contraire à la voie « rien à
  installer » ; zéro-shot faible sur les décisions typées (0,342, étude §10).
  Gardé en réserve si SemIf ne bat pas les règles.
- **Basculer le narrateur sur llama.cpp pour obtenir les logits** : inutile,
  l'API native d'Ollama les fournit ; imposerait un second serveur.
- **Sortie JSON structurée d'Ollama** (`format` = `{ profileId: enum,
  confidence: number }`) : ne donne qu'une valeur et une « confiance » écrite
  par le modèle, pas une distribution ; plusieurs dizaines de jetons générés
  contre un seul ; aucun classement exploitable pour le seuil de masse ni pour
  le spike. Reste la bonne mécanique pour le narrateur.
- **`/v1/chat/completions` compatible OpenAI d'Ollama** : ignore `logprobs`
  (ollama/ollama#16117, fermée « not planned »).
- **Étiquetage du jeu d'évaluation par un LLM** : on apprendrait le goût du LLM,
  pas celui de l'utilisateur. Les 50 réponses du spike sont étiquetées par
  l'utilisateur.
- **Docker commun à tous les projets** : contraire à « Zéro Docker »
  (2026-09-11) ; Ollama est déjà partagé entre fenêtres via localhost.
- **« Auto » comme champ ou variante de `VoiceProfile`** : voir §4.
- **Décision sans repli dans la requête** (`outcome` absent en mode dégradé) :
  chaque appelant devrait se souvenir de gérer l'absence ; rejeté au profit du
  repli obligatoire.
- **Jev par défaut** : le texte des réponses Claude quitterait la machine
  (invariant P0 n°2).

## Plan de vérification

**Condition d'entrée** : le spike `GAO-spike-valuat-001` (hors CI) compare, sur
50 réponses Claude réelles de l'inbox étiquetées par l'utilisateur, un témoin
à règles (longueur, part de code, questions), SemIf sur Ollama et un
classifieur sur embeddings ; il mesure exactitude et latence CPU, fixe la
troncature, le seuil `optionMass` et le modèle. **Aucun fournisseur n'est
embarqué s'il ne bat pas le témoin à règles.** Si SemIf perd, cet ADR est
amendé (Laya ou règles) avant tout code produit. Ordre des cartes
(`decision-points-map-v1.md` §E, corrigé) : contrat et ADR, mock
`/api/generate`, spike, puis implémentation et UI. Calendrier : 0.4, après
l'acceptation d'ADR-012.

**Tests unitaires à prévoir** (vitest, `mockOllamaServer` étendu d'une route
`POST /api/generate` à distribution programmable, bâtie sur une réponse réelle
capturée) :

- Charge utile : `stream: false`, `temperature 0`, `num_predict 1`,
  `logprobs: true`, `top_logprobs: 20`, options lettrées dans l'ordre, entrée
  entre délimiteurs.
- Renormalisation : exemple calculé à la main avec variantes `"A"`/`" A"`
  agrégées, minuscule `a` ignorée, somme = 1 à 1e-9 près, `optionMass` exact.
- Lettre absente du top-k → `P = 0`, id dans `missingOptionIds`, argmax
  inchangé ; aucune lettre autorisée → `insufficient-option-mass` + repli ;
  masse sous le seuil → idem.
- Jeton tiré non-lettre mais lettres dans le top-k → décision sur le top-k.
- Égalité → première option ; `score` → `levelIndex` cohérent ; `noul` →
  `probabilityTrue` renormalisée sur {A, B}.
- Dégradation, jamais de rejet : HTTP 500 → `provider-unavailable` ; réponse
  sans `logprobs` → `invalid-output` et `health()` `degraded` ; délai →
  `timeout` ; signal avorté → `cancelled` ; requête invalide (1 option, 11
  options, ids dupliqués, entrée vide) → `invalid-request` **sans requête
  émise**. Test de propriété : toute panne simulée du fake résout.
- Egress refusé : `EgressDeniedError` → `egress-denied`, le fake n'a reçu
  aucune requête.
- Troncature par points de code (émoji à la frontière), marqueur `[…]`,
  plafond `maxInputChars`.
- Journal : une chaîne sentinelle placée dans `input` n'apparaît dans aucune
  ligne de log.
- `NoneDecisionProvider` : repli, `user-disabled`, zéro requête.
- Fabrique : `"ollama"`, `"none"`, `""`, id inconnu ; plus tard `"jev"` avec
  `localOnly = true` → None + `egress-denied`.
- Schéma : `id: "auto"` et `defaultProfileId: "auto"` refusés ; migration v3
  idempotente (renommage `auto` → `auto-custom`, second passage sans effet).
- Résolution : repli = premier id réel de la chaîne en sautant `"auto"` ;
  `lastSelectedId` jamais écrit par Auto ; profil distant exclu des candidats.

**Intégration** (patron `test/integration/pipeline.test.ts`, `FakeDecisionProvider`
injecté comme `narratorProviderOverride`) : Auto choisit puis lit avec le
profil choisi ; aucun appel TTS avant la décision ; aucun `play()` sans
commande ; en `localOnly`, zéro requête non interceptée (ADR-010 niveau 2) ;
`Verify Local Mode` inclut le point de terminaison de décision.

**Statique** : la règle ESLint interdisant `fetch` hors `net/` couvre
`src/decision/`.
