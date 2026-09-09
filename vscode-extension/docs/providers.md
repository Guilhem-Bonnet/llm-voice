# Providers TTS — trois niveaux, du zéro-installation au meilleur

Référence : ADR-009 (offre TTS à trois niveaux), ADR-005 (contrat
`TtsProvider`), ADR-010 (`EgressGuard`), `_grimoire-output/planning-artifacts/linux-first-v1.md`
§3-4. Story S7.1 : l'extension doit produire du son **immédiatement après
installation, sans aucun serveur ni configuration**, puis proposer de
monter en qualité.

## Le problème que ce document résout

Avant S7.1, une installation neuve du VSIX affichait seulement « Chatterbox
n'est pas installé » à la première tentative de lecture : le profil par
défaut pointait sur un serveur Chatterbox (`localhost:8004`) que personne
n'a lancé au premier essai. Depuis S7.1, le profil par défaut est
**« Voix système (aucune installation) »** et le réglage
`llmVoice.tts.provider` vaut `auto` par défaut : la première lecture
fonctionne toujours, avec la meilleure voix disponible sur la machine.

## Tableau des trois niveaux

| Niveau | Provider | Ce qu'il faut installer | Qualité | Réseau |
|---|---|---|---|---|
| **1b. Voix système** (`SystemTtsProvider`) | `system` | **Rien** — utilise `espeak-ng`/Piper déjà installé/`say`/SAPI selon la plateforme | Correcte à faible selon le moteur trouvé (`espeak-ng` est synthétique ; Piper est net) | **Aucun** — jamais de `fetch`, uniquement un process local |
| **1b+. Piper guidé** (`PiperSetup`) | `piper-local`/`system` (Piper détecté) | Une commande, un téléchargement consenti (~30-90 Mo) | Bonne (voix `fr_FR-siwis-medium`, corpus académique net) | Un téléchargement ponctuel, deux hôtes explicitement autorisés (GitHub, Hugging Face) |
| **1. Local GPU** (`ChatterboxProvider`/`KokoroProvider`) | `chatterbox`/`kokoro` | Conteneur `docker-compose-rdna4.yml` (ADR-009) | Très bonne, voix clonée FR | `localhost` uniquement |
| **2. Entreprise** | `openai-compatible` | Serveur DSI compatible `/v1/audio/speech` | Dépend du serveur | Hôte de confiance (`llmVoice.network.trustedHosts`), HTTPS |
| **3. Cloud** | `openai-compatible` | Clé API (OpenAI TTS, etc.) | Dépend du service | Hôte distant, HTTPS, jeton |

Un seul contrat `TtsProvider` (ADR-005) pour tous les niveaux sauf le 1b,
qui a son propre provider dédié parce qu'il n'a justement **rien** en commun
avec un appel HTTP.

## Ce qui marche sans rien installer (niveau 1b)

