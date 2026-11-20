# Cartographie des points de décision — Mode « Auto » (pseudo-profil), v1

> Rédigé le 2026-09-27 par platform-architect (Archie), tâche `GAO-cartographie-001`, sur demande de
> l'entrée du journal de décisions du même jour (« Mode Auto : SemIf sur Ollama retenu »). Cartographie
> pure — **aucun code produit**, aucune décision nouvelle. Chaque chemin cité ci-dessous a été ouvert
> directement (Read) pendant cette tâche ; voir `evidence-pack.md` pour la liste complète des lectures.
> Contexte : `_grimoire-output/planning-artifacts/decision-models-jev-v1.md` §2, §5, §6, §10 ;
> `_grimoire/_memory/decisions-log.md`, entrée du 2026-09-27.

## 0. Rappel du besoin (pour ne pas dériver)

Un pseudo-profil « Auto » doit choisir, parmi 3–4 profils candidats, celui qui lit une réponse Claude —
via SemIf réimplémenté en TypeScript sur `POST /api/generate` d'Ollama (logprobs du premier jeton parmi
des options à une lettre, `temperature: 0`, `num_predict: 1`). Repli sur `llmVoice.profiles.bySource`
sans Ollama. Jev cloud optionnel plus tard, jamais par défaut.

## 1. Points d'usage — où un profil est choisi aujourd'hui, et où « Auto » s'insère

