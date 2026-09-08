# Brainstorm technique — LLM Voice v1

> Auteur : Stack (backend-engineer). Base : `cahier-des-charges.md` v1.0.
> Objectif : dégager une trajectoire d'implémentation concrète, pas une reformulation du CdC.

---

## 1. Slice vertical minimal (1 semaine, démontrable)

Chaîne : **fichier `.md` ouvert → 1 phrase sélectionnée → Segmenter → FakeTtsProvider (WAV pré-généré) → Webview `<audio>` → highlight qui suit `timeupdate`**.

Pas de Narrator, pas de cache, pas de Claude Inbox, pas de vrai Chatterbox. But : prouver que le pipeline `SourceAdapter → SourceSegment → AudioChunk → Player → Highlight` tient debout de bout en bout, testable par `@vscode/test-electron`.

Fichiers à écrire en premier :

1. `src/sources/SourceAdapter.ts` — interface + `SourceDocument` (types uniquement, section 10/60 du CdC).
2. `src/sources/SelectionSource.ts` — capture la sélection active de l'éditeur (le plus simple : pas de parsing Markdown requis pour le slice).
3. `src/parser/Segmenter.ts` — découpe en `SourceSegment[]` de type `sentence`, avec `sourceRange`. Version naïve d'abord (split sur `. ! ?` + garde-fous basiques), affinée en §4.
4. `src/tts/TtsProvider.ts` + `src/tts/FakeTtsProvider.ts` — interface + implémentation qui renvoie un WAV silence de 1s pré-enregistré (`resources/fixtures/silence.wav`), `durationMs` fixe.
5. `src/playback/PlaybackController.ts` — state machine minimale (`idle→preparing→playing→stopped`), pas de queue/prefetch encore.
6. `src/views/player/PlayerWebview.ts` + `media/player.js` — Webview avec `<audio>`, reçoit `{command:"play", audioUri, chunkId}` via `postMessage`, renvoie `timeupdate`/`ended`.
7. `src/highlight/HighlightController.ts` — `setDecorations` sur le `sourceRange` du chunk courant.
8. `src/commands/speakSelection.ts` — glue : commande `LLM Voice: Speak Selection` qui appelle tout le pipeline.

Critère de sortie de la slice : `AC-01`-like sur une sélection, `AC-02`, `AC-03`, `AC-05` passent avec le Fake TTS, testés par un test d'intégration `@vscode/test-electron`.

Ce qui est volontairement hors slice : Markdown/MDAST (§4 CdC — arrive juste après), Narrator, profils, cache, Claude Inbox, prefetch, pause avec position intra-chunk précise.

---

## 2. Lecture audio dans VS Code

| Option | Avantages | Inconvénients / risques |
|---|---|---|
| **Webview `<audio>` + postMessage** | Supporté officiellement (WAV/MP3/OGG/FLAC, §9 CdC) ; fonctionne en Remote/Codespaces sans binaire natif côté hôte distant (le rendu HTML est côté client) ; API `timeupdate`/`ended`/`currentTime` standard pour la sync ; pas de process externe à gérer/tuer ; volume/vitesse contrôlables via `playbackRate` | Webview = process séparé (latence de postMessage, quelques ms, négligeable) ; nécessite `enableScripts` + CSP correcte ; le focus de la Webview peut voler le focus de l'éditeur si mal géré ; audio local sur la machine qui rend la Webview (donc UI extension côté user, cf §56) |
| **Process externe (`aplay`/`ffplay`/`paplay`/`afplay`)** | Latence de démarrage potentiellement plus faible ; pas de dépendance à une Webview visible | Différent binaire par OS (aplay Linux/ALSA, afplay macOS, pas d'équivalent simple natif Windows sans PowerShell) → 3 implémentations à maintenir ; pause/seek précis difficile (`aplay` n'a pas de contrôle pause standard, il faut SIGSTOP/SIGCONT en bricolage) ; ne fonctionne pas si le process tourne côté remote (pas de haut-parleur) sauf extension UI ; gestion des zombies process à la fermeture de VS Code |
| **`node-speaker` (native addon Node)** | Contrôle programmatique fin (stream PCM), pas de dépendance à un binaire système | Native addon = compilation à l'installation (prebuild-install), risque élevé de casse cross-platform/cross-Node-ABI, mauvais candidat pour un VSIX distribué largement ; complexifie le packaging significativement |
| **sox / play (sox)** | CLI mature, resampling intégré | Dépendance externe à installer par l'utilisateur, pas empaquetable dans le VSIX, mêmes soucis cross-platform que aplay/ffplay |