`SystemTtsProvider` (`src/tts/SystemTtsProvider.ts`) synthétise en
lançant un binaire local (jamais de shell, `child_process.spawn`/`execFile`
avec un tableau d'arguments) et ne fait **aucun appel réseau** — il n'utilise
pas `EgressGuard` puisqu'il n'y a rien à garder. Ordre de détection :

| Plateforme | Ordre | Détails |
|---|---|---|
| Linux | Piper (si installé via la commande ci-dessous) → `espeak-ng` | Piper n'est retenu que si **et** le binaire **et** la voix `fr_FR-siwis-medium.onnx` sont trouvés sous `globalStorageUri/piper/` — un `piper` nu sur le `PATH` sans voix connue est ignoré. |
| macOS | `say` | Fourni par défaut sur macOS ; sortie WAV directe (`--file-format=WAVE --data-format=LEI16@22050`), pas de conversion AIFF. |
| Windows | PowerShell + `System.Speech.Synthesis.SpeechSynthesizer` (SAPI) | PowerShell est toujours présent sur Windows ; le texte est passé en paramètre de script lié (`-Text`), jamais interpolé dans le script. |

`spd-say` (speech-dispatcher) est **volontairement absent** de la liste :
les implémentations standard n'ont pas d'option de sortie WAV — le démon
possède directement le périphérique audio — donc il ne peut pas remplir le
contrat `synthesize(): Promise<AudioResult>` que `PlaybackController`
attend (cache, découpage, lecture progressive). Voir le commentaire
d'en-tête de `SystemTtsProvider.ts` pour le détail et la source
(`linux-first-v1.md` §4).

Sous Flatpak (`FLATPAK_ID` défini), chaque exécution est re-routée via
`flatpak-spawn --host` (non testé sur cette machine — installation RPM/deb
native — documenté comme best-effort).

Texte volumineux : découpé en morceaux de ≤ 500 caractères sur des limites
de phrases (`splitTextForSynthesis`), synthétisés séparément puis les WAV
résultants sont concaténés (`concatWavBuffers`) en un seul fichier — la
synthèse reste un seul `AudioResult` du point de vue du reste du pipeline.

## Comment monter en qualité

### Étape 1 — Piper guidé (aucune installation manuelle)

Commande **`LLM Voice: Install Local Voice (Piper)`** :

1. Affiche une boîte de dialogue **modale** indiquant la taille exacte
   (moteur + voix), la source (dépôts GitHub `rhasspy/piper` et Hugging Face
   `rhasspy/piper-voices`) et la licence (MIT pour le moteur, CC0-1.0 pour
   les poids de la voix) — rien ne se télécharge avant confirmation.
2. Télécharge le binaire Piper (release GitHub, `2023.11.14-2`) et la voix
   `fr_FR-siwis-medium` (Hugging Face) via `downloadVerifiedAsset`
   (`src/net/AssetDownloader.ts`) — **vérification SHA-256** contre
   `src/tts/piperAssets.json` avant d'écrire quoi que ce soit à
   l'emplacement final (fichier temporaire, renommé seulement après
   validation de la somme).
3. Refusé sous `LLM_VOICE_STRICT_LOCAL=1` (mode bunker, D10), avant tout
   appel réseau.
4. En cas d'échec (réseau, somme invalide, plateforme non supportée) :
   message clair, **aucun état corrompu** — une installation existante et
   fonctionnelle n'est jamais touchée avant que la nouvelle soit
   entièrement téléchargée, vérifiée et extraite (bascule atomique dans un
   répertoire de préparation, puis `rename`).
5. Barre de progression annulable (`vscode.window.withProgress`,
   `cancellable: true`).
6. Une fois installé, `SystemTtsProvider` détecte Piper au prochain appel —
   pas besoin de recharger l'extension.

**Pourquoi ce téléchargement contourne `EgressGuard.fetch()` (et comment
il reste sûr quand même)** — voir l'en-tête de `src/net/AssetDownloader.ts` :
GitHub Releases et Hugging Face redirigent **toujours** vers un hôte CDN
différent (`release-assets.githubusercontent.com`,
`us.aws.cdn.hf.co`/région variable) ; la règle « aucune redirection
inter-hôtes » d'`EgressGuard` (`EgressGuard.ts`, comparaison contre l'hôte
*d'origine* de la requête) est la bonne politique pour tous les appels
JSON/API de cette extension et la mauvaise pour ce téléchargement précis.
`AssetDownloader` reproduit les garanties (mode bunker, liste d'hôtes
autorisés — y compris par suffixe de domaine pour les CDN à hôte variable,
TLS obligatoire, vérification SHA-256, journalisation hôte uniquement) sans
reprendre le mécanisme de redirection inadapté ici.

**Régénérer `src/tts/piperAssets.json`** après une nouvelle version : le
fichier documente lui-même la procédure dans son champ `_comment` —
télécharger chaque URL, `sha256sum <fichier>` et `stat -c%s <fichier>`,
coller les valeurs. Les sommes actuelles ont été calculées le 2026-09-09 en
téléchargeant réellement chaque fichier (pas de valeur inventée) ; testées
de bout en bout : téléchargement réel → vérification SHA-256 → extraction
`tar` → `SystemTtsProvider` détecte le Piper installé → synthèse → WAV
audible via `paplay`.

