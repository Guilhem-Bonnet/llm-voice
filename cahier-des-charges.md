# Cahier des charges — LLM Voice pour Visual Studio Code

**Nom de travail :** LLM Voice
**Version :** 1.0
**Date :** 8 septembre 2026
**Type :** Extension Visual Studio Code + services locaux optionnels
**Plateforme prioritaire :** VS Code Desktop sous Linux
**Objectif à terme :** Linux, Windows et macOS

---

# 1. Résumé du projet

LLM Voice est une extension Visual Studio Code permettant de transformer du contenu textuel présent dans l'environnement de développement en **contenu vocal naturel et contrôlable par l'utilisateur**.

Le système doit pouvoir notamment :

* lire un document Markdown ;
* lire une sélection ;
* lire depuis la position actuelle du curseur ;
* lire du texte provenant du presse-papiers ;
* récupérer passivement les réponses finales de Claude Code ;
* permettre à l'utilisateur de faire prononcer une réponse de LLM à la demande ;
* transformer facultativement un texte avant sa lecture grâce à un LLM ;
* utiliser différents profils de narration ;
* utiliser plusieurs voix ;
* fonctionner entièrement en local ;
* mettre en évidence dans l'éditeur la partie actuellement lue ;
* proposer lecture, pause, reprise, arrêt, précédent et suivant.

Le système **ne doit jamais démarrer automatiquement une lecture audio** à la fin d'une réponse de Claude, Copilot ou d'un autre agent.

Le principe est :

```text
Source
  │
  ├── Markdown
  ├── sélection VS Code
  ├── presse-papiers
  ├── Claude Code
  └── autre adaptateur futur
  │
  ▼
Segmentation
  │
  ▼
Profil
  │
  ├── transformation LLM facultative
  │
  └── paramètres de voix
  │
  ▼
TTS
  │
  ▼
Audio
  │
  ├── Play / Pause / Stop
  └── synchronisation avec la source
```

---

# 2. Vision du produit

Le projet ne doit pas être conçu comme :

> « une extension Claude qui lit ses réponses ».

Il doit être conçu comme :

> **une couche audio universelle entre le contenu de VS Code et l'utilisateur.**

Claude Code, Markdown, Copilot ou le presse-papiers sont uniquement des **sources de contenu**.

De même, Chatterbox, Kokoro ou un service distant sont uniquement des **providers TTS**.

Cette séparation doit permettre de remplacer une brique sans modifier le reste du système.

---

# 3. Principes fondamentaux

## 3.1 Déclenchement manuel

Aucune action provenant d'un agent ne doit provoquer directement du son.

Claude Code peut déposer une réponse dans une Inbox.

Il ne peut pas déclencher la lecture.

```text
Claude termine
     ↓
réponse enregistrée
     ↓
Inbox LLM Voice

        RIEN NE PARLE

Utilisateur
     ↓
▶ Lire
     ↓
audio
```

C'est une exigence fonctionnelle prioritaire **P0**.

---

## 3.2 Local-first

La configuration par défaut doit permettre :

```text
VS Code
  ↓
LLM local facultatif
  ↓
TTS local
  ↓
audio local
```

Une fois les modèles téléchargés, aucun contenu n'a besoin de quitter la machine.

Les providers cloud pourront être ajoutés, mais ils ne doivent pas constituer une dépendance architecturale.

---

## 3.3 Provider agnostic

L'extension ne doit contenir aucune dépendance forte à :

* Chatterbox ;
* Kokoro ;
* Ollama ;
* Claude ;
* Copilot ;
* OpenAI ;
* ElevenLabs.

Chaque système doit être derrière une interface.

---

## 3.4 Profils plutôt que modes codés en dur

`Professeur`, `Résumé Claude`, `Lecture fidèle` ou `Vulgarisation` ne doivent pas être des fonctionnalités indépendantes codées dans l'application.

Ce sont des **profils configurables**.

Exemple :

```text
Profil : Professeur technique

Narration :
  transformation = oui

Prompt :
  "Explique le contenu comme un professeur
   d'informatique. Utilise des exemples..."

Voix :
  Chatterbox / FR Teacher

Vitesse :
  0.95

Expressivité :
  0.65
```

L'utilisateur peut donc fabriquer ses propres comportements sans modifier l'extension.

---

# 4. Distinction importante : narration et TTS

Deux opérations différentes doivent être distinguées.

## Narration

Détermine **ce qui est dit**.

Exemple :

```text
Markdown :
"readinessProbe détermine si un Pod
peut recevoir du trafic."

        ↓ LLM

Narration :
"La readiness probe répond essentiellement
à une question : est-ce que mon application
est prête à recevoir des utilisateurs ?"
```

## Synthèse vocale

Détermine **comment cela est prononcé**.

```text
Narration
   ↓
voix
intonation
rythme
expressivité
vitesse
   ↓
Audio
```

Une bonne formulation provient donc principalement du **Narrator**, alors que l'intonation et le timbre proviennent du **TTS**.

---

# 5. Cas d'usage principaux

| ID    | Cas d'usage                                      |        Priorité |
| ----- | ------------------------------------------------ | --------------: |
| UC-01 | Lire le Markdown actuellement ouvert             |              P0 |
| UC-02 | Lire uniquement une sélection                    |              P0 |
| UC-03 | Lire à partir du curseur                         |              P0 |
| UC-04 | Pause / reprise / arrêt                          |              P0 |
| UC-05 | Surligner le contenu actuellement lu             |              P0 |
| UC-06 | Choisir un profil avant la lecture               |              P0 |
| UC-07 | Transformer le texte avec un prompt personnalisé |              P0 |
| UC-08 | Utiliser un TTS complètement local               |              P0 |
| UC-09 | Récupérer les réponses finales de Claude Code    |              P0 |
| UC-10 | Lire manuellement une réponse Claude capturée    |              P0 |
| UC-11 | Lire le presse-papiers                           |              P1 |
| UC-12 | Naviguer précédent/suivant entre les segments    |              P1 |
| UC-13 | Reprendre la lecture d'un document               |              P1 |
| UC-14 | Gérer plusieurs profils                          |              P1 |
| UC-15 | Résumer une réponse Claude avant de la prononcer |              P1 |
| UC-16 | Utiliser un provider TTS cloud                   |              P2 |
| UC-17 | Intégration Copilot automatique                  | P2 / dépend API |
| UC-18 | Alignement mot par mot                           |              P2 |
| UC-19 | Exporter la narration en fichier audio           |              P2 |
| UC-20 | Interaction vocale utilisateur / STT             |        Hors MVP |

---

# 6. UX générale

L'extension doit exposer un View Container ou une vue dédiée nommée par exemple :

```text
LLM VOICE
```