**Recommandation : Webview `<audio>`.** C'est déjà la décision du CdC (§85 "Player = Webview légère") et c'est objectivement le bon choix : zéro dépendance binaire externe, cross-platform gratuit (le rendu HTML gère WAV/MP3/OGG/FLAC nativement), API `timeupdate` native pour la sync (§3), et compatible avec la contrainte UI-extension de Remote Development (§56) puisque la Webview se rend côté client. Les process externes ne seraient à envisager que comme fallback si un jour l'extension doit tourner en pur headless sans Webview (cas non prévu au MVP).

---

## 3. Synchronisation audio → highlight

Source de vérité : l'event `timeupdate` du `<audio>` dans la Webview (poll natif ~4x/s), pas une estimation par durée WAV — la durée réelle du fichier peut différer légèrement de l'estimation `durationMs` stockée dans `AudioChunk` (arrondis, silence de padding TTS).

Flux de messages Webview → extension :

```ts
// media/player.js — dans la Webview
audio.addEventListener('timeupdate', () => {
  vscode.postMessage({ type: 'timeupdate', chunkId, currentTimeMs: audio.currentTime * 1000 });
});
audio.addEventListener('ended', () => {
  vscode.postMessage({ type: 'ended', chunkId });
});
```

Granularité : au MVP, le highlight est **par chunk** (phrase ou bloc), pas par mot (§16, explicitement hors scope). Donc `timeupdate` ne sert qu'à alimenter la barre de progression + calculer "segment suivant" quand plusieurs `sourceRanges` sont rattachées à un seul `NarrationSegment` narré (bloc) — dans ce cas on peut répartir le highlight proportionnellement au ratio `currentTime/durationMs` sur les sous-`sourceRanges` d'origine, en option activable, mais **ce n'est pas requis au MVP** : le CdC dit explicitement "le paragraphe d'origine est surligné pendant toute la narration correspondante" (§15.2).

