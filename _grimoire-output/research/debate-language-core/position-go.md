# Position GO — LLM Voice Core (daemon local de lecture/TTS/STT)

> Rédigé par l'avocat du GO dans un débat structuré. Objectif : bâtir le dossier le plus solide et honnête
> possible pour écrire le futur daemon "LLM Voice Core" (HTTP+WebSocket, localhost, single instance,
> spawné sans installation utilisateur) en **Go**, sans travestir les faits. Toute affirmation numérique
> est sourcée ; ce qui n'est pas vérifié est marqué comme tel en section 5.

## 1. Thèse en 5 lignes

Go est le langage qui minimise le risque d'exécution d'un daemon audio/IA locale qu'une équipe d'agents
IA doit écrire, tester et faire tourner sur 5 cibles (Linux/Windows/macOS × arch) sans jamais demander à
l'utilisateur d'installer un runtime. Il offre des bindings officiels ou quasi officiels pour les trois
briques dures (sherpa-onnx, whisper.cpp, ONNX Runtime), un client Ollama déjà maintenu par le projet
Ollama lui-même, une bibliothèque websocket minimale posée sur `net/http`, et une réputation de
production éprouvée pour exactement ce type de logiciel (Docker, `gh`, Ollama sont eux-mêmes des daemons/
CLI Go). Le vrai risque n'est pas le langage mais l'ampleur du portage : ~5 000 à 7 000 lignes TypeScript
déjà testées (pipeline, playback, providers TTS) devront être réécrites et re-testées, ce qui n'est
défendable que si le contrat HTTP/WebSocket est figé dès le jour 1 et que le périmètre du Core est réduit
au strict nécessaire (audio + moteurs IA natifs), en laissant le découpage de phrases et l'orchestration
Ollama côté extension TypeScript tant que rien ne l'oblige à bouger.

## 2. Preuves citées par critère

### 2.1 Performance / latence audio

