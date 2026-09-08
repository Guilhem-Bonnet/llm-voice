# ADR-001 — Lecture audio via Webview `<audio>` et protocole postMessage

- Statut : accepté
- Date : 2026-09-08
- Décideurs : Archie (platform-architect), sur cadrage D2/D4/D10
- Références : CdC §9, §29-§36, §56, §85 ; décisions de cadrage D2, D4, D10 ; brainstorm §2-§3

## Contexte

Il faut jouer de l'audio produit localement dans VS Code, avec pause/reprise
précise, vitesse et volume, sur Linux/Windows/macOS et sans binaire natif.
Les alternatives (process externe `aplay`/`afplay`, addon natif `node-speaker`,
`sox`) imposent trois implémentations OS, un packaging fragile et une pause
approximative. L'Extension Host n'a par ailleurs aucune API audio.

D2 fixe le grain : en 0.1 chaque chunk est un fichier audio complet (1 à 3
phrases), la lecture démarre au premier chunk, le prefetch de 2-3 chunks masque
la latence. Le streaming intra-chunk est reporté en 0.2.

## Décision

Le lecteur est une **Webview View** contenant un seul élément `<audio>`, passive :
elle ne connaît ni la file, ni les segments, ni le cache. La state machine
(`idle → preparing → playing → paused → stopped → completed → error`, CdC §34)
vit dans l'Extension Host (`PlaybackController`).

### Protocole Extension → Webview

| type | payload | rôle |
|---|---|---|
| `load` | `{chunkId, src, durationMs?, autoplay}` | charge un chunk ; `src` = `webview.asWebviewUri` d'un fichier du cache |
| `play` / `pause` / `stop` | `{}` | contrôle |
| `seek` | `{positionMs}` | reprise intra-chunk |
| `setRate` / `setVolume` | `{value}` | réglages live (`playbackRate`, `volume`) |
| `state` | `{session, index, total, profile, title}` | ce que le mini-player affiche |

### Protocole Webview → Extension

| type | payload | rôle |
|---|---|---|
| `ready` | `{}` | la Webview accepte les `load` |
| `timeupdate` | `{chunkId, positionMs}` | throttlé à 250 ms : progression + position de reprise |
| `ended` | `{chunkId}` | déclenche chunk suivant et highlight suivant |
| `error` | `{chunkId, message}` | retry puis skip côté extension |
| `userAction` | `{action}` | boutons du player |

### Séquence nominale

```
ext: create webview ──▶ wv: ready
ext: load(c1, autoplay=true) ──▶ wv: timeupdate(c1, …)×n ──▶ wv: ended(c1)
ext: [decoration off c1, decoration on c2] load(c2, autoplay=true) ──▶ …
ext: load(cN) ──▶ ended(cN) ──▶ ext: state = completed
```

### Pause et reprise

`pause` fige l'élément ; l'Extension Host retient le dernier `timeupdate`
(`chunkId` + `positionMs`) comme position de reprise. Une reprise après
déchargement de la Webview émet `load(chunkId, autoplay=false)` puis
`seek(positionMs)` puis `play`. `retainContextWhenHidden: true` évite ce
chemin dans le cas courant (panneau replié) au prix de mémoire retenue —
accepté : une Webview de trois lignes (D12).

### Sécurité

- CSP stricte, injectée dans le HTML :
  `default-src 'none'; media-src ${webview.cspSource}; script-src 'nonce-<nonce>'; style-src ${webview.cspSource} 'nonce-<nonce>'; connect-src 'none'; img-src ${webview.cspSource}`.
- `connect-src 'none'` : la Webview ne peut émettre aucune requête réseau (D10).
- `localResourceRoots` = **uniquement** `globalStorageUri/cache` et le dossier
  `media/` de l'extension ; aucun accès au workspace.
- Aucun `innerHTML` sur du texte non fiable : titre et profil sont posés via
  `textContent` (AC-SEC-02).
- Nonce régénéré à chaque construction du HTML.

## Conséquences

- Cross-platform gratuit, zéro dépendance binaire, pause/seek exacts.
- L'audio est joué par la machine qui rend la Webview, ce qui est cohérent avec
  `extensionKind: ["ui"]` (D1) et fait fonctionner Remote SSH / Codespaces.
- Le player doit être instancié même replié : la Webview View est créée à la
  première lecture et jamais affichée vide (D12).
- Le passage au streaming (0.2) changera l'implémentation Webview (Web Audio API)
  **sans changer** le protocole : `load` deviendra alors alimenté par frames.
- La Webview peut voler le focus : `preserveFocus: true` obligatoire à la
  révélation, et aucun `focus()` dans le script du player.

## Alternatives rejetées

- **Process externe (`aplay`/`ffplay`/`afplay`/`paplay`)** : trois binaires à
  détecter, pause par SIGSTOP/SIGCONT, seek impraticable, zombies à la fermeture,
  et incompatible Flatpak sans `flatpak-spawn --host` (D11).
- **`node-speaker` (addon natif)** : compilation à l'installation, ABI Node/VS Code
  fragile, packaging VSIX risqué pour un gain nul au grain « chunk ».
- **Streaming intra-chunk dès 0.1 (MediaSource / Web Audio)** : `<audio>` ne lit
  pas un WAV en cours d'écriture ; complexifie pause, seek, cache et highlight
  pour un gain marginal quand un chunk dure une à trois phrases (D2).
- **Webview comme propriétaire de la file** : dupliquerait la state machine et
  rendrait le cache et l'annulation impossibles à raisonner.

## Tests qui prouvent la décision

- Unitaire : `PlaybackController` — une séquence `ready → ended×N` produit
  exactement N `load` dans l'ordre, puis l'état `completed` ; un `error` sur un
  chunk produit un retry puis un skip.
- Unitaire : reprise — après `pause` à 4200 ms puis reconstruction de la Webview,
  les messages émis sont `load(autoplay=false)`, `seek(4200)`, `play`.
- Unitaire : le générateur de HTML contient un nonce unique par appel, la
  directive `default-src 'none'`, `connect-src 'none'`, et aucun `innerHTML`.
- Intégration (`@vscode/test-electron`) : `localResourceRoots` de la Webview ne
  contient que le cache et `media/` ; un `asWebviewUri` sur un fichier du
  workspace n'est pas chargeable.
- Confidentialité (AC-SEC-01) : le scénario complet de lecture n'émet aucune
  requête sortante (couche HTTP interceptée).