VS Code autorise les extensions à contribuer des vues et Tree Views dans la Sidebar ou le Panel. Les Tree Views doivent être privilégiées lorsque des composants natifs suffisent.

La vue pourrait contenir trois sections.

```text
LLM VOICE
─────────────────────────

NOW PLAYING

Readiness Probe
Cours Kubernetes.md

03:12 / 18:42

━━━━━━●━━━━━━━━━━

⏮    ▶/⏸    ⏭    ■

Profil
Professeur technique ▾

─────────────────────────

INBOX

Claude • backend-api
✓ Refactoring terminé
il y a 25 sec

Claude • k8s-lab
✓ Deployment corrigé
il y a 2 min

─────────────────────────

PROFILES

🎓 Professeur technique
🎧 Lecture fidèle
🤖 Résumé LLM
⚡ Révision rapide
```

---

# 7. Commandes VS Code

Les commandes doivent être accessibles depuis la Command Palette et être assignables à des raccourcis clavier.

VS Code fournit nativement `registerCommand`, `contributes.commands` et les keybindings pour ce type d'intégration.

Commandes recommandées :

```text
LLM Voice: Speak Document
LLM Voice: Speak Selection
LLM Voice: Speak From Cursor
LLM Voice: Speak Clipboard

LLM Voice: Play
LLM Voice: Pause
LLM Voice: Stop
LLM Voice: Previous Segment
LLM Voice: Next Segment

LLM Voice: Select Profile
LLM Voice: Open Profiles

LLM Voice: Open Inbox
LLM Voice: Speak Latest Claude Response

LLM Voice: Clear Highlight
LLM Voice: Clear Audio Cache
```

Aucun raccourci ne doit être imposé de manière agressive.

Des raccourcis par défaut peuvent éventuellement être proposés uniquement s'ils n'entrent pas en conflit avec les raccourcis VS Code usuels.

---

# 8. Status Bar

Un seul élément doit être utilisé.

Par exemple :

```text
$(unmute) Professeur
```

Pendant la lecture :

```text
$(debug-pause) 03:12 • Professeur
```

Au clic :

```text
▶ Reprendre
■ Arrêter
🎙 Changer de profil
```

Microsoft recommande de limiter le nombre d'éléments ajoutés à la Status Bar et d'utiliser des labels courts.

---

# 9. Player

Le player doit proposer au minimum :

```text
Play
Pause
Resume
Stop

Previous
Next

Progression

Vitesse
Profil
Volume
```

Le player doit être unique pour une instance VS Code.

Une Webview View peut être justifiée pour le player car les contrôles audio HTML nécessitent davantage de personnalisation qu'une Tree View. VS Code recommande néanmoins de limiter les Webviews aux interfaces pour lesquelles les composants standards sont insuffisants.

Les Webviews VS Code prennent officiellement en charge l'audio :

* WAV ;
* MP3 ;
* OGG ;
* FLAC.

**Format interne recommandé MVP : WAV.**

---

# 10. Sources de texte

Toute source doit implémenter conceptuellement :

```ts
interface SourceAdapter {
    id: string;

    canCapture(context: CaptureContext): boolean;

    capture(
        context: CaptureContext
    ): Promise<SourceDocument>;
}
```

## 10.1 MarkdownSource

Lit un fichier `.md`.

Doit supporter :

* document complet ;
* depuis le curseur ;
* sélection ;
* section courante ;
* heading courant à heading suivant.

---

## 10.2 TextSelectionSource

Fonctionne avec n'importe quel document texte.

Exemples :

```text
.ts
.cs
.py
.txt
.yaml
.json
.md
```

La fonctionnalité ne doit donc pas être artificiellement limitée à Markdown.

---

## 10.3 ClipboardSource

Utilise le Clipboard API de VS Code.

Cette API est particulièrement intéressante avec Remote Development car VS Code garantit que son presse-papiers correspond au presse-papiers local de l'utilisateur.

---

## 10.4 ClaudeCodeSource

Alimente une Inbox depuis les hooks Claude Code.

Voir section dédiée.

---

## 10.5 CopilotSource

MVP :

```text
sélection
ou
copier → Speak Clipboard
```

Pas de scraping DOM.

Pas de lecture du stockage interne de Copilot.

Pas de dépendance à une API privée.

---

# 11. Parsing Markdown

Le Markdown ne doit jamais être envoyé brut au TTS.

Exemple source :

````markdown
## Readiness Probe

Une **readiness probe** permet de savoir
si un pod peut recevoir du trafic.

```yaml
readinessProbe:
  httpGet:
    path: /health
````

````

Une couche de parsing doit produire un AST.

Librairie recommandée :

```text
unified
+
remark-parse
````

`remark-parse` transforme le Markdown en MDAST et les nœuds possèdent des positions dans le document source, ce qui convient particulièrement bien au système de synchronisation.

Exemple conceptuel :

```text
root
├── heading
│   position 1:1 → 1:19
│
├── paragraph
│   position 3:1 → 4:35
│
└── code
    position 6:1 → 10:4
```

---

# 12. Types de blocs

Le Parser doit reconnaître au minimum :

```text
heading
paragraph
list
listItem
blockquote
code
inlineCode
link
image
table
thematicBreak
```

Chaque profil peut définir la manière de traiter certains blocs.

---

# 13. Politique de lecture du Markdown

Exemple de configuration :

```json
{
  "markdown": {
    "headings": "read",
    "links": "labelOnly",
    "images": "altText",
    "code": "explain",
    "tables": "summarize",
    "frontmatter": "skip"
  }
}
```

Modes possibles pour le code :

```text
skip
read
explain
summarize
```

Exemple :

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 8080
```

Ne doit pas nécessairement donner :

> readiness probe deux points, h t t p get deux points…

Un profil `Professeur` peut produire :

> « Ici la vérification consiste à appeler l'endpoint health sur le port 8080. »

---

# 14. Segmentation

Une unité appelée `SourceSegment` doit être créée.

```ts
interface SourceSegment {
    id: string;

    sourceUri?: string;

    sourceRange?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    };

    type:
      | "heading"
      | "sentence"
      | "paragraph"
      | "code"
      | "list"
      | "other";

    rawText: string;

    spokenText?: string;
}
```

---

# 15. Synchronisation et surlignage

VS Code expose `TextEditor.setDecorations()` et les objets `Range`, ce qui permet de mettre visuellement en évidence une portion précise d'un document.

Deux modes de synchronisation doivent être distingués.

## 15.1 Lecture fidèle

```text
Source
  ↓
phrase
  ↓
TTS
```

Le `sourceRange` correspond directement à la phrase.

Pendant sa lecture :

```text
Lorem ipsum.

[Cette phrase est actuellement prononcée.]