- Le GC de Go a été amené à des pauses **sous la milliseconde** depuis Go 1.5, y compris sur de très
  gros tas ([Taming Go's GC — DEV](https://dev.to/jones_charles_ad50858dbc0/taming-gos-garbage-collector-for-blazing-fast-low-latency-apps-24an) ;
  [Pusher — Golang's real-time GC in theory and practice](https://pusher.com/blog/golangs-real-time-gc-in-theory-and-practice/)).
  Le GC est concurrent (ne "stoppe le monde" que pour le scan initial des racines et la terminaison du
  mark phase), pas un GC "stop-the-world" classique.
- Pour un daemon qui fait de l'orchestration réseau (appels Ollama, appels serveur TTS HTTP) plutôt que
  du calcul intensif, le goulot d'étranglement documenté est la latence des appels amont (les modèles),
  pas le runtime : dans un comparatif Rust/Go pour l'infra IA 2026, un test de charge réel montre que le
  débit est dominé par le pool de connexions et la concurrence en amont, pas par le langage
  ([Rust vs Go for AI Infrastructure in 2026 — DEV](https://dev.to/gabrielanhaia/rust-vs-go-for-ai-infrastructure-in-2026-heres-what-the-benchmarks-actually-say-4j28)).
- Un article "Python vs Go vs Rust pour les agents IA 2026" avance que Go tient des centaines de sessions
  d'agents concurrentes avec streaming en 30-60 Mo de RAM et une image Docker de 18 Mo déployée en moins
  d'une seconde ([Python vs Go vs Rust for AI Agents in 2026 — DEV](https://dev.to/thedailyagent/python-vs-go-vs-rust-for-ai-agents-in-2026-a-pragmatic-field-guide-5fda)) —
  chiffre non ré-audité par nos soins, à traiter comme un ordre de grandeur d'un tiers, pas une mesure du
  projet.

### 2.2 Écosystème IA locale (TTS/STT/VAD)

- **sherpa-onnx** publie une API Go officielle documentée, avec des paquets prébuildés par plateforme
  (`k2-fsa/sherpa-onnx-go-linux`, `-windows`, `-macos`) — exactement les moteurs déjà retenus dans la
  veille briques existantes du projet (Apache-2.0, pivot TTS/STT/VAD sans Python)
  ([Go API — sherpa 1.3 docs](https://k2-fsa.github.io/sherpa/onnx/go-api/index.html) ;
  [sherpa-onnx-go-linux — pkg.go.dev](https://pkg.go.dev/github.com/k2-fsa/sherpa-onnx-go-linux)).
  Cela nécessite `CGO_ENABLED=1`.
- **whisper.cpp** publie des bindings Go officiels (`bindings/go`, licence MIT identique au projet)
  avec une API idiomatique (`whisper.New()`, `NewContext()`, `Process()`, `NextSegment()`)
  ([whisper.cpp/bindings/go — pkg.go.dev](https://pkg.go.dev/github.com/ggerganov/whisper.cpp/bindings/go)).
- **ONNX Runtime** a fusionné un binding Go **officiel** le 2026-08-13 (`microsoft/onnxruntime#29615`,
  module `github.com/microsoft/onnxruntime/go`, nécessite cgo et Go 1.26) — très récent, à traiter avec
  prudence (voir §5). En attendant sa maturation, `github.com/yalue/onnxruntime_go` charge dynamiquement
  la bibliothèque partagée ONNX Runtime sans dépendre des sources du runtime, et fonctionne aussi bien
  sous Windows qu'ailleurs ([onnxruntime_go — pkg.go.dev](https://pkg.go.dev/github.com/yalue/onnxruntime_go)).
  Une variante `purego` (zéro appel cgo) existe aussi pour ce même besoin
  ([ONNX Runtime Go Binding: Zero-CGO Calls via purego — Medium](https://medium.com/@davidshuaiche/onnx-runtime-go-binding-zero-cgo-calls-via-purego-fd81b6db41e0)).
- **Ollama** — le projet Ollama est lui-même écrit en Go (et C/TypeScript pour d'autres parties)
  ([Ollama — Wikipedia](https://en.wikipedia.org/wiki/Ollama)) et publie son propre client Go officiel,
  `github.com/ollama/ollama/api`, maintenu avec le cœur du projet et utilisé par le CLI Ollama lui-même
  pour parler au service — c'est donc le choix le plus sûr en termes de compatibilité avec les évolutions
  d'API (logprobs compris) ([ollama/api — pkg.go.dev](https://pkg.go.dev/github.com/ollama/ollama/api) ;
  [ollama/api/types.go](https://github.com/ollama/ollama/blob/main/api/types.go)). Aucun équivalent aussi
  "officiel" n'existe côté TypeScript : le client Ollama actuel du projet TTS-Voice
  (`OpenAICompatibleNarrator.ts`) est un client HTTP maison à réaligner manuellement à chaque évolution.
- Aucune brique GPU-lourde "SOTA" (XTTS-v2, Chatterbox, F5-TTS, CosyVoice) n'a de binding Node ni Go —
  ce sont des sidecars Python/Docker dans tous les cas, donc ce critère ne différencie pas Go de
  TypeScript pour Chatterbox HTTP (déjà un simple client HTTP dans les deux langages) — voir note de
  la veille briques existantes du projet.

### 2.3 Lecture audio native (pause/reprise/position/gapless)

- **malgo** (`gen2brain/malgo`) : bindings cgo vers miniaudio ; "ne nécessite aucun lien sur
  Windows/macOS et ne lie que `-ldl` sous Linux/BSD" ; couvre WASAPI/DirectSound/WinMM (Windows),
  PulseAudio/ALSA/JACK (Linux), CoreAudio (macOS/iOS), OSS/audio(4)/sndio (BSD)
  ([gen2brain/malgo — GitHub](https://github.com/gen2brain/malgo)).
- **gominiaudio** (`darkliquid/mago` et forks) : réimplémentation **pure Go, sans cgo**, de miniaudio,
  ciblant spécifiquement les sous-systèmes audio modernes — WASAPI (Windows), **PipeWire** (Linux),
  CoreAudio (macOS) — donc directement pertinente pour la machine de dev Fedora/PipeWire du projet, sans
  aucune des douleurs de compilation croisée cgo décrites en §2.4
  ([mago — GitHub](https://github.com/darkliquid/mago)).
- **miniaudio** (le C sous-jacent des deux bindings ci-dessus) expose nativement le "data source
  chaining" — enchaîner plusieurs décodeurs en une seule source logique lue en continu, le pattern même
  du "gapless chunk chaining" demandé — et une primitive de seek/position,
  `ma_sound_seek_to_pcm_frame()` ([Data Source Chaining — miniaud.io](https://miniaud.io/docs/examples/data_source_chaining.html) ;
  [data_source_chaining.c — GitHub](https://github.com/mackron/miniaudio/blob/master/examples/data_source_chaining.c)).
- **beepout** (`ancientcatz/beepout`), un module speaker pour l'écosystème `beep` porté sur malgo, expose
  directement `Pause()`/`Resume()` sur son type `Speaker`
  ([beepout — GitHub](https://github.com/ancientcatz/beepout)).
- Comparé à la recherche déjà faite côté Node (`lecture-audio-native.md`,
  `controle-lecture-native-et-gapless.md` du projet) : aucune option Node "zero-compile" ne coche
  pause+resume+seek+position (node-speaker/naudiodon/audify exigent `node-gyp`, ou n'exposent pas de
  pause/seek) — la seule option Node "zero-compile multi-plateforme maintenue" identifiée,
  `node-web-audio-api`, est elle-même un binding Rust/NAPI, pas du JS pur, et n'a pas de `pause()` par
  source (il faut reconstruire l'état à la main via `AudioContext.suspend()/resume()`). Côté Go,
  **gominiaudio livre l'équivalent en pur Go, sans dépendre d'un autre langage compilé en coulisses.**

### 2.4 Packaging multi-plateforme

- `vsce` supporte `--target` depuis la 1.99.0 pour publier un VSIX par plateforme
  (`win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `linux-armhf`, `alpine-x64`, `alpine-arm64`,
  `darwin-x64`, `darwin-arm64`, `web`) — mécanique déjà documentée dans la veille du projet
  (`Briques existantes pour LLM Voice.md`), donc le "coût plateforme" (~5 cibles CI, autant de VSIX) est
  indépendant du langage du Core.
- Le point spécifique à Go : la compilation croisée pure Go (sans cgo) fonctionne "out of the box" en
  changeant `GOOS`/`GOARCH` ; dès que du cgo est nécessaire (sherpa-onnx, whisper.cpp, ONNX Runtime),
  **Go désactive cgo par défaut en cross-compilation** et il faut un compilateur C cible
  ([onnxruntime_go cross-compilation discussion — Medium résumé](https://medium.com/@diogok/on-golang-static-binaries-cross-compiling-and-plugins-1aed33499671)).
  La solution documentée en 2025-2026 est d'utiliser **Zig comme `CC`/`CXX`** (`zig cc -target ...`),
  intégré à GoReleaser via un exemple officiel (`goreleaser/example-zig-cgo`) — "Zig fait marcher la
  cross-compilation Go" est devenu un pattern reconnu
  ([GoReleaser — Cookbook CGO](https://goreleaser.com/cookbooks/cgo-and-crosscompiling/) ;
  [example-zig-cgo — GitHub](https://github.com/goreleaser/example-zig-cgo) ;
  [Zig Makes Go Cross Compilation Just Work — DEV](https://dev.to/kristoff/zig-makes-go-cross-compilation-just-work-29ho)).
- Alternative pour éviter cgo dans le binaire du daemon lui-même : `gominiaudio` (pur Go, §2.3) pour
  l'audio, `purego`/binding dynamique pour ONNX Runtime (§2.2), ce qui réduirait la matrice CI à une
  compilation croisée pure Go pour la partie audio+réseau, et ne garderait le cgo que pour les moteurs
  IA à charger dynamiquement — un compromis à concevoir, pas encore éprouvé pour ce projet précis.
- Un binaire Go est **statique par défaut** (hors cgo) : `CGO_ENABLED=0 go build` produit un exécutable
  sans dépendance dynamique à distribuer, ce qui simplifie le "spawn sans installation" comparé à un
  runtime Node embarqué (Electron a déjà ce problème documenté pour `ELECTRON_RUN_AS_NODE`, cf.
  `architectures-et-dialogue-vocal.md` du projet) ou à un venv Python.

### 2.5 Productivité des agents IA (Claude et consorts) sur ce langage

- Go serait l'un des langages "tier 1" cités comme chemin de production optimal aux côtés de TypeScript
  et Python dans un article 2026 sur le choix de langage pour agents IA
  ([Choosing the Right LLM in 2025 — Gocodeo](https://www.gocodeo.com/post/choosing-the-right-llm-in-2025)) —
  **affirmation de blog, non un benchmark contrôlé** (voir §5).
  Le même article avance que "94 % des erreurs de code générées par LLM sont liées au typage" et que
  TypeScript les attrape à la compilation — donné ici pour être honnête sur l'argument adverse, mais
  ce chiffre n'a pas de méthodologie vérifiable trouvée dans cette recherche (voir §5). Go a lui aussi un
  typage statique (moins expressif que TS côté génériques/unions, mais statique) et un compilateur qui
  échoue vite et fort — ce qui capture une bonne partie de la même classe d'erreurs pour un agent qui
  itère.
- Le benchmark **Aider Polyglot** évalue les LLM sur 225 exercices Exercism répartis sur C++, Go, Java,
  JavaScript, Python et Rust ([Aider Polyglot — Epoch AI](https://epoch.ai/benchmarks/aider-polyglot)) —
  preuve qu'un langage "à froid" comme Go est bien dans la distribution testée par la communauté agent
  coding, mais **aucune décomposition par langage n'a pu être récupérée dans cette recherche** (gap,
  voir §5) : impossible d'affirmer que Go se situe au-dessus ou en dessous de Rust/TS sur ce benchmark
  précis.
- Argument structurel indépendant d'un benchmark : Go a une syntaxe volontairement réduite (pas de
  généricité complexe façon Rust, gestion d'erreurs explicite `if err != nil`, un seul formateur `gofmt`
  non négociable) — une surface de langage plus petite est structurellement plus facile à faire produire
  de façon cohérente par un agent que l'espace de conception beaucoup plus large de Rust (lifetimes,
  traits, unsafe, ownership). Ceci est un raisonnement, pas une mesure sourcée pour ce projet.

### 2.6 Sûreté

- Go est un langage à mémoire gérée (GC), donc pas de classe de bugs "use-after-free"/"buffer overflow"
  manuel comme en C/C++ — pertinent puisque le Core touche à des buffers audio bruts et des bindings cgo
  vers du C (miniaudio, sherpa-onnx, ONNX Runtime, whisper.cpp).
  Go inclut un détecteur de races intégré à l'outillage standard (`go test -race`, `go build -race`),
  utile pour un daemon fortement concurrent (WebSocket + lecture audio + appels HTTP simultanés).
- **Concession honnête** : Go n'offre pas les garanties du compilateur Rust (pas de borrow checker, pas
  d'interdiction de data race à la compilation — seulement à l'exécution via le race detector, et
  seulement si le chemin de code est exercé par les tests). Rust reste categorically plus sûr sur ce
  critère précis ; voir §4.

### 2.7 Réutilisation du code existant

- Mesure directe du dépôt (`wc -l`, 2026-09-27) : `vscode-extension/src/pipeline/Pipeline.ts` = 2 329
  lignes, `tts/SystemTtsProvider.ts` = 885, `playback/PlaybackController.ts` = 593,
  `playback/AudioQueue.ts` = 586, `tts/ChatterboxProvider.ts` = 407, `playback/DiskAudioCache.ts` = 300,
  `net/EgressGuard.ts` = 296, `tts/PiperSetup.ts` = 284, `parser/MarkdownParser.ts` = 273,
  `net/verifyLocalMode.ts` = 272, `playback/SessionFactory.ts` = 261, `tts/presets.ts` = 248,
  `parser/Segmenter.ts` = 246, `core/audioValidation.ts` = 232, `net/AssetDownloader.ts` = 215,
  `tts/OpenAICompatibleTtsProvider.ts` = 205, `playback/AudioCache.ts` = 209,
  `parser/SentenceSplitter.ts` = 186, `narrator/OpenAICompatibleNarrator.ts` = 182 — soit environ
  **5 000 à 6 000 lignes** concentrées dans playback + tts + net + parser, sur un total de 16 664 lignes
  dans `src/`. **Aucune de ces lignes n'est réutilisable telle quelle en Go** : c'est une réécriture
  complète du pipeline audio/TTS, pas un portage mécanique.
- Ce qui, à l'inverse, **n'a pas besoin de bouger** dans le Core si l'architecture le permet : le
  découpage de phrases (`Segmenter.ts`, `SentenceSplitter.ts`, `MarkdownParser.ts`), les profils
  (`ProfileRepository.ts`), l'éditeur de profils (webview), l'onboarding, et l'orchestration
  Ollama/logprobs peuvent rester côté extension TypeScript, qui n'a besoin d'envoyer au Core que des
  phrases déjà découpées et des requêtes de synthèse — ce qui réduit le périmètre réel du portage aux
  seuls modules qui *doivent* sortir du process Node pour des raisons de plateforme (audio hors webview,
  bindings cgo natifs). C'est un choix d'architecture à trancher, pas un fait acquis.
- Les 956 tests unitaires et 63 tests d'intégration headless couvrent aujourd'hui l'ensemble TypeScript ;
  aucune mesure trouvée dans ce projet sur la proportion de ces tests qui couvre spécifiquement les
  modules candidats au portage (playback/tts/net) par opposition à parser/profils/UI — à vérifier avant
  tout chiffrage de "coût de re-test" (voir §5).

### 2.8 Coût de migration

- Contrat partagé : `oapi-codegen` génère du code serveur/client Go depuis une spec OpenAPI 3
  ([oapi-codegen — GitHub](https://github.com/oapi-codegen/oapi-codegen)), et `openapi-typescript` génère
  des types TypeScript "runtime-free" depuis la même spec
  ([openapi-typescript — openapi-ts.dev](https://openapi-ts.dev/6.x/introduction)). Une seule spec
  OpenAPI (ou schémas JSON Schema/Zod exportés) peut donc piloter le typage des deux côtés de la
  frontière HTTP/WebSocket, ce qui borne le risque de dérive de contrat — un investissement identique
  quel que soit le langage choisi pour le Core (Go, Rust ou même un sous-process Node), donc pas un
  argument différenciant Go/Rust, mais un prérequis à budgéter dans tous les cas.
- Le websocket Go recommandé, `coder/websocket` (ex-`nhooyr.io/websocket`, maintenant maintenu par
  Coder), s'appuie directement sur `net/http.Client`/`ResponseWriter` pour le handshake, fait 2 200
  lignes contre 3 500 pour `gorilla/websocket`, et supporte `context.Context`
  ([coder/websocket — GitHub](https://github.com/coder/websocket)) — une base légère pour l'API
  HTTP+WebSocket demandée, sans dépendance lourde.
- Spawn/mise à jour du binaire : le pattern documenté par `rust-analyzer` (binaire téléchargé dans le
  répertoire d'installation de l'extension, avec prompt de mise à jour automatique) et par Tabnine
  (binaire natif embarqué + process partagé unique entre fenêtres) sont directement transposables à un
  Core Go (cf. `architectures-et-dialogue-vocal.md` du projet) — ce n'est pas un problème spécifique à
  Go, mais un pattern éprouvé qu'un daemon Go peut suivre à l'identique.
- Cas remote/SSH/WSL/Codespaces : la même recherche du projet établit que la composante qui joue le son
  doit être de type d'extension `["ui"]` (toujours exécutée sur la machine physique de l'utilisateur),
  indépendamment du langage du Core — un daemon Go spawné localement respecte cette contrainte aussi
  bien qu'un daemon Node ou Rust ; ce n'est donc pas un facteur qui favorise ou défavorise Go
  spécifiquement.

### 2.9 Maintenance

- Réputation de production pour ce type exact de logiciel : Docker et `gh` (GitHub CLI) sont des
  binaires Go uniques largement déployés comme daemons/CLI locaux ; Ollama — le propre fournisseur LLM
  local du projet — est écrit en Go (et C/TypeScript pour d'autres composants),
  ([Ollama — Wikipedia](https://en.wikipedia.org/wiki/Ollama)) ce qui signifie que l'écosystème
  d'outillage (client API, patterns de service local) que le Core devra imiter est **le même écosystème
  Go** que celui du fournisseur LLM déjà choisi par le projet.
- Un seul binaire statique par plateforme réduit la surface de maintenance "runtime à jour" comparée à
  un sous-process Node embarqué (versions Node/Electron à synchroniser, cf. le piège
  `ELECTRON_RUN_AS_NODE`/`original-fs` documenté dans la veille du projet) ou à un environnement Python
  (venv, wheels par plateforme).
- Le standard de la bibliothèque Go (`net/http`, `context`, `testing`, `-race`) est nativement outillé
  pour ce genre de service — moins de dépendances tierces à auditer dans la durée qu'un projet Node
  équivalent qui accumule des paquets pour websocket, HTTP, et bindings audio séparés.

## 3. Plan de migration réaliste

1. **Contrat d'abord (semaine 0)** : figer une spec OpenAPI (ou JSON Schema exporté depuis les schémas
   Zod déjà utilisés côté TS, `core/profile.schema.ts`) décrivant HTTP+WebSocket entre l'extension et le
   Core. Générer les deux côtés (`oapi-codegen` pour Go, `openapi-typescript` pour TS) avant d'écrire une
   ligne de logique métier. Ce contrat devient la seule source de vérité, testée par des tests de contrat
   symétriques (voir point 6).
2. **Réduire le périmètre du Core au strict nécessaire** : décider explicitement ce qui *doit* sortir du
   process Node (lecture audio native, bindings sherpa-onnx/whisper.cpp/ONNX Runtime, TTS système via
   API OS) contre ce qui *peut rester* côté TypeScript (segmentation de phrases, profils, appel Ollama
   avec logprobs, cache de haut niveau). Documenter ce choix comme une décision ADR avant tout portage,
   car il détermine si l'on porte ~2 000 lignes ou ~6 000.
3. **Spike daemon minimal (1-2 semaines)** : squelette Go — serveur HTTP+WS (`net/http` + `coder/websocket`),
   verrou single-instance (fichier de lock + port), health check, spawn/arrêt propre depuis l'extension —
   sans encore de vrai moteur audio, pour valider le cycle spawn/version/mise à jour du binaire (pattern
   rust-analyzer/Tabnine).
4. **Portage audio** : implémenter play/pause/resume/seek/position/gapless avec `gominiaudio` (pur Go,
   PipeWire/WASAPI/CoreAudio) en priorité pour éviter la cross-compilation cgo ; garder `malgo` en
   solution de repli si `gominiaudio` s'avère trop jeune en usage réel (voir §5). Porter la logique de
   `AudioQueue.ts`/`PlaybackController.ts` (état, transitions, chaînage gapless) en Go, avec une suite de
   tests Go équivalente et des tests de contrat HTTP/WS qui rejouent les scénarios déjà couverts par les
   956 tests unitaires côté TS pour les comportements observables migrés.
5. **Portage moteurs IA** : intégrer sherpa-onnx (Go officiel) et whisper.cpp (Go officiel) pour le
   "plus tard" STT/VAD ; pour le "maintenant" TTS, Piper via sherpa-onnx si retenu, Chatterbox via un
   simple client HTTP Go (aucune complexité ajoutée par rapport à TS ici), TTS système via appel de
   binaires OS (SAPI/AVSpeechSynthesizer/speech-dispatcher) — vérifier au cas par cas si
   `SystemTtsProvider.ts` (885 lignes) encapsule déjà surtout des appels `child_process`, auquel cas le
   portage Go est mécanique (Go a un `os/exec` équivalent).
6. **Client Ollama** : remplacer le client HTTP maison par `github.com/ollama/ollama/api` côté Core (si
   l'appel Ollama migre dans le Core) ou le garder côté TS (si le choix du point 2 est de ne pas migrer
   l'orchestration LLM) — trancher explicitement, ne pas dupliquer la logique dans les deux langages.
7. **Packaging** : matrice CI GoReleaser + `zig cc` pour les cibles nécessitant cgo (sherpa-onnx,
   whisper.cpp, ONNX Runtime), build pur Go sinon ; intégration dans `vsce package --target` par
   plateforme (mécanique déjà documentée dans le projet, indépendante du langage).
8. **Gate de parité avant bascule** : faire tourner en parallèle, sur la machine de dev (Linux
   AMD/ROCm), le Core Go et l'implémentation TS existante derrière un feature flag ; ne couper
   l'implémentation TS qu'après un dogfooding mesuré (durée à définir par l'équipe) sans régression sur
   les 17 critères d'acceptation du cahier des charges, puis étendre à Windows/macOS en bêta avant de
   retirer le code TS legacy. Chaque étape passe par une carte du Mission Ledger avec gate de preuve,
   conformément aux conventions du projet.

## 4. Concessions : où Rust et TypeScript gagnent

**Rust gagne sur** :
- L'absence totale de GC élimine par construction la classe de risque "pause impromptue pendant la
  lecture" — même sous-milliseconde et rare, un pic de latence Go reste possible sous pression mémoire,
  alors que Rust n'a structurellement pas cette classe de bug
  ([Rust vs Go for AI Infrastructure in 2026 — DEV](https://dev.to/gabrielanhaia/rust-vs-go-for-ai-infrastructure-in-2026-heres-what-the-benchmarks-actually-say-4j28)).
- Les garanties de sûreté mémoire/concurrence à la **compilation** (borrow checker, `Send`/`Sync`) sont
  strictement plus fortes que ce que Go peut offrir (race detector = détection à l'exécution, sur les
  chemins exercés par les tests seulement).
- L'écosystème audio Rust (`cpal`, `rodio`) et les bindings sherpa-onnx/whisper.cpp existent aussi en
  Rust (via `napi-rs` pour exposer un module natif à Node, notamment) — Go n'a pas de monopole sur ces
  moteurs.
- **Le développeur humain du projet préfère Rust** (fait de contexte donné dans la mission) — un facteur
  de motivation et de vélocité à long terme non réductible à une métrique technique, et qui pèse lourd
  puisque les agents IA écrivent la majorité du code mais un humain doit rester capable de le relire, le
  déboguer et le faire évoluer en dernier recours.

**TypeScript gagne sur** :
- **Coût de migration nul** : 100 % du code existant, des 956 tests unitaires et des 63 tests
  d'intégration headless restent valides sans aucune réécriture. C'est l'argument le plus fort en faveur
  du statu quo — tout langage de Core alternatif (Go compris) part avec une dette de portage et de
  re-test que TypeScript n'a pas.
- **Un seul langage pour toute l'équipe** (humain + agents Claude), pas de frontière de contrat à
  maintenir entre deux bases de code, pas de double outillage CI/lint/test.
- La sortie de l'audio hors webview ne signifie pas nécessairement sortir de Node : un sous-process Node
  pur (bundlé) peut héberger le daemon HTTP+WS, au prix des mêmes bibliothèques natives cgo/node-gyp
  déjà documentées comme pénibles côté recherche du projet (`node-speaker`, `naudiodon`, `audify`) — donc
  ce n'est pas un free lunch, mais cela évite le changement de langage lui-même.
- Le typage structurel de TypeScript (unions, génériques, inférence) est plus expressif que celui de Go
  pour modéliser les schémas de profils/segments déjà écrits avec Zod — un portage vers les `struct` Go
  perdrait une partie de cette expressivité ou demanderait plus de code pour la retrouver.

## 5. Faits non vérifiés (à confirmer avant toute décision engageante)

- **Aucune décomposition par langage** du benchmark Aider Polyglot (Go vs Rust vs TypeScript) n'a été
  trouvée dans cette recherche — seule l'existence du benchmark et sa liste de langages sont confirmées
  ([Aider Polyglot — Epoch AI](https://epoch.ai/benchmarks/aider-polyglot)).
- Le chiffre "94 % des erreurs de code générées par LLM sont liées au typage" (blog Gocodeo) n'a pas de
  méthodologie vérifiable identifiée dans cette recherche — à traiter comme une affirmation non
  qualifiée, pas un fait établi.
- **Aucun benchmark contrôlé et reproductible** comparant la qualité/productivité d'agents de codage IA
  spécifiquement sur Go vs Rust vs TypeScript n'a été trouvé (seulement des articles de blog/opinion
  2025-2026) — à traiter comme un point ouvert, pas un argument tranché dans un sens ou l'autre.
- La maturité et l'usage en production de **gominiaudio** (pur Go, sans cgo) ne sont pas vérifiés au-delà
  de sa description GitHub — pas de retour d'expérience trouvé sur sa robustesse sous PipeWire en
  conditions réelles, ni sur sa couverture de tests.
- Taille de binaire finale et temps de démarrage à froid d'un daemon Go embarquant sherpa-onnx/ONNX
  Runtime via cgo : **non mesurés**, non trouvés dans cette recherche pour ce cas d'usage précis.
- Le binding Go **officiel** d'ONNX Runtime (fusionné le 2026-08-13, nécessite Go 1.26) est trop récent
  pour avoir un historique de fiabilité en production — à ré-évaluer avant de le retenir plutôt que le
  wrapper `yalue/onnxruntime_go`, plus ancien et éprouvé.
- Aucune source trouvée (dans cette passe ni dans la veille précédente du projet) sur les bugs connus de
  malgo/gominiaudio/miniaudio spécifiquement sous PipeWire/Wayland, la gestion de session audio Windows
  11, ou le sandboxing macOS — un vrai trou de recherche, identique à celui déjà signalé côté Node.
- La proportion exacte des 956 tests unitaires et 63 tests d'intégration headless qui couvre les modules
  candidats au portage (playback/tts/net) par opposition aux modules qui resteraient en TypeScript
  (parser/profils/UI) n'a pas été mesurée — nécessaire pour chiffrer sérieusement le coût de re-test
  avant de lancer la migration.
- Aucun chiffrage trouvé (ni dans cette recherche ni dans la veille du projet) du temps de build CI ou du
  coût récurrent réel d'une matrice à 5 cibles avec cgo + Zig, à mesurer sur ce projet plutôt qu'estimé
  a priori.