Chunks multi-phrases : le `AudioChunk.status` passe `playing → played` sur `ended`, ce qui déclenche `HighlightController.moveToNext()`. Le drift entre `ended` réel et `durationMs` stocké (utile pour l'UI "temps restant") est corrigé à chaque `ended` : on ne cumule jamais les `durationMs` théoriques, on se base sur le fichier audio réel joué.

Cas dégradé (Webview déchargée) : retenir via `retainContextWhenHidden`, sinon resynchroniser à la réouverture via l'état `PlaybackSession` courant.

---

## 4. Segmentation

### 4.1 Découpage phrases FR/EN

Algorithme recommandé (aucune vraie NLP nécessaire au MVP) :

1. Protéger d'abord les zones à ne jamais couper : `inlineCode` (backticks), URLs (`https?://\S+`), et blocs `code` déjà isolés en amont par le MDAST (ils ne passent pas par le splitter de phrases).
2. Regex de coupe sur `[.!?]+(\s|$)` **sauf** si précédé par une abréviation connue (liste FR : `M.`, `Mme`, `Dr`, `etc.`, `p.ex.`, `c.-à-d.`, `n°`, initiales `[A-Z]\.` ; liste ER similaire `e.g.`, `i.e.`, `Mr.`, `Dr.`, `etc.`) ou suivi d'une minuscule/chiffre (`3.14`, `v2.0`).
3. Ne jamais couper à l'intérieur d'un span protégé à l'étape 1 (remplacer temporairement par un placeholder `⟦N⟧` avant le split, restaurer après).
4. Fusionner les phrases trop courtes (< ~15 caractères, ex. reliquat après une puce) avec la phrase suivante pour éviter des chunks TTS ridicules.

```ts
function isAbbreviation(tokenBeforeDot: string, lang: 'fr' | 'en'): boolean {
  const list = ABBREVIATIONS[lang]; // Set<string>, ex. {"M.","Mme","etc.","Dr"}
  return list.has(tokenBeforeDot) || /^[A-Z]$/.test(tokenBeforeDot);
}
```

Librairie à évaluer avant de tout écrire à la main : `sentence-splitter` (npm) gère déjà une partie de ces cas FR/EN — décision à trancher tôt (§10).

### 4.2 Mapping MDAST → sourceRange

`remark-parse` fournit `node.position.start/end` en `{line, column, offset}` — directement convertible en `vscode.Range` (attention : MDAST est 1-indexed, `vscode.Position` est 0-indexed → `line - 1`, `column - 1`).

Stratégie :

1. Parcourir le MDAST en profondeur ; pour chaque nœud "feuille de contenu" (`paragraph`, `heading`, `listItem`, `code`), extraire son texte brut via `mdast-util-to-string` et son `position`.
2. Pour les `paragraph`, sous-segmenter en phrases (§4.1) **à l'intérieur** de la plage `position` du paragraphe. Comme on n'a que le range global du paragraphe et pas par phrase, on approxime le `sourceRange` de chaque phrase par recherche du texte de la phrase dans le texte source du paragraphe (`indexOf` + calcul ligne/colonne relatif à `position.start`), avec fallback sur le range complet du paragraphe si la recherche échoue (texte modifié entre temps, edge case guillemets typographiques).
3. Pour `code`, `table`, `list` : un seul `SourceSegment` par nœud (pas de sous-segmentation phrase), `spokenText` déterminé par la politique de bloc (§13 CdC : skip/read/explain/summarize).

---

## 5. Structured output Ollama

Schéma JSON Schema à passer en `format` sur `POST /api/chat` :

```json
{
  "type": "object",
  "properties": {
    "segments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "sourceIds": { "type": "array", "items": { "type": "string" } },
          "spokenText": { "type": "string" }
        },
        "required": ["sourceIds", "spokenText"]
      }
    }
  },
  "required": ["segments"]
}
```

Prompt système minimal (injecté avant le prompt de profil utilisateur) :

```text
Tu reçois des blocs identifiés par BLOCK_xxx. Réponds uniquement en JSON
conforme au schéma fourni. Chaque segment de sortie doit référencer au
moins un sourceIds existant parmi les BLOCK_xxx reçus. Ne jamais inventer
un identifiant. Ne jamais répéter le texte source brut, produis une
narration orale.
```

**Stratégie si le modèle casse le mapping** (invente un `BLOCK_xxx` inconnu, en oublie un, ou renvoie du JSON invalide malgré le schema — les petits modèles locaux le font) :

1. Valider avec Zod immédiatement après parse. Si JSON invalide → 1 retry avec température réduite (`temperature: 0.2`) et rappel du schema dans le prompt.
2. Si `sourceIds` contient un id inconnu → drop cet id silencieusement (log `warn`), garder le segment si au moins 1 id valide reste.
3. Si un `BLOCK_xxx` envoyé n'apparaît dans **aucun** segment de la réponse (le modèle l'a "oublié") → fallback : ce bloc source est lu tel quel sans narration (comportement `NoNarrator` sur ce bloc précis), plutôt que d'échouer toute la génération. C'est cohérent avec la gestion d'erreur §52 ("Read without narration").
4. Si échec persistant après retry → proposer à l'utilisateur `Retry / Read without narration / Cancel` (§52, déjà spécifié).

**Chunking par section** : ne jamais envoyer tout le document en un seul appel `/api/chat` (§63 : le Narrator ne doit pas traiter tout un long fichier avant de démarrer). Découper par `heading` de niveau 2 (ou par groupe de N paragraphes si pas de heading), un appel Ollama par section, streaming du pipeline section-par-section vers TTS pendant que la section suivante se transforme (§63 diagram).

---

## 6. Cache audio

Disposition sur disque (sous `globalStorageUri`, §38/§85) :

```text
<globalStorageUri>/audio-cache/
  index.json                     # { entries: { [hash]: CacheEntryMeta } }
  ab/                             # 2 premiers hex chars du hash = sharding
    ab12ef...9c.wav
    ab34ff...1a.wav
```

`CacheEntryMeta` : `{ hash, provider, model, voice, spokenTextHash, sizeBytes, createdAt, lastAccessedAt, durationMs }`. Le hash lui-même sert de nom de fichier (pas de collision, pas besoin de stocker `spokenText` en clair dans le nom — confidentialité §53).

**Index** : `index.json` chargé en mémoire au démarrage de l'extension (Map), réécrit de façon atomique (tmp + rename, cf §7) à chaque insertion/éviction, avec debounce (~2s) pour éviter les écritures excessives pendant une génération rapide multi-chunks.

**Éviction LRU** : au dépassement de `llmVoice.cache.maxSizeMb`, trier `entries` par `lastAccessedAt` croissant, supprimer jusqu'à repasser sous 90% du quota (marge pour éviter de re-évincer immédiatement). Éviction déclenchée en tâche de fond après chaque écriture réussie, jamais sur le chemin critique de lecture.