Phrase suivante.
```

Une fois l'audio terminé, le highlight passe au segment suivant.

### Niveau MVP

**Surlignage phrase ou petit groupe de phrases.**

---

## 15.2 Narration transformée

Source :

```text
La readiness indique si le Pod peut recevoir du trafic.
```

Narration :

> « Imagine un restaurant : être vivant ne signifie pas forcément être prêt à recevoir des clients… »

La correspondance mot à mot est impossible.

Le système conserve donc :

```text
NarrationSegment
    │
    ├── spokenText
    │
    └── sourceRange
```

Le paragraphe d'origine est surligné pendant toute la narration correspondante.

---

# 16. Alignement mot par mot

**Non requis dans le MVP.**

Chatterbox et Kokoro ne fournissent pas actuellement à l'extension une timeline fiable mot par mot dans leur API de base.

Un alignement forcé pourrait être ajouté ultérieurement avec un système spécialisé.

Mais cela ajouterait :

```text
TTS
 ↓
audio
 ↓
forced aligner
 ↓
timestamps par mot
```

avec un coût supplémentaire en complexité et calcul.

La synchronisation phrase/bloc répond déjà à l'objectif principal :

> savoir où la lecture en est dans le document.

---

# 17. Auto-scroll

Lors du changement de segment, l'extension peut utiliser les primitives de l'éditeur pour révéler la Range active.

Comportement :

```text
segment suivant
      ↓
highlight
      ↓
si hors écran
      ↓
scroll doux / revealRange
```

Ne pas recentrer l'écran inutilement si le segment est déjà visible.

---

# 18. Profil utilisateur

Du point de vue UX, **voix et narration appartiennent au même profil**.

Exemple :

```json
{
  "id": "teacher-tech-fr",
  "name": "Professeur technique",

  "language": "fr",

  "narration": {
    "enabled": true,
    "provider": "ollama",
    "model": "local-model",
    "prompt": "Tu es un professeur d'informatique..."
  },

  "tts": {
    "provider": "chatterbox-local",
    "voice": "teacher-fr",
    "speed": 0.95,
    "exaggeration": 0.65,
    "cfgWeight": 0.4
  },

  "markdown": {
    "code": "explain",
    "links": "labelOnly",
    "images": "altText"
  },

  "synchronization": {
    "mode": "block"
  }
}
```

---

# 19. Profils fournis par défaut

## Lecture fidèle

```text
Transformation LLM : non
Code : skip
Vitesse : 1.0
Synchronisation : phrase
```

## Professeur technique

```text
Transformation : oui

Prompt :
"Transforme la section en explication orale
pédagogique et naturelle.

Ne donne jamais l'impression de lire des notes.

Conserve tous les concepts importants.

Explique le code plutôt que d'en réciter
la syntaxe.

Ajoute des analogies lorsqu'elles améliorent
réellement la compréhension."

Synchronisation : bloc
```

## Résumé LLM

```text
Transformation : oui

Prompt :
"Présente oralement le résultat comme un
collègue développeur.

Commence par ce qui a été réalisé.

Mentionne les problèmes ou limitations.

Termine par ce qu'il reste éventuellement
à faire.

Sois concis et naturel."
```

## Révision rapide

```text
Transformation : oui

Prompt :
"Transforme le contenu en révision orale.
Conserve uniquement les concepts, pièges
et éléments essentiels à retenir."
```

Ces profils doivent être modifiables et supprimables.

---

# 20. Provider de narration

Interface :

```ts
interface NarratorProvider {
    id: string;

    health(): Promise<ProviderHealth>;

    transform(
        request: NarrationRequest
    ): Promise<NarrationSegment[]>;
}
```

---

# 21. Narrator local recommandé : Ollama

Ollama expose par défaut son API locale à :

```text
http://localhost:11434/api
```

et fournit notamment `POST /api/chat`.

L'intérêt principal pour LLM Voice est la prise en charge des **structured outputs**.

Ollama permet de demander une sortie conforme à un JSON Schema.

On peut donc envoyer :

```text
BLOCK_001
<contenu>

BLOCK_002
<contenu>
```

et demander :

```json
{
  "segments": [
    {
      "sourceIds": ["BLOCK_001"],
      "spokenText": "..."
    },
    {
      "sourceIds": ["BLOCK_002"],
      "spokenText": "..."
    }
  ]
}
```

Cela rend la correspondance narration → source beaucoup plus robuste.

---

# 22. Alternative Narrator : llama.cpp

`llama.cpp` fournit également un serveur HTTP compatible avec une partie de l'API OpenAI, notamment les chat completions, et permet l'utilisation de modèles GGUF locaux.

L'architecture devra donc permettre :

```text
OllamaNarrator
LlamaCppNarrator
OpenAICompatibleNarrator
```

sans modifier le pipeline principal.

---

# 23. TTS Provider

Interface cible :

```ts
interface TtsProvider {
    id: string;

    health(): Promise<ProviderHealth>;

    getCapabilities(): Promise<TtsCapabilities>;

    listVoices?(): Promise<Voice[]>;

    synthesize(
        request: TtsRequest
    ): Promise<AudioResult>;
}
```

Exemple :

```ts
interface TtsRequest {
    text: string;

    language?: string;
    voice?: string;

    speed?: number;

    parameters?: Record<string, unknown>;
}
```

---

# 24. TTS local principal : Chatterbox Multilingual V3

Au 8 septembre 2026, Resemble AI présente **Chatterbox Multilingual V3** comme la dernière version multilingue généraliste de Chatterbox.

Le modèle conserve environ **0,5 milliard de paramètres**, supporte notamment le français et propose le voice conditioning / voice cloning à partir d'un échantillon audio.

Le repository officiel fournit explicitement un exemple :

```text
language_id="fr"
```

pour générer du français.

Chatterbox propose également des paramètres comme :

```text
exaggeration
cfg_weight
temperature
```

qui peuvent agir sur la génération et l'expressivité.

Le projet officiel est sous licence MIT.

**Provider recommandé par défaut :**

```text
Chatterbox Multilingual V3
```

---

# 25. Serveur Chatterbox

L'extension ne doit pas embarquer directement PyTorch, ROCm ou le modèle.

Architecture :

```text
VS Code
  │ HTTP localhost
  ▼
TTS Server
  │
  ▼
Chatterbox
  │
  ▼