### Étape 2 — Serveur local GPU (Chatterbox/Kokoro)

Voir `deploy/README.md` et ADR-009 niveau 1 : conteneur
`docker-compose-rdna4.yml`, voix clonée FR par défaut. Le profil « Lecture
fidèle (local) » y pointe déjà.

### Étape 3 — Entreprise / cloud

`llmVoice.tts.provider: "openai-compatible"` avec `llmVoice.tts.baseUrl`
pointé sur le serveur DSI ou le fournisseur cloud, clé API via
`LLM Voice: Set Provider API Key` (jamais en clair dans un profil).

## Sélection automatique (`llmVoice.tts.provider: "auto"`, défaut)

`resolveTtsProviderConfig`/`autoSelectTts` (`src/pipeline/Pipeline.ts`,
logique pure testée dans `selectAutoTtsProvider`,
`src/pipeline/resolveProviderConfig.ts`) essaient, dans l'ordre :

1. **Chatterbox** (`http://localhost:8004`) — si `health()` répond
   `ok`/`degraded` (« loading »).
2. **Piper local** (serveur compatible OpenAI, `http://localhost:5000`) —
   même critère.
3. **Voix système** (`SystemTtsProvider`) — toujours retenue en dernier
   recours : pas de serveur à surveiller, donc toujours éligible.

Résultat mémorisé 30 s (`HEALTH_CACHE_TTL_MS`) pour ne pas re-sonder deux
points HTTP à chaque synthèse. Un profil ou un réglage qui nomme
explicitement un provider (`chatterbox`, `kokoro`, `piper-local`, `system`,
`openai-compatible`) **n'entre jamais** dans cette sélection automatique —
`"auto"` ne s'applique que si rien n'a été choisi.

Le profil **« Voix système (aucune installation) »** est le profil par
défaut au premier lancement (`ProfileRepository.defaultCollection`) : une
installation neuve lit immédiatement, sans configuration.

## Tests qui prouvent cette histoire

- Unitaire : `test/unit/tts/SystemTtsProvider.test.ts` — construction des
  arguments par plateforme (espeak-ng/Piper/say/SAPI), parsing des voix,
  ordre de détection (Piper avant espeak-ng, jamais un Piper nu sans
  voix connue), troncature/concaténation WAV, `AbortSignal`, `timeoutMs`,
  nettoyage des fichiers temporaires même en cas d'échec.
- Unitaire : `test/unit/net/AssetDownloader.test.ts` — refus sous
  `strictLocal`, refus hôte hors liste, suivi de redirection vers un hôte
  autorisé par suffixe, refus vers un hôte non autorisé, vérification
  SHA-256 (fichier supprimé et rien à l'emplacement final en cas
  d'incohérence).
- Unitaire : `test/unit/tts/PiperSetup.test.ts` — aucun téléchargement avant
  consentement, refus sous `strictLocal`, bascule atomique, une
  installation précédente fonctionnelle reste intacte après un échec de
  réinstallation.
- Unitaire : `test/unit/pipeline/resolveProviderConfig.test.ts` — ordre de
  sélection automatique, repli sur le suivant quand `health()` échoue ou
  lève, repli final sur `system`.
- Réel (gated sur la présence du binaire) :
  `test/integration-real/system-tts.test.ts` — `espeak-ng` réel présent sur
  la machine de développement : `health()` → `ok`, `listVoices()` retourne
  de vraies voix FR, `synthesize()` produit un WAV valide **non silencieux**
  (amplitude crête vérifiée, pas seulement un en-tête valide), et — quand
  `paplay` est présent — **joue effectivement l'audio** (~8 s de parole
  réelle jouée lors de l'exécution du 2026-09-09).