**Invalidation** : la clé de cache (§37 CdC) inclut déjà `provider + model + voice + parameters + spokenText` — donc un changement de paramètre de profil produit naturellement une nouvelle clé, pas besoin de purge explicite. Seule purge manuelle nécessaire : commande `LLM Voice: Clear Audio Cache` (§7 commandes) qui vide `audio-cache/` entièrement, et une purge automatique optionnelle si `schemaVersion` du cache change entre deux versions de l'extension (éviter de lire un WAV orphelin d'un format de clé obsolète).

---

## 7. Hook Claude Code — collector minimal

Deux implémentations équivalentes à fournir (`integrations/claude-code/capture.sh` en wrapper léger appelant `capture.py`, `capture.py` portant toute la logique — Python est disponible partout où Claude Code tourne et évite les divergences bash/zsh/dash) :

```python
payload = json.load(sys.stdin)          # hook Stop payload
os.makedirs(INBOX, exist_ok=True, mode=0o700)
record = {"schemaVersion": 1, "provider": "claude-code",
          "sessionId": payload.get("session_id", "unknown"),
          "message": payload.get("last_assistant_message", "")}
tmp_fd, tmp_path = tempfile.mkstemp(dir=INBOX, prefix=".tmp-")
with os.fdopen(tmp_fd, "w") as f:
    json.dump(record, f)
os.chmod(tmp_path, 0o600)
os.rename(tmp_path, os.path.join(INBOX, fname))   # atomique, même FS
```

Le script complet enveloppe ce cœur dans un `try/except` global qui sort toujours en code 0 (voir points clés).