GPU / CPU
```

Un projet communautaire existant, `Chatterbox-TTS-Server`, expose notamment :

```text
POST /tts
POST /v1/audio/speech
GET  /v1/audio/voices
```

et permet du streaming audio.

Son endpoint `/v1/audio/speech` est conçu pour être compatible avec l'API TTS OpenAI, ce qui en fait une bonne **référence d'intégration**, sans imposer que LLM Voice dépende de ce serveur précis.

---

# 26. AMD RDNA4

Le serveur communautaire de référence documente désormais une configuration spécifique Linux pour :

```text
RX 9070
RX 9070 XT
Radeon AI PRO R9700
gfx1201
```

avec ROCm 7.2+ recommandé pour ce chemin d'installation.

Cela rend Chatterbox particulièrement intéressant comme première implémentation locale sur une machine RDNA4 moderne.

Ce support appartient cependant au **serveur communautaire**, et non au contrat de LLM Voice.

LLM Voice ne doit donc jamais exposer dans son code :

```text
if GPU == RX9070 ...
```

Il doit uniquement parler à un endpoint HTTP.

---

# 27. Alternative légère : Kokoro

Kokoro reste intéressant comme provider secondaire.

Le projet décrit Kokoro comme un modèle TTS de seulement **82 millions de paramètres**, sous licence Apache 2.0.

Il est donc beaucoup plus léger.

En revanche, le support français est actuellement nettement plus limité : la documentation des voicepacks ne référence qu'une voix française et avertit que certains supports non anglais sont moins riches.

Recommandation :

```text
Chatterbox
→ priorité qualité / français / personnalisation

Kokoro
→ priorité légèreté / rapidité / fallback
```

---

# 28. API TTS standardisée

Autant que possible, le provider générique doit cibler :

```text
POST /v1/audio/speech
```

Cela permettra d'utiliser plusieurs backends compatibles sans écrire une intégration complète pour chacun.

Puis les capacités spécifiques peuvent être ajoutées via :

```ts
ChatterboxProvider extends OpenAICompatibleTtsProvider
```

afin d'exposer :

```text
exaggeration
cfg_weight
voice conditioning
etc.
```

---

# 29. Pipeline complet

```text
SOURCE ADAPTER
      │
      ▼
SourceDocument
      │
      ▼
Markdown/Text Parser
      │
      ▼
SourceSegments
      │
      ├───────────────┐
      │               │
      │ Narration OFF │ Narration ON
      │               │
      │               ▼
      │        NarratorProvider
      │               │
      │               ▼
      │       NarrationSegments
      │               │
      └───────┬───────┘
              ▼
          TTS Queue
              │
              ▼
        TtsProvider
              │
              ▼
         AudioChunks
              │
              ▼
           Player
          /      \
         /        \
      audio      sourceRange
         \        /
          \      /
           ▼    ▼
          Highlight
```

---

# 30. AudioChunk

```ts
interface AudioChunk {
    id: string;

    sessionId: string;

    spokenText: string;

    sourceRanges: SourceRange[];

    audioUri: string;

    durationMs?: number;

    status:
      | "pending"
      | "generating"
      | "ready"
      | "playing"
      | "played"
      | "error";
}
```

---

# 31. PlaybackSession

```ts
interface PlaybackSession {
    id: string;

    profileId: string;

    source: SourceDocument;

    segments: NarrationSegment[];

    chunks: AudioChunk[];

    currentChunkIndex: number;

    state:
      | "idle"
      | "preparing"
      | "playing"
      | "paused"
      | "stopped"
      | "completed"
      | "error";
}
```

---

# 32. Génération progressive

Il ne faut pas attendre la génération de tout un cours de 45 minutes.

Pipeline :

```text
segment 1 → TTS → PLAY

pendant PLAY :
segment 2 → TTS
segment 3 → TTS

segment 1 terminé
     ↓
segment 2 déjà disponible
```

On obtient un système de **prefetch**.

Paramètre recommandé :

```text
prefetchChunks = 2 ou 3
```

---

# 33. Taille des chunks

Il existe un compromis.

### Très petits chunks

```text
+ highlight précis
+ faible attente initiale
- prosodie potentiellement moins naturelle
```

### Gros paragraphes

```text
+ meilleure continuité vocale
- highlight moins précis
- génération initiale plus longue
```

Valeur recommandée :

### Lecture fidèle

```text
1 à 3 phrases
```

### Narration

```text
1 bloc logique / paragraphe
```

La valeur doit pouvoir être modifiée par provider.

---

# 34. State machine du player

```text
             ┌──────────┐
             │   IDLE   │
             └────┬─────┘
                  │ Play
                  ▼
            ┌───────────┐
            │ PREPARING │
            └─────┬─────┘
                  ▼
             ┌─────────┐
        ┌───▶│ PLAYING │◀─────┐
        │    └────┬────┘      │
        │         │ Pause     │ Resume
        │         ▼           │
        │    ┌────────┐       │
        │    │ PAUSED │───────┘
        │    └────────┘
        │
        │ Next
        │
        └──────────────

Stop
 ↓
STOPPED

dernier chunk
 ↓
COMPLETED
```

---

# 35. Comportement Pause

`Pause` doit :

* suspendre l'audio ;
* conserver le chunk courant ;
* conserver le highlight ;
* conserver la position intra-chunk si le player le permet ;
* ne pas vider les chunks préchargés.

---

# 36. Comportement Stop

`Stop` doit :

* arrêter immédiatement l'audio ;
* remettre la lecture à zéro ;
* annuler les générations non nécessaires ;
* retirer le highlight ;
* conserver éventuellement les fichiers du cache.

---

# 37. Cache audio

Le cache évite de recalculer plusieurs fois la même phrase.

Clé recommandée :

```text
SHA256(
   provider
 + model
 + voice
 + parameters
 + spokenText
)
```

Ainsi :

```text
même texte
+ même voix
+ mêmes paramètres
=
même audio
```

---

# 38. Stockage VS Code

VS Code fournit notamment :

```text
workspaceState
globalState
storageUri
globalStorageUri
SecretStorage
```

et recommande `globalStorageUri` pour les fichiers globaux plus volumineux.

Utilisation proposée :

```text
globalState
→ dernier profil
→ préférences légères

globalStorageUri
→ cache audio
→ index inbox
→ métadonnées

SecretStorage
→ éventuelles API keys cloud
```

`SecretStorage` chiffre les secrets et ne les synchronise pas entre machines.

---

# 39. Claude Code : intégration

Claude Code expose officiellement des hooks de cycle de vie.

Le hook `Stop` est déclenché lorsque l'agent principal termine sa réponse.

L'entrée contient notamment :

```json
{
  "session_id": "...",
  "transcript_path": "...",
  "cwd": "...",
  "hook_event_name": "Stop",
  "last_assistant_message": "..."
}
```

`last_assistant_message` contient directement le texte final de Claude, sans devoir parser la transcription.

C'est l'intégration à privilégier.

---

# 40. Claude Collector

Le hook ne contacte pas le TTS.

Il doit uniquement agir comme collecteur.

```text
Claude Code
   ↓ Stop
collector
   ↓