| # | Point d'usage | Fichier : fonction/classe | Rôle actuel | Insertion « Auto » |
|---|---|---|---|---|
| 1.1 | Résolution du profil actif pour une nouvelle session | `vscode-extension/src/profiles/ProfileRepository.ts` — `ProfileRepository.getSelected(sourceType?, bySource?)` (ligne 94) | Cherche l'id voulu (`bySource` > dernier sélectionné > défaut de la collection) dans `collection.profiles`, replie sur le premier profil si l'id n'existe plus | Site le plus probable pour détecter un id réservé (`"auto"`) et le distinguer d'un profil ordinaire ; aujourd'hui un id inconnu retombe silencieusement sur le défaut — un pseudo-id « auto » absent de `collection.profiles` ferait exactement ça sans code neuf, ce qui n'est **pas** le comportement voulu (§3 ci-dessous) |
| 1.2 | Priorité par source de capture | `vscode-extension/src/profiles/bySource.ts` — `resolveDefaultProfileId(sourceType, bySource, lastSelectedId, collectionDefaultId)` | Fonction pure, sans effet de bord, retourne un id de profil (chaîne) | Peut retourner littéralement `"auto"` sans modification — la fonction ne valide pas que l'id existe ; c'est `getSelected` qui devra le reconnaître |
| 1.3 | Point d'entrée réel où le profil choisi sert à construire une session | `vscode-extension/src/pipeline/Pipeline.ts` — `Pipeline.startInternal(captureContext)` (ligne 538, appel à `getSelected` en ligne 553) | `const profile = await this.profiles.getSelected(doc.sourceType, this.bySourceSettings());` puis segmentation/narration/TTS bâtis directement sur ce profil | **Site principal recommandé** : après `getSelected`, si `profile` est le pseudo-profil (ou si son id est `"auto"`), appeler le `DecisionProvider` avec le texte du document capturé (`doc.rawText`, tronqué) et la liste des profils candidats, puis remplacer `profile` par le profil concret choisi avant `buildSegments`/`buildSession`. Ce point est déjà atteint uniquement depuis une commande explicite de l'utilisateur (voir §4, invariant P0 n°1) |
| 1.4 | Commande interactive de changement de profil | `vscode-extension/src/pipeline/Pipeline.ts` — `Pipeline.selectProfile()` (ligne 813) et `Pipeline.selectProfileById(id)` (ligne 827) | Liste les profils (`formatProfileQuickPickItem`), affiche le Quick Pick, appelle `selectProfileById` qui fait `this.profiles.select(id)` (persiste `lastSelectedId`) | Le Quick Pick devrait proposer une entrée « Auto » supplémentaire ; `selectProfileById("auto")` doit rester valide même si `"auto"` n'est l'id d'aucun `VoiceProfile` réel de `profiles.json` |
| 1.5 | Barre d'état (menu clic) | `vscode-extension/src/ui/StatusBar.ts` — `StatusBar.openMenu()` (ligne 67) | Propose déjà l'entrée `"$(mic) Changer de profil"` → `choice: "selectProfile"` qui redéclenche 1.4 | Aucun changement nécessaire ici : passe par 1.4. Le texte affiché par la barre d'état lui-même vient de `formatStatusBarText` (`vscode-extension/src/ui/statusBarText.ts`, non ouvert dans cette tâche — **non vérifié**) et devra afficher le profil réellement résolu, pas le libellé littéral « Auto » |
| 1.6 | Vue dédiée « Profils » | `vscode-extension/src/views/profiles/ProfilesTreeProvider.ts` — `ProfilesTreeProvider.refresh()` (ligne 36), `vscode-extension/src/views/profiles/profileTreeItems.ts` (formatage, non ouvert dans cette tâche — **non vérifié**) | Liste `listProfiles()` + l'id actif (`getActiveProfileId`) | Même remarque qu'en 1.5 : la liste vient de `profiles.list()` (les profils réels de `profiles.json`) ; un item « Auto » n'existe dans cette vue que s'il est ajouté explicitement (pas un profil de `profiles.json`) ou si `profiles.json` peut contenir un objet marqueur — point ouvert, voir §2.4 |
| 1.7 | Formatage Quick Pick d'un profil | `vscode-extension/src/profiles/profileQuickPick.ts` — `formatProfileQuickPickItem(profile, isSelected)` (ligne 28) | Prend un `VoiceProfile` complet (avec `tts`, badge 🔒/☁ via `isRemoteProfile`) | Un pseudo-profil « Auto » n'a pas de `tts.baseUrl` propre à évaluer pour le badge 🔒/☁ tant qu'il n'a pas résolu — à traiter séparément (texte neutre, ou badge du dernier profil résolu) |
| 1.8 | Quick Pick de l'inbox Claude | `vscode-extension/src/claude/InboxQuickPick.ts` — `showInboxQuickPick(listEntries, actions)` (ligne 57) | Un bouton dédié `BUTTON_SELECT_PROFILE` (ligne 26) déclenche `actions.selectProfile()` → 1.4 ; l'entrée choisie déclenche `actions.speak(entry)` | Aucun changement structurel : passe par 1.4/1.3. C'est le chemin le plus probable pour qu'une réponse Claude soit lue en mode « Auto » (le cas d'usage cité dans la décision du 2026-09-27) |
| 1.9 | Commande directe « dernière réponse Claude » | `vscode-extension/src/pipeline/Pipeline.ts` — `Pipeline.speakLatestClaudeResponse()` (ligne 1381) et `Pipeline.speakInboxEntry(entry)` (ligne 1573, appelle `startInternal({ scope: "inbox-message", ... })`) | Retrouve la dernière entrée `provider === "claude-code"`, marque lue, appelle `startInternal` → même chemin qu'en 1.3 | Aucun point d'insertion distinct : bénéficie automatiquement de la résolution ajoutée en 1.3 |
| 1.10 | Seam commandes ↔ pipeline | `vscode-extension/src/commands/PipelineFacade.ts` — interface `PipelineFacade` (méthodes `selectProfile`, `selectProfileById`, `speakLatestClaudeResponse`, ligne 33, 35, 53) et `vscode-extension/src/commands/index.ts` — `registerCommands(deps)` (ligne 41, enregistrements `llmVoice.selectProfile`/`llmVoice.speakLatestClaudeResponse` lignes 118 et 131) | Aucune méthode dédiée au mode Auto aujourd'hui | Pas de nouvelle commande strictement nécessaire pour un MVP (le pseudo-profil transite par les méthodes existantes) ; une commande `llmVoice.toggleAutoProfile` ou équivalent resterait un choix produit, pas un point d'implémentation obligé |

### Invariant zéro autoplay et point d'insertion 1.3

`Pipeline.speakInboxEntry` porte le commentaire explicite (ligne 1572) : *"zero autoplay: only ever
reached from a command the user triggered"*. L'insertion recommandée en 1.3 est **à l'intérieur** de
`startInternal`, donc **après** que l'utilisateur a déjà déclenché une commande explicite (Speak
Document/Selection/Clipboard, Speak Latest Claude Response, item d'inbox). Le mode « Auto » ne change que
*quel profil* est utilisé pour cette lecture déjà demandée — il ne fait *jamais* démarrer une lecture de
sa propre initiative. C'est cohérent avec l'invariant P0 n°1 (« zéro autoplay ») tel que formulé dans
`_grimoire/_memory/shared-context.md` : « aucun chemin de code Claude Stop → Player.play() ».

## 2. Points d'implémentation — où vivrait le contrat et la fabrique

| # | Point d'implémentation | Fichier proposé (à créer) ou existant | Modèle à imiter (fichier réellement ouvert) |
|---|---|---|---|
| 2.1 | Contrat `DecisionProvider` | À créer, ex. `vscode-extension/src/core/decision.ts`, exporté depuis `vscode-extension/src/core/index.ts` (déjà ouvert : ré-exporte `./narration.js` en ligne 10 parmi d'autres — un nouveau `export * from "./decision.js";` suivrait le même patron) | `vscode-extension/src/core/narration.ts` — l'interface `NarratorProvider` (ligne 64 : `id`, `health(signal?)`, `getCapabilities?()`, `transform(request, signal?)`) est le gabarit direct : même triplet `id` / `health` / méthode principale qui ne rejette jamais (« must resolve with `degraded: true` rather than reject ») |
| 2.2 | Fabrique par `providerId` | À créer, ex. `vscode-extension/src/decision/createDecisionProvider.ts` (nouveau dossier `src/decision/`, en miroir de `src/narrator/`) | `vscode-extension/src/narrator/createNarratorProvider.ts` — `createNarratorProvider(options)` (ligne 35) : prend `providerId`, `baseUrl`, `model`, `egress: EgressGuardHandle`, retourne l'implémentation concrète ou un provider neutre (`NoNarrator`) pour tout id non reconnu. Le même patron donnerait un `NoDecisionProvider` (repli neutre) + `OllamaDecisionProvider` |
| 2.3 | Implémentation Ollama (SemIf) | À créer, ex. `vscode-extension/src/decision/OllamaDecisionProvider.ts` | `vscode-extension/src/narrator/OllamaNarrator.ts` — `OllamaNarrator.transform()` (ligne 104) montre l'appel `POST {baseUrl}/api/chat` via `this.egress.fetch` (jamais `fetch` nu), le `AbortSignal` combiné (`withTimeout`), et le repli `fallbackResult(..., "provider-unavailable"|"invalid-structured-output"|"timeout"|"cancelled")` (`vscode-extension/src/narrator/shared.ts`, lignes 24-29). SemIf appellerait `POST {baseUrl}/api/generate` (pas `/api/chat`) avec `stream: false`, `options.temperature: 0`, `options.num_predict: 1`, et lirait `logprobs`/`top_logprobs` de la réponse plutôt que `message.content` — différence de forme confirmée par la vérification indépendante citée dans `decisions-log.md` (2026-09-27), non re-testée dans cette tâche |
| 2.4 | Passage obligé par `EgressGuard` | `vscode-extension/src/net/EgressGuard.ts` — `EgressGuardHandle.fetch` (ligne 91), construit par `createEgressGuard(options)` (ligne 159) | Déjà en place, aucun changement de contrat nécessaire : `OllamaDecisionProvider` recevrait la même instance `EgressGuardHandle` que `Pipeline.egress` (champ privé, `vscode-extension/src/pipeline/Pipeline.ts` ligne 288), au même titre que `ttsFor`/`narratorFor` (lignes 1663 et 1936) |
| 2.5 | Résolution de config (setting ↔ profil) | `vscode-extension/src/pipeline/resolveProviderConfig.ts` — `resolveNarratorConfig(narrator, settings)` (ligne 56) et `selectAutoTtsProvider(candidates, fallback, signal)` (ligne 97) | Deux patrons combinés utiles ici : (a) `resolveNarratorConfig` pour « le profil peut surcharger, sinon le setting » ; (b) `selectAutoTtsProvider`/`Pipeline.autoSelectTts()` (`Pipeline.ts` ligne 1736) pour « essayer un candidat, retomber sur le suivant si `health()` échoue » — le mode Auto TTS existant (`llmVoice.tts.provider: "auto"`) est déjà l'exact même genre de bascule que le mode Auto *profil* proposé, mais one level up (choix de profil, pas de provider) |
| 2.6 | Schéma de profil — représenter « Auto » | `vscode-extension/src/core/profile.schema.ts` (`VoiceProfileObjectSchema`, ligne 123 ; `ProfileCollectionSchema`, ligne 175) et `vscode-extension/src/core/profile.ts` (`interface VoiceProfile`, ligne 89 ; `interface ProfileCollection`, ligne 131) | **Point ouvert, non tranché par cette cartographie** : deux options observées dans le code existant comme précédent direct — (a) *pseudo-id réservé*, à l'image de `tts.providerId: "auto"` déjà utilisé dans `TtsBindingSchema` (`profile.schema.ts` ligne 97-107) et résolu par `Pipeline.resolveTtsProviderConfig` (ligne 1721, `if (settingsResolved.providerId !== "auto") return settingsResolved; return this.autoSelectTts();`) — dans ce cas, `defaultProfileId`/`llmVoice.profiles.bySource`/`lastSelectedId` pourraient valoir la chaîne `"auto"` sans qu'un objet `VoiceProfile` portant cet id existe dans `collection.profiles`, et `ProfileRepository.getSelected` (1.1) devrait le détecter *avant* sa recherche par id actuelle (qui replierait sinon silencieusement sur le défaut) ; (b) *champ dédié*, ex. `ProfileCollection.autoProfileCandidateIds?: string[]` en plus d'un `VoiceProfile` normal marqué `id: "auto"` — mais un `VoiceProfile` complet exige aujourd'hui un `tts: TtsBindingSchema` non optionnel (ligne 128), donc un profil « Auto » sans TTS propre ne validerait pas tel quel contre `VoiceProfileObjectSchema` sans changement de schéma. Les deux options touchent `migrateProfileCollection` (`vscode-extension/src/profiles/migrations.ts`, `CURRENT_PROFILE_SCHEMA_VERSION = 2`, ligne 45) si elles changent la forme du document |
| 2.7 | Réglages `package.json` à ajouter | `vscode-extension/package.json` (`contributes.configuration.properties`, section commençant ligne 566) | Modèle direct : bloc `llmVoice.narrator.*` (lignes 629-649 : `provider`, `baseUrl`, `model`, `timeoutMs`) et `llmVoice.tts.provider` avec son `enum`/`enumDescriptions` incluant déjà `"auto"` (lignes 608-628). Un bloc `llmVoice.decision.*` symétrique (`provider` avec enum `["none", "ollama"]`, `baseUrl` par défaut `http://127.0.0.1:11434`, `model`, `timeoutMs`) suivrait exactement ce patron. `llmVoice.profiles.bySource` (lignes 572-597) est aussi le point où l'utilisateur configure aujourd'hui le repli sans Ollama cité dans la décision |

## 3. Contrat de données proposé (calqué sur `NarrationRequest`/`NarrationResult`, non implémenté)

Basé sur `vscode-extension/src/core/narration.ts` (lignes 26-52), en substituant « segments à réécrire »
par « profils candidats à choisir » :

- **Requête** (nom proposé `DecisionRequest`, non créé) :
  - `state: string` — texte de la réponse Claude (ou du document capturé), **tronqué** à une longueur
    bornée avant l'appel (paramètre à définir, ex. proche de `NarrationRequest.maxOutputTokens`, ligne 34) ;
  - `options: readonly { id: string; label: string }[]` — les 3-4 profils candidats (probablement les
    profils existants hors « Auto » lui-même, ou un sous-ensemble configurable) ;
  - `timeoutMs?: number` — même rôle que `NarrationRequest.timeoutMs`.
- **Réponse** (nom proposé `DecisionResult`, non créé) :
  - `profileId: string` — le profil choisi ;
  - `distribution: readonly { id: string; probability: number }[]` — les logprobs convertis en
    probabilités par option à une lettre, dans l'esprit de SemIf (§10 de `decision-models-jev-v1.md` :
    « distribution A p=1.000, B p=0.000, C p=0.000 ») ;
  - `degraded: boolean` / `degradedReason?: DecisionDegradedReason` — même mécanique que
    `NarrationResult.degraded`/`NarrationDegradedReason` (`narration.ts` lignes 39-52).
- **Erreurs et mode dégradé** : `NarrationDegradedReason` (`"provider-unavailable" | "invalid-structured-output" |
  "timeout" | "cancelled" | "budget-exceeded" | "user-disabled"`, ligne 39-45) couvre déjà tous les cas
  plausibles pour un `DecisionProvider` ; un type `DecisionDegradedReason` dédié pourrait être un simple
  alias ou un sous-ensemble du même union type. Le repli sur échec doit être, par construction de la
  décision du 2026-09-27 : **résolution via `llmVoice.profiles.bySource`** (§1.2 ci-dessus), jamais un
  blocage de la lecture — cohérent avec « narration failure must never prevent playback » déjà écrit en
  tête de `narration.ts` (ligne 3), qui vaudrait de la même façon ici : « une décision en échec ne doit
  jamais empêcher la lecture ».

## 4. Risques et invariants touchés (P0 n°1-5, `_grimoire/_memory/shared-context.md`)

| Invariant P0 | Touché ? | Comment |
|---|---|---|
| 1. Zéro autoplay | Oui, mais préservé si l'insertion reste au point 1.3 | La résolution « Auto » doit se produire **à l'intérieur** de `startInternal`, jamais dans un watcher/callback non déclenché par une commande (ex. jamais dans `InboxWatcher.onChange`, dont le commentaire ligne 1613 de `Pipeline.ts` dit explicitement qu'il « never reaches `startInternal`/`PlaybackController` ») |
| 2. Local-first | Oui, directement | SemIf sur Ollama reste local (`http://127.0.0.1:11434`, même host que le narrateur) ; le texte de la réponse Claude ne quitte la machine que si un futur provider cloud (Jev) est un jour activé derrière `privacy.localOnly = false` — hors périmètre de cette tâche |
| 3. Provider agnostic | Oui | Le contrat `DecisionProvider` (2.1) doit permettre `NoDecisionProvider`/`OllamaDecisionProvider`/futurs `LayaDecisionProvider`/`JevDecisionProvider` sans changer `Pipeline.startInternal` — même garantie que `NarratorProvider` aujourd'hui |
| 4. Profils configurables plutôt que modes codés en dur | Oui | Le choix entre représentations 2.6(a)/2.6(b) doit éviter de coder en dur la liste des 3-4 profils candidats dans `Pipeline.ts` ; `llmVoice.profiles.bySource` ou un nouveau réglage doit rester la source de configuration |
| 5. Modèles jamais embarqués dans le VSIX | Non applicable | SemIf ne charge aucun modèle propre : il lit les logits d'un modèle déjà servi par Ollama (`qwen2.5:*`), déjà téléchargé séparément par l'utilisateur — aucun changement de ce côté |

### Points de test unitaire à prévoir (pas écrits dans cette tâche)

- `resolveDefaultProfileId`/`ProfileRepository.getSelected` : id `"auto"` reconnu et distingué d'un id de
  profil ordinaire inconnu (qui doit continuer à replier silencieusement).
- `createDecisionProvider` : mapping `providerId` → implémentation, repli neutre pour un id non reconnu
  (même structure de test que `createNarratorProvider`, non ouvert dans cette tâche — **non vérifié** s'il
  existe un fichier de test dédié aujourd'hui).
- `OllamaDecisionProvider.decide()` (nom provisoire) : parsing des `logprobs`/`top_logprobs` d'`/api/generate`,
  repli `degraded: true` sur HTTP non-ok, timeout, annulation — même famille de cas que
  `OllamaNarrator.transform()` (`OllamaNarrator.ts` lignes 104-143).
- `Pipeline.startInternal` : un profil « Auto » résolu vers un profil concret ne casse pas
  `currentProfileLabel`/le badge 🔒-☁ (`refreshLocalModeBadge`, ligne 1347) ni la persistance
  `lastSelectedId` (à décider : persiste-t-on « auto » ou le profil résolu ? — point ouvert, non tranché ici).

## 5. Table finale — Fichier → rôle dans le mode Auto

> Chemins vérifiés par lecture directe pendant cette tâche (`Read`), sauf mention contraire. Un script de
> lint peut vérifier l'existence de chacun.

| Fichier | Rôle dans le mode Auto |
|---|---|
| `_grimoire-output/planning-artifacts/decision-models-jev-v1.md` | Étude et arbitrage source (SemIf/Ollama retenu, §2/§5/§6/§10) |
| `_grimoire/_memory/decisions-log.md` | Journal — entrée du 2026-09-27 actant la décision à cartographier |
| `_grimoire/_memory/shared-context.md` | Source des invariants P0 n°1-5 cités en §4 |
| `vscode-extension/src/profiles/ProfileRepository.ts` | Point d'usage 1.1 : résolution du profil actif (`getSelected`), à faire reconnaître un id réservé « Auto » |
| `vscode-extension/src/profiles/bySource.ts` | Point d'usage 1.2 : priorité par source de capture (`resolveDefaultProfileId`), peut déjà retourner `"auto"` sans changement |
| `vscode-extension/src/pipeline/Pipeline.ts` | Points d'usage 1.3/1.4/1.9 (`startInternal`, `selectProfile`/`selectProfileById`, `speakLatestClaudeResponse`/`speakInboxEntry`) ; points d'implémentation 2.4/2.5 (`egress`, `resolveTtsProviderConfig`/`autoSelectTts` comme patron), 2.6 (usage de `tts.providerId: "auto"` comme précédent) ; site probable de `narratorFor` (2.2 modèle) |
| `vscode-extension/src/ui/StatusBar.ts` | Point d'usage 1.5 : menu clic, entrée « Changer de profil » existante, aucun changement structurel |
| `vscode-extension/src/views/profiles/ProfilesTreeProvider.ts` | Point d'usage 1.6 : vue dédiée Profils, source de la liste affichée |
| `vscode-extension/src/profiles/profileQuickPick.ts` | Point d'usage 1.7 : formatage d'un profil en item Quick Pick (`formatProfileQuickPickItem`), badge 🔒/☁ à traiter pour « Auto » |
| `vscode-extension/src/claude/InboxQuickPick.ts` | Point d'usage 1.8 : Quick Pick de l'inbox Claude, bouton « Select profile » |
| `vscode-extension/src/commands/PipelineFacade.ts` | Point d'usage 1.10 : interface `PipelineFacade`, contrat des méthodes exposées aux commandes |
| `vscode-extension/src/commands/index.ts` | Point d'usage 1.10 : enregistrement des commandes `llmVoice.selectProfile`/`llmVoice.speakLatestClaudeResponse` |
| `vscode-extension/src/core/narration.ts` | Modèle direct du contrat `DecisionProvider` à créer (2.1) |
| `vscode-extension/src/narrator/createNarratorProvider.ts` | Modèle direct de la fabrique par `providerId` à créer (2.2) |
| `vscode-extension/src/narrator/OllamaNarrator.ts` | Modèle direct de l'implémentation Ollama à créer (2.3), y compris le repli dégradé |
| `vscode-extension/src/narrator/shared.ts` | Modèle des utilitaires de repli/timeout (`fallbackResult`, `withTimeout`) réutilisables pour `DecisionProvider` |
| `vscode-extension/src/net/EgressGuard.ts` | Point d'implémentation 2.4 : passage obligé de tout appel réseau, y compris Ollama pour la décision |
| `vscode-extension/src/pipeline/resolveProviderConfig.ts` | Point d'implémentation 2.5 : patrons de résolution setting/profil et de bascule « auto » à réutiliser |
| `vscode-extension/src/core/profile.schema.ts` | Point d'implémentation 2.6 : schéma de profil, précédent `tts.providerId: "auto"`, contrainte `tts` non optionnel |
| `vscode-extension/src/core/profile.ts` | Point d'implémentation 2.6 : types `VoiceProfile`/`ProfileCollection` à faire évoluer ou non |
| `vscode-extension/src/profiles/migrations.ts` | Point d'implémentation 2.6 : migration de schéma si la forme de `profiles.json` change (`CURRENT_PROFILE_SCHEMA_VERSION`) |
| `vscode-extension/src/profiles/defaults.ts` | Contexte : les profils par défaut existants (candidats potentiels du mode Auto) |
| `vscode-extension/src/core/health.ts` | Modèle de `ProviderHealth`, réutilisable tel quel pour `DecisionProvider.health()` |
| `vscode-extension/src/core/index.ts` | Point d'implémentation 2.1 : où le futur `export * from "./decision.js"` s'ajouterait |
| `vscode-extension/package.json` | Point d'implémentation 2.7 : réglages `llmVoice.*` à ajouter, modèle `llmVoice.narrator.*`/`llmVoice.tts.provider` |

### Non vérifié (mentionné mais non ouvert dans cette tâche)

- `vscode-extension/src/ui/statusBarText.ts` (formatage exact du texte de la barre d'état)
- `vscode-extension/src/views/profiles/profileTreeItems.ts` (formatage des lignes de la vue Profils)
- Existence d'un test unitaire dédié à `createNarratorProvider` aujourd'hui
- Comportement exact de l'API native Ollama `/api/generate` avec `logprobs`/`top_logprobs` sur des
  options à une lettre au-delà de la preuve ponctuelle déjà citée dans `decisions-log.md` (2026-09-27) —
  non ré-exécutée dans cette tâche