Points clés :
- Écriture atomique = écrire dans un fichier temporaire **dans le même répertoire** (même filesystem, sinon `rename` n'est pas atomique) puis `os.rename` — jamais écrire directement le fichier final.
- Permissions posées explicitement après création (`os.chmod`), pas seulement via `umask`, car l'umask de l'environnement d'exécution du hook n'est pas garanti.
- Détection de doublons : Claude Code peut en théorie redéclencher `Stop` (retry interne) — dédupliquer par `sha256(sessionId + message)` optionnel stocké dans un petit index `.dedupe.json` à TTL court (quelques minutes), ou accepter le doublon (impact faible, l'utilisateur voit juste 2 entrées identiques dans l'Inbox — préférable à complexifier le collector qui doit rester minimal et ne jamais planter le hook Claude Code).
- Le script doit **toujours sortir avec code 0** même en cas d'erreur d'écriture (ne jamais faire échouer le hook Claude Code lui-même à cause d'un souci côté LLM Voice) — donc wrapper le `main()` dans un try/except global qui log en stderr et exit 0.

Installation/désinstallation dans `~/.claude/settings.json` (l'extension propose une commande `LLM Voice: Install Claude Hook`) :

```ts
interface ClaudeHookInstaller {
  install(): Promise<void>;   // lit settings.json, ajoute hooks.Stop[] si absent, réécrit atomique (tmp+rename)
  uninstall(): Promise<void>; // retire uniquement l'entrée dont command matche notre binaire capture.py
  isInstalled(): Promise<boolean>;
}
```

Détection de doublons **au niveau installation** (pas seulement runtime) : avant d'ajouter l'entrée, vérifier qu'aucune commande existante dans `hooks.Stop` ne pointe déjà vers `capture.py`/`capture.sh` de LLM Voice (comparer le chemin résolu, pas juste la string) — sinon ajout à chaque `install()` répété = hook exécuté N fois par réponse Claude.

---

## 8. Idées différenciantes hors CdC (max 10)

1. **Lecture d'un diff Git** : narrer `git diff` (source adapter `GitDiffSource`) — "fichier X, +12/-3, la fonction Y a été renommée en Z".
2. **Lecture des TODO/FIXME** : commande "Speak TODOs in file/workspace", narration façon liste de tâches.
3. **"Speak on save" opt-in par profil** : narration courte automatique après save (jamais pour Claude, toujours opt-in explicite par fichier, respecte le principe P0 §3.1 puisque déclenché par une action utilisateur explicite de config, pas par un agent).
4. **SSML léger via profil** : pauses `<break>`/emphase simples injectées par le Narrator pour les listes/titres, si le TTS backend le supporte.
5. **Glossaire de prononciation par profil** : table `{ "k8s": "kubernetes", "readinessProbe": "readiness probe" }` appliquée avant TTS, résout un vrai pain point sur le jargon technique.
6. **Playlist de sections** : sélectionner plusieurs `heading` non contigus d'un même document et les enchaîner (utile pour réviser un cours).
7. **Mode "tour du repo"** : narration guidée d'un README + structure de dossiers, générée à la demande (pas passif).
8. **Speak diagnostics** : lire les erreurs/warnings du fichier courant (`vscode.languages.getDiagnostics`) — cas d'usage accessibilité fort.
9. **Export "podcast de session"** : concaténer l'historique Inbox Claude du jour en un seul fichier audio exportable (UC-19 appliqué à l'Inbox).
10. **Vitesse adaptative par type de bloc** : ralentir automatiquement sur le code expliqué, accélérer sur les transitions — piloté par profil, pas codé en dur.

---

## 9. Ce que je ne ferais PAS (max 5)

1. **Implémenter un forced aligner mot-par-mot maison** — le CdC l'exclut explicitement (§16) et c'est un gouffre à complexité (dépendance modèle supplémentaire, calcul additionnel) pour un gain UX marginal par rapport au highlight bloc/phrase.
2. **Écrire notre propre parser Markdown** — `remark-parse`/MDAST est mûr, testé, avec positions natives ; réinventer ça coûterait des semaines pour un résultat moins robuste, et casserait la garantie de mapping `sourceRange` (§11).
3. **Scraper le DOM Copilot ou lire son storage interne** — fragile par construction (casse à chaque update Copilot), et le CdC l'exclut explicitement (§45/§75). Le chat participant + Language Model API est la seule voie durable.
4. **Compiler un native addon audio (`node-speaker`) pour le MVP** — le risque de packaging cross-platform dépasse largement le bénéfice de latence face à une Webview `<audio>` qui fait déjà le travail nativement.
5. **Gérer plusieurs jobs TTS concurrents dès le MVP** — le CdC recommande `maxConcurrentTtsJobs=1` (§65) pour la stabilité VRAM ; paralléliser tôt ajouterait de la complexité de queue sans bénéfice mesuré avant d'avoir un vrai goulot d'étranglement observé.

---

## 10. Décisions à trancher tôt (max 6, avec recommandation par défaut)

1. **Librairie de segmentation de phrases FR/EN** : écrire un splitter maison (§4.1) vs. dépendance `sentence-splitter`/`compromise`. *Recommandation : essayer `sentence-splitter` d'abord (léger, MIT, gère abréviations EN/FR), fallback maison seulement si les gaps observés sur du contenu technique FR sont trop nombreux.*
2. **Granularité de highlight par défaut en mode "Lecture fidèle"** : phrase unique vs. groupe de 2-3 phrases (§33 mentionne les deux). *Recommandation : 1 phrase par chunk par défaut — meilleure précision highlight, coût prosodie acceptable en lecture fidèle (pas de narration élaborée à préserver).*
3. **Retenue du contexte Webview (`retainContextWhenHidden`)** : impacte la consommation mémoire vs. la résilience de la position de lecture quand le panel est masqué. *Recommandation : activé — le player doit survivre au changement d'onglet/vue, coût mémoire faible pour un seul élément audio.*
4. **Format d'échange Narrator ↔ pipeline pour les blocs "code"** : le Narrator reçoit-il le code brut inline dans le prompt (§13, mode `explain`) ou un résumé pré-calculé (AST-based) ? *Recommandation : code brut inline dans le prompt du bloc `BLOCK_xxx`, laisser le LLM faire le travail d'explication — évite une couche d'analyse de code supplémentaire à maintenir au MVP.*
5. **Emplacement de l'Inbox par défaut** : `~/.llm-voice/inbox` fixe vs. configurable dès le MVP (`LLM_VOICE_INBOX`). *Recommandation : les deux dès le MVP — le collector lit déjà la variable d'env, coût d'implémentation nul, et ça découple totalement le hook de l'emplacement `globalStorageUri` de l'extension (utile en multi-utilisateur/multi-machine).*
6. **`extensionKind` UI vs Workspace** : déclarer `["ui", "workspace"]` (§56) ou `["ui"]` strict pour forcer le fonctionnement local. *Recommandation : `["ui", "workspace"]` comme préconisé au CdC, mais tester tôt en Remote SSH réel pour valider que le fallback ne casse pas l'accès à Ollama/Chatterbox — si ambigu, restreindre à `["ui"]` avant la 1.0 plutôt que de laisser un mode cassé silencieusement.*