Inbox
```

Exemple de structure :

```json
{
  "schemaVersion": 1,

  "provider": "claude-code",

  "sessionId": "abc123",

  "capturedAt": "2026-09-08T15:00:00Z",

  "cwd": "/home/user/projects/backend",

  "message": "I've completed the refactoring..."
}
```

---

# 41. Inbox globale

Répertoire logique proposé :

```text
~/.llm-voice/inbox/
```

ou emplacement configurable :

```text
LLM_VOICE_INBOX
```

Fichier :

```text
20260908T150000-abc123-a8f91.json
```

Permissions POSIX :

```text
directory : 0700
files     : 0600
```

L'Inbox étant globale, les réponses provenant de plusieurs projets sont regroupées.

```text
Claude A ─┐
Claude B ─┤
Claude C ─┼──► ~/.llm-voice/inbox
Claude D ─┘
```

---

# 42. Claude Inbox UX

Exemple :

```text
CLAUDE
────────────────────────

backend-api
Refactoring completed
11:30
▶

k8s-course
Created probes chapter
11:26
▶

game-server
Found three race conditions
11:10
▶
```

Actions :

```text
▶ Speak
Open full response
Delete
Mark read
Select profile
```

---

# 43. Résumé Claude

Il n'est pas nécessaire que Claude fournisse un format particulier.

L'Inbox conserve la réponse complète.

Au clic :

```text
Claude response
     ↓
profil "Résumé LLM"
     ↓
Narrator local
     ↓
3-6 phrases naturelles
     ↓
TTS
```

Cela fonctionne même si la réponse Claude contient :

* des listes ;
* du code ;
* des chemins ;
* des résultats de tests ;
* de longs détails techniques.

---

# 44. Concurrence Claude

Cas :

```text
Projet A termine
Projet B termine
Projet C termine
Projet D termine
```

Résultat attendu :

```text
Inbox += 4

Audio = silence
```

Il ne doit exister **aucun chemin de code** :

```text
Claude Stop → Player.play()
```

Le chemin autorisé est :

```text
Claude Stop
   ↓
Inbox

Utilisateur Play
   ↓
Player
```

---

# 45. GitHub Copilot

La principale contrainte technique est l'accès aux conversations.

L'API Chat Participant de VS Code permet à un participant d'accéder à `context.history`, mais la documentation précise que seuls les messages associés au participant courant sont inclus.

Une extension tierce ne doit donc pas supposer qu'elle peut lire arbitrairement tout l'historique du Copilot Chat natif.

### MVP

Supporter :

```text
sélection de la réponse
→ Speak Selection
```

ou :

```text
Copy
→ Speak Clipboard
```

### À ne pas faire

```text
DOM scraping
lecture de fichiers internes Copilot
API privée
monkey patch de l'extension GitHub
```

Ces solutions seraient trop fragiles.

---

# 46. Intégration Copilot future

Une évolution possible est un participant :

```text
@voice
```

ou un agent propre à LLM Voice.

VS Code expose une Language Model API permettant aux extensions de construire des prompts et d'appeler les modèles disponibles dans l'environnement VS Code.

Exemple futur :

```text
@voice explique cette erreur
```

LLM Voice contrôle alors directement sa réponse et peut la rendre disponible au TTS.

Mais cela ne remplace pas l'accès aux anciennes conversations Copilot natives.

---

# 47. Gestion des profils

Actions :

```text
Create
Edit
Duplicate
Delete
Import
Export
Set Default
```

Un profil doit pouvoir être assigné par défaut selon la source.

Exemple :

```text
Markdown
→ Lecture fidèle

Claude Inbox
→ Résumé LLM

Clipboard
→ Dernier profil utilisé
```

---

# 48. Paramètres globaux

Exemple :

```text
llmVoice.defaultProfile

llmVoice.tts.baseUrl
llmVoice.tts.provider

llmVoice.narrator.provider
llmVoice.narrator.baseUrl
llmVoice.narrator.model

llmVoice.audio.prefetchChunks

llmVoice.highlight.enabled
llmVoice.highlight.mode

llmVoice.cache.enabled
llmVoice.cache.maxSizeMb

llmVoice.claude.inboxPath
llmVoice.claude.captureEnabled

llmVoice.privacy.telemetryEnabled
```

VS Code permet aux extensions de déclarer des paramètres via `contributes.configuration`, qui apparaissent directement dans l'éditeur de Settings.

Il ne faut pas recréer inutilement une page Settings complète dans une Webview ; les recommandations VS Code privilégient le Settings Editor pour les réglages classiques.

---

# 49. Gestion du profil via UI

En revanche, un **Profile Editor** dédié peut être justifié car un profil combine de nombreuses données structurées :

```text
Name
Prompt
Narrator
Model
Voice
Language
Speed
Expressivity
Markdown behavior
Highlight behavior
```

Exemple :

```text
PROFILE
────────────────────────

Name
[ Professeur technique ]

Narrator
[ Ollama ▼ ]

Model
[ qwen... ▼ ]

Narration instructions
┌─────────────────────────┐
│ Explique le contenu...  │
│                         │
└─────────────────────────┘

TTS
[ Chatterbox ▼ ]

Voice
[ Teacher FR ▼ ]

Speed
━━━━●━━━━ 0.95

Expressivity
━━━━━━●━━ 0.65

[ Test Voice ]

[ Save ]
```

---

# 50. Test Voice

Le Profile Editor doit fournir :

```text
▶ Test
```

avec un texte de référence configurable.

Exemple français :

> « Bonjour. Voici un exemple de ma voix. Nous allons maintenant examiner un concept technique et voir comment l'expliquer clairement. »

Cela permet de modifier :

```text
voix
speed
exaggeration
cfgWeight
```

sans démarrer un document complet.

---

# 51. Santé des providers

Chaque provider doit avoir un statut :

```text
● Ready
● Loading
● Offline
● Error
```

Exemple :

```text
Chatterbox
● Ready
localhost:8004

Ollama
● Ready
localhost:11434
```

Un provider hors ligne ne doit jamais faire planter l'extension.

---

# 52. Gestion des erreurs

Exemples :

### TTS indisponible

```text
Chatterbox is unavailable.

Retry
Open provider settings
```

### Narrator indisponible

L'utilisateur doit pouvoir choisir :

```text
Retry

Read without narration

Cancel
```

### Chunk TTS invalide

Retry maximum configurable, par défaut :

```text
2
```

Puis :

```text
Skip
Stop
```

---

# 53. Confidentialité

Configuration locale :

```text
Markdown
Claude responses
source code
prompts
audio
```

ne doivent quitter la machine à aucun moment.

Le mode local doit être clairement identifiable :

```text
🔒 Local
```

Si un provider distant est configuré :

```text
☁ Remote provider
```

l'UI doit indiquer clairement que le texte sera envoyé à ce provider.

---

# 54. Télémétrie

Recommandation :

```text
telemetry = OFF par défaut
```

Aucun contenu utilisateur ne doit être collecté.

Si une télémétrie est un jour ajoutée :

* uniquement métriques techniques anonymes ;
* jamais le texte ;
* jamais les prompts ;
* jamais les chemins ;
* jamais l'audio ;
* opt-in explicite.

---

# 55. Voice cloning

Chatterbox permet l'utilisation d'un échantillon audio comme référence de voix.

Le support peut être ajouté sous forme :

```text
Voice source:
○ predefined
○ reference audio
```

Les fichiers de référence restent locaux.

L'interface doit rappeler que l'utilisateur doit disposer des droits ou du consentement nécessaires pour utiliser la voix concernée.

---

# 56. Extension Host et Remote Development

Le TTS doit généralement fonctionner **sur la machine utilisateur**, puisque c'est elle qui possède :

* le GPU local ;
* les haut-parleurs ;
* Ollama local ;
* Chatterbox local.

VS Code distingue les extensions UI exécutées localement et les extensions Workspace pouvant être exécutées sur l'hôte distant.

Pour le MVP :

```json
"extensionKind": ["ui", "workspace"]
```

avec préférence UI à étudier/tester.

Le fonctionnement :

```text
Remote SSH
Dev Container
Codespaces
```

doit être considéré **non garanti dans le MVP**.

Une architecture split UI/workspace pourra être développée plus tard si l'accès simultané au contenu distant et aux ressources audio locales l'exige.

Microsoft documente justement l'utilisation d'extensions UI compagnons lorsque l'accès à une ressource locale est nécessaire depuis un environnement distant.

---

# 57. Technologies Extension

Recommandation :

```text
TypeScript
Node.js
VS Code Extension API
```

Parsing :

```text
unified
remark-parse
remark-gfm
```

Validation :

```text
Zod
```

Hash/cache :

```text
crypto Node.js
```

Aucun framework frontend lourd n'est nécessaire pour le MVP.

---

# 58. Architecture TypeScript proposée

```text
src/
│
├── extension.ts
│
├── commands/
│   ├── speakDocument.ts
│   ├── speakSelection.ts
│   ├── speakClipboard.ts
│   ├── playerCommands.ts
│   └── profileCommands.ts
│
├── sources/
│   ├── SourceAdapter.ts
│   ├── MarkdownSource.ts
│   ├── SelectionSource.ts
│   ├── ClipboardSource.ts
│   └── ClaudeInboxSource.ts
│
├── parser/
│   ├── MarkdownParser.ts
│   ├── Segmenter.ts
│   └── SpokenTextNormalizer.ts
│
├── narrator/
│   ├── NarratorProvider.ts
│   ├── NoNarrator.ts
│   ├── OllamaNarrator.ts
│   └── OpenAICompatibleNarrator.ts
│
├── tts/
│   ├── TtsProvider.ts
│   ├── OpenAICompatibleTtsProvider.ts
│   ├── ChatterboxProvider.ts
│   └── KokoroProvider.ts
│
├── playback/
│   ├── PlaybackController.ts
│   ├── PlaybackSession.ts
│   ├── AudioQueue.ts
│   └── AudioCache.ts
│
├── highlight/
│   ├── HighlightController.ts
│   └── SourceSynchronizer.ts
│
├── profiles/
│   ├── Profile.ts
│   ├── ProfileRepository.ts
│   └── defaults.ts
│
├── claude/
│   ├── ClaudeInbox.ts
│   └── ClaudeHookInstaller.ts
│
├── views/
│   ├── InboxTreeProvider.ts
│   ├── ProfileTreeProvider.ts
│   └── player/
│
└── infrastructure/
    ├── settings.ts
    ├── logger.ts
    └── storage.ts
```

---

# 59. Companion / integrations

Repository possible :

```text
llm-voice/
│
├── vscode-extension/
│
├── integrations/
│   └── claude-code/
│       ├── capture.py
│       ├── capture.sh
│       └── capture.ps1
│
├── docs/
│
└── examples/
    └── profiles/
```

Il n'est pas nécessaire de maintenir notre propre serveur TTS au début.

---

# 60. API interne : SourceDocument

```ts
interface SourceDocument {
    id: string;

    sourceType:
      | "markdown"
      | "text"
      | "clipboard"
      | "claude-code"
      | "copilot"
      | "external";

    title?: string;

    uri?: string;

    rawText: string;

    metadata?: Record<string, unknown>;

    capturedAt: number;
}
```

---

# 61. NarrationSegment

```ts
interface NarrationSegment {
    id: string;

    spokenText: string;

    sourceSegmentIds: string[];

    sourceRanges: SourceRange[];

    metadata?: Record<string, unknown>;
}
```

La relation :

```text
1 SourceSegment
→ 0..N NarrationSegments

N SourceSegments
→ 1 NarrationSegment
```

doit être autorisée.

---

# 62. Cancellation

Chaque étape longue doit accepter une cancellation.

```text
Narrator
TTS
prefetch
generation queue
```

Un `Stop` utilisateur doit interrompre les générations inutiles.

---

# 63. Performance

Objectifs UX :

### Commande

L'interface doit réagir immédiatement au clic.

### TTS

La lecture doit commencer dès que le premier chunk est disponible.

### Narration

Le Narrator ne doit pas traiter tout un long fichier avant de commencer.

Pipeline recommandé :

```text
section 1 → narrator → TTS → play

pendant play :
section 2 → narrator → TTS
```

---

# 64. Ressources GPU

Narrator et Chatterbox peuvent vouloir utiliser simultanément le même GPU.

Le système doit donc supporter différents modes :

```text
Parallel
Sequential
CPU narrator
GPU TTS
External narrator
```

Option recommandée initialement :

```text
TTS prioritaire
```

et éviter de lancer plusieurs générations TTS simultanées.

---

# 65. Queue globale de synthèse

Par instance :

```text
maxConcurrentTtsJobs = 1
```

par défaut.

Cela favorise :

* stabilité ;
* consommation VRAM ;
* ordre audio ;
* cohérence.

Le prefetch reste séquentiel.

---

# 66. Plusieurs fenêtres VS Code

Comme la lecture est manuelle, plusieurs projets terminant simultanément ne provoquent aucun conflit audio.

Une V2 pourra toutefois ajouter un verrou inter-processus :

```text
~/.llm-voice/player.lock
```

afin d'empêcher deux instances VS Code de parler en même temps.

Ce n'est pas bloquant pour le MVP.

---

# 67. Historique de lecture

P1 :

```text
History
────────────────────

Kubernetes.md
Professeur
12 min
73 %

Claude • backend
Résumé
1 min
100 %
```

Le document peut mémoriser :

```text
lastSourceRange
lastSegment
profileId
timestamp
```

---

# 68. Reprise de cours

Pour les longs Markdown :

```text
Speak Document
```

si une session précédente existe :

```text
Continue from 42 % ?

[ Continue ]
[ Start over ]
```

P1.

---

# 69. Raccourcis contextuels Markdown

Dans l'éditeur :

```text
Right click

LLM Voice
  Speak Selection
  Speak From Here
  Speak Section
  Speak Document
```

VS Code permet aux extensions de contribuer des context menus via ses Contribution Points.

---

# 70. Indication du segment courant

En plus du highlight :

```text
Now Playing
────────────────

Section
Readiness probes

Segment
8 / 42

Source
kubernetes-probes.md
```

---

# 71. Périmètre MVP 0.1

Doit contenir :

```text
✓ Extension TypeScript
✓ Speak Document
✓ Speak Selection
✓ Speak From Cursor
✓ Play
✓ Pause
✓ Stop
✓ Next / Previous
✓ Markdown parsing
✓ Highlight du segment
✓ Auto-scroll
✓ Profiles
✓ Custom narration prompt
✓ Ollama narrator
✓ OpenAI-compatible TTS
✓ Chatterbox provider
✓ Cache audio simple
✓ Claude Code passive inbox
✓ zéro lecture automatique
```

---

# 72. Version 0.2

```text
+ Profile editor complet
+ clipboard
+ resume document
+ history
+ voice browser
+ voice reference files
+ Kokoro provider
+ streaming amélioré
+ import/export profile
```

---

# 73. Version 0.3

```text
+ Copilot / VS Code chat participant
+ queue globale multi-window
+ Remote Development amélioré
+ cloud providers facultatifs
+ export audio
+ meilleure gestion des tableaux/code
```

---

# 74. Version 1.0

Objectif :

> Couche vocale stable et générique pour VS Code.

```text
Markdown
Text
Claude Code
Clipboard
Chat participant

        ↓

Narrator configurable

        ↓

TTS configurable

        ↓

Player synchronisé
```

---

# 75. Hors périmètre initial

Ne pas implémenter dans le MVP :

```text
STT
conversation vocale bidirectionnelle
voice assistant autonome
scraping Copilot
word-level forced alignment
éditeur Markdown propriétaire
moteur TTS propriétaire
entraînement de modèle
serveur cloud propriétaire
```

Ce sont des distractions par rapport au produit principal.

---

# 76. Tests unitaires

À tester :

```text
MarkdownParser
Segmenter
profile resolution
cache hashing
Claude payload parsing
sourceRange mapping
Narrator JSON validation
provider error handling
queue state machine
```

---

# 77. Tests d'intégration

VS Code fournit officiellement `@vscode/test-cli` et `@vscode/test-electron` pour lancer des tests dans une véritable instance VS Code Extension Host.

Tests :

```text
open markdown
↓
Speak Document
↓
segment créé
↓
highlight correct
```

```text
Play
↓
Pause
↓
position conservée
```

```text
Stop
↓
audio arrêté
↓
highlight supprimé
```

---

# 78. Fake providers de test

Ne pas exiger Chatterbox dans les tests CI.

Créer :

```ts
FakeNarratorProvider
FakeTtsProvider
```

Le FakeTTS génère ou utilise de très petits fichiers WAV prédéfinis.

Cela permet de tester toute la chaîne :

```text
source → parser → queue → player
```

sans GPU.

---

# 79. Tests Claude

Fixtures :

```text
Stop normal
Stop message long
Stop code
Stop empty
Stop unicode
Stop French
Stop concurrent x10
invalid JSON
```

Inbox :

```text
10 Claude instances
→ 10 fichiers distincts
→ aucun autoplay
```

---

# 80. Tests de confidentialité

Tests automatiques possibles :

```text
localOnly=true
```

doit garantir qu'aucune requête ne part vers une URL autre que :

```text
localhost
127.0.0.1
::1
```

sauf autorisation utilisateur explicite.

---

# 81. Logging

Créer un Output Channel :

```text
LLM Voice
```

Niveaux :

```text
error
warn
info
debug
```

Ne jamais logger :

```text
API keys
contenu intégral des documents
réponses Claude intégrales
audio
```

par défaut.

---

# 82. Critères d'acceptation MVP

Le MVP est considéré fonctionnel si tous les critères suivants sont vrais.

### AC-01

Sur un fichier Markdown :

```text
LLM Voice: Speak Document
```

commence une lecture.

### AC-02

La portion actuellement prononcée est visuellement identifiable.

### AC-03

Le highlight se déplace lorsque le segment change.

### AC-04

Pause suspend l'audio sans perdre la position.

### AC-05

Stop arrête immédiatement la lecture et retire le highlight.

### AC-06

Une sélection peut être lue indépendamment du reste du fichier.

### AC-07

Le profil peut sélectionner une voix différente.

### AC-08

Le profil peut contenir un prompt de narration personnalisé.

### AC-09

Un profil sans narration lit le contenu sans appel LLM.

### AC-10

Un profil avec narration passe par le Narrator configuré.

### AC-11

La configuration complète :

```text
VS Code
Ollama local
Chatterbox local
```

fonctionne sans service cloud après installation des modèles.

### AC-12

Un hook Claude Code peut ajouter une réponse à l'Inbox.

### AC-13

Ajouter une réponse Claude à l'Inbox ne produit **aucun son**.

### AC-14

Quatre Claude Code terminant simultanément créent quatre entrées sans déclencher de lecture.

### AC-15

Une réponse de l'Inbox peut être lue avec n'importe quel profil.

### AC-16

L'indisponibilité d'Ollama ou Chatterbox est signalée proprement sans crash VS Code.

### AC-17

Les clés éventuelles de providers distants sont stockées dans `SecretStorage`.

---

# 83. Definition of Done 1.0

Le produit peut être considéré 1.0 lorsque :

```text
✓ pipeline stable
✓ documentation installation
✓ installation locale Chatterbox documentée
✓ installation Ollama documentée
✓ plusieurs profils
✓ Markdown robuste
✓ Claude Inbox robuste
✓ tests automatisés
✓ Linux validé
✓ Windows validé
✓ macOS validé ou explicitement marqué partiel
✓ gestion erreurs propre
✓ absence d'autoplay
✓ politique confidentialité documentée
✓ VSIX générable
```

---

# 84. Publication

VS Code fournit `@vscode/vsce` pour empaqueter l'extension en VSIX ou la publier sur le Marketplace.

Développement initial :

```bash
vsce package
```

Résultat :

```text
llm-voice-x.y.z.vsix
```

Installation locale :

```bash
code --install-extension llm-voice-x.y.z.vsix
```

VS Code prend également officiellement en charge l'installation manuelle de fichiers VSIX.

---

# 85. Décisions architecturales finales recommandées

| Sujet                     | Décision                             |
| ------------------------- | ------------------------------------ |
| Déclenchement             | Manuel uniquement                    |
| Claude                    | Hook Stop → Inbox                    |
| Copilot                   | sélection/clipboard en MVP           |
| Texte                     | toute source texte, Markdown enrichi |
| Markdown parser           | remark / MDAST                       |
| Synchronisation MVP       | phrase/bloc                          |
| Synchronisation narration | bloc source                          |
| Synchronisation mot       | plus tard                            |
| Narrator local            | Ollama                               |
| Narrator alternatif       | llama.cpp / compatible OpenAI        |
| TTS principal             | Chatterbox Multilingual V3           |
| TTS fallback              | Kokoro                               |
| Communication TTS         | HTTP localhost                       |
| API TTS préférée          | `/v1/audio/speech`                   |
| Player                    | Webview légère                       |
| Inbox                     | Tree View                            |
| Settings                  | VS Code Settings                     |
| Profils                   | stockage LLM Voice                   |
| Secrets                   | SecretStorage                        |
| Cache                     | globalStorageUri                     |
| Télémétrie                | aucune par défaut                    |
| Modèles                   | jamais embarqués dans le VSIX        |
| GPU                       | géré par le serveur TTS              |
| Cloud                     | optionnel uniquement                 |

---

# 86. Architecture cible finale

```text
┌───────────────────────────────────────────────────┐
│                    VS CODE                        │
│                                                   │
│ Markdown  Selection  Clipboard  Claude  Chat      │
│    │          │          │        │       │       │
│    └──────────┴──────────┴────────┴───────┘       │
│                       │                           │
│                       ▼                           │
│                 SourceAdapter                     │
│                       │                           │
│                       ▼                           │
│               Parser / Segmenter                  │
│                       │                           │
│              ┌────────┴────────┐                  │
│              │                 │                  │
│              │           NarratorProvider         │
│              │                 │                  │
│              │                 ▼                  │
│              └────────── SpokenSegments           │
│                       │                           │
│                       ▼                           │
│                   TtsProvider                     │
│                       │                           │
│                       ▼                           │
│                   AudioQueue                      │
│                       │                           │
│               ┌───────┴───────┐                  │
│               ▼               ▼                  │
│             Player       Synchronizer             │
│               │               │                  │
│               ▼               ▼                  │
│              🔊           Highlight              │
└───────────────────────────────────────────────────┘
                 │                │
                 │ localhost      │ localhost
                 ▼                ▼
       ┌────────────────┐   ┌────────────────┐
       │     Ollama     │   │   Chatterbox   │
       │                │   │ Multilingual V3│
       │ local narrator │   │   local TTS    │
       └────────────────┘   └────────────────┘
```

---

# 87. Références techniques

### Visual Studio Code

**Extension API — documentation générale.**
Base officielle pour développer l'extension et accéder aux différentes APIs VS Code.

**Commands API.**
Enregistrement de commandes accessibles depuis la Palette, les raccourcis et l'interface.

**Tree View API.**
Création des vues Inbox et Profiles.

**VS Code Views UX Guidelines.**
Recommandations pour les Tree Views, View Containers et Webview Views.

**Webview API.**
Interface personnalisée et lecture des formats WAV, MP3, OGG et FLAC.

**Editor decorations.**
Référence permettant de surligner des `Range` dans l'éditeur.

**Status Bar Guidelines.**
Règles UX pour l'indicateur global du player.

**Contribution Points.**
Settings, commands, views, menus, keybindings et autres déclarations `package.json`.

**ExtensionContext / SecretStorage.**
Stockage des données globales et chiffrement des secrets.

**Remote Development / Extension Host.**
Différence entre UI Extension et Workspace Extension et implications pour les ressources locales.

**Chat Participant API.**
Historique des conversations et restriction aux messages associés au participant courant.

**Language Model API.**
Possibilité d'utiliser des modèles accessibles depuis VS Code dans une extension.

**Testing Extensions.**
`@vscode/test-cli` et `@vscode/test-electron`.

**Publishing Extensions.**
Packaging et publication avec `vsce`.

---

### Claude Code

**Claude Code Hooks Reference.**
Définition officielle du hook `Stop`, `session_id`, `cwd`, `transcript_path` et `last_assistant_message`.

**Claude Code Hooks Guide.**
Cycle de vie des hooks et événement `Stop` lorsque Claude termine sa réponse.

---

### Markdown

**remark-parse.**
Parser Markdown utilisant l'écosystème unified et produisant un AST MDAST.

**unified.**
Documentation montrant notamment que les nœuds générés disposent de positions source ligne/colonne/offset adaptées à notre mapping vers VS Code.

---

### Narration locale

**Ollama API.**
API locale servie par défaut sur `localhost:11434`, avec endpoints de génération et chat.

**Ollama Structured Outputs.**
Contrainte de sortie par JSON Schema, utile pour conserver le mapping entre source et narration.

**Ollama OpenAI Compatibility.**
Possibilité de passer par une interface OpenAI-compatible si souhaité.

**llama.cpp.**
Runtime local C/C++ et serveur HTTP compatible avec plusieurs endpoints OpenAI.

---

### TTS local

**Resemble AI Chatterbox — repository officiel.**
Chatterbox Multilingual V3, modèle 0.5B, français, génération multilingue et voice conditioning.

**Chatterbox — licence officielle.**
MIT.

**Chatterbox multilingual implementation.**
Liste des langues comprenant explicitement `fr`.

**Chatterbox-TTS-Server.**
Implémentation communautaire fournissant streaming, endpoints OpenAI compatibles et voice listing.

**Chatterbox-TTS-Server RDNA4.**
Documentation communautaire spécifique RX 9070 / RX 9070 XT / gfx1201 avec ROCm récent.

**Kokoro.**
Modèle TTS 82M sous licence Apache 2.0.

**Kokoro voicepacks.**
État du support multilingue et limitation actuelle du nombre de voix françaises.

---

# 88. Conclusion

Le produit à construire est donc :

> **un moteur de narration et de lecture vocale universel pour Visual Studio Code, capable de faire parler documents et agents LLM, avec profils personnalisables, fonctionnement local, contrôle manuel et synchronisation avec le contenu source.**

Le MVP ne doit surtout pas chercher à résoudre simultanément :

```text
Copilot complet
STT
word alignment
cloud
voice assistant
```

La première verticale à rendre excellente est :

```text
Markdown
    +
profils
    +
Ollama
    +
Chatterbox
    +
highlight
    +
Claude Inbox
```

Si cette chaîne est bonne, pratiquement toutes les autres sources et tous les autres moteurs deviennent des adaptateurs autour d'un cœur déjà stable.
