# ADR-004 — Stockage : inbox fichier, cache audio et secrets

- Statut : accepté
- Date : 2026-09-08
- Décideurs : Archie (platform-architect), sur cadrage D3/D8/D9/D10
- Références : CdC §37, §38, §41, §48, §53, §67 ; décisions D3, D8, D9, D10

## Contexte

Trois besoins de persistance distincts, souvent confondus : les messages
d'agents (écrits par un processus externe), l'audio synthétisé (coûteux à
recalculer), et les secrets des providers distants. Le CdC §38 proposait un
index d'inbox dans `globalStorageUri` en plus des fichiers ; deux sources de
vérité désynchronisées est la cause classique du « message fantôme ».

## Décision

### 1. L'inbox est un dossier, et c'est la seule source de vérité (D3)

Chemin résolu dans cet ordre : réglage `llmVoice.claude.inboxPath`, puis variable
d'environnement `LLM_VOICE_INBOX`, puis `~/.llm-voice/inbox/`. Un message = un
fichier JSON (schéma d'ADR-003, `schemaVersion: 1`).

- **Pas d'index** dans `globalStorageUri`. La liste est reconstruite en mémoire
  au démarrage par lecture du dossier.
- **Surveillance** : `fs.watch` sur le dossier, avec **repli polling toutes les
  5 s** — `fs.watch` est non fiable sur certains montages (réseau, conteneurs,
  Flatpak). Le polling compare `mtime` + taille, et sert aussi de rattrapage si
  un événement `watch` est perdu. Débounce de 200 ms avant lecture, et fichiers
  `.tmp-*` ignorés (écriture atomique côté collector).
- **Supprimer** = supprimer le fichier. **Archiver** = déplacer vers
  `inbox/archive/` (non surveillé). Ni `inbox/` ni `inbox/archive/` n'ont de
  borne de rétention ou de taille en 0.1 : l'archivage reste manuel et
  l'éviction automatique (âge, taille, nombre de fichiers) est hors périmètre
  de cet ADR, à spécifier par le protocole/CLI d'inbox (ADR-007) si le volume
  le justifie.
- **Lu / non-lu** : seul état dérivé, stocké dans `globalState` sous
  `llmVoice.inbox.read`, indexé par nom de fichier. Un nettoyage au démarrage
  retire les clés dont le fichier n'existe plus. Perdre cet état est bénin
  (tout redevient non lu) ; perdre un fichier est visible.
- **Plusieurs fenêtres VS Code** (CdC §67) : chacune observe le même dossier,
  donc converge. `globalState` est partagé par VS Code ; un écart transitoire de
  lu/non-lu entre fenêtres est acceptable.

### 2. Cache audio dans `globalStorageUri/cache`

Clé = `SHA256(providerId + model + voice + JSON.stringify(parameters trié) + spokenText)`
(CdC §37), en hexadécimal, éclatée en `cache/<2 premiers caractères>/<clé>.<ext>`
pour éviter un dossier à 100 000 entrées.

- Un fichier sidecar `<clé>.json` porte `{createdAt, lastAccessAt, bytes, format, durationMs, providerId}`.
- **Éviction LRU par taille**, budget `llmVoice.cache.maxSizeMb` (défaut 512 Mo),
  déclenchée après écriture et au démarrage : on trie par `lastAccessAt` et on
  supprime jusqu'à repasser à 90 % du budget. Jamais d'éviction d'un fichier
  référencé par une session en cours.
- Écriture atomique tmp+rename, comme l'inbox : la Webview peut charger le
  fichier dès qu'il porte son nom final.
- `Clear Audio Cache` vide le dossier ; le cache est **purement dérivé**, sa perte
  ne coûte que de la re-synthèse.
- Le cache est le **seul** dossier dans `localResourceRoots` de la Webview
  (ADR-001) : il ne doit donc jamais contenir autre chose que de l'audio.

### 3. Secrets dans `SecretStorage`

Toute clé d'API (niveau 3 de D9) va dans `context.secrets`, jamais dans
`settings.json`, jamais dans le profil, jamais dans un log. Le profil ne contient
qu'une **référence** (`apiKeyRef`), résolue à l'appel. Les logs journalisent hôte
et chemin, jamais le corps ni les en-têtes (D10).

### Répartition finale

| Donnée | Emplacement | Perte tolérable |
|---|---|---|
| Messages d'agents | dossier inbox | non — source de vérité |
| Lu / non-lu | `globalState` | oui |
| Audio synthétisé | `globalStorageUri/cache` | oui — dérivé |
| Profils | `profiles.json` (JSON Schema attaché, D5) | non |
| Réglages | `settings.json` VS Code | non |
| Clés d'API | `SecretStorage` | non |
| Historique de lecture | `globalState` | oui |

## Conséquences

- N'importe quel outil sachant écrire un fichier alimente l'inbox : c'est ce qui
  rend D8 possible sans coupler LLM Voice à chaque CLI.
- Le polling coûte un `readdir` toutes les 5 s ; négligeable pour un dossier de
  quelques dizaines d'entrées, à surveiller si l'inbox devient volumineuse.
- L'inbox est en clair sur le disque de l'utilisateur, protégée par `0700`/`0600`
  seulement — à documenter explicitement dans la page confidentialité (§53).
- Le budget de cache par taille et non par âge peut évincer un audio récent si un
  gros document vient d'être synthétisé ; accepté, la re-synthèse est locale.
- **Reporté phase 4** : `DiskAudioCache` (S3.5) n'a pas de notion de « chunk
  référencé par une session en cours » — aucun épinglage (pinning) du chunk en
  lecture contre l'éviction LRU, et le sidecar `<clé>.json` ne porte que
  `{createdAt, lastAccessAt, bytes}`, pas encore `{format, durationMs,
  providerId}` comme prévu ci-dessus. Le code documente l'écart
  (`DiskAudioCache.ts`, commentaire « Known gap vs. the full ADR-004 sidecar
  shape »). Risque accepté pour cette tranche : le budget par défaut (512 Mo)
  rend une éviction du chunk en cours de lecture improbable en usage normal ;
  à traiter avant que le cache ne soit dimensionné plus agressivement.

## Alternatives rejetées

- **Index d'inbox dans `globalStorageUri` (CdC §38)** : deuxième source de vérité,
  désynchronisation garantie avec un producteur externe.
- **SQLite** : dépendance native, packaging VSIX fragile, pour un besoin qui tient
  dans un `readdir`.
- **`FileSystemWatcher` de VS Code** : ne surveille que ce qui est dans le
  workspace ; l'inbox est hors workspace par construction.
- **`fs.watch` seul, sans polling** : silencieusement non fiable sur montages
  réseau et conteneurs, symptôme « les messages n'arrivent plus ».
- **Cache en mémoire uniquement** : perd tout au reload de fenêtre, contredit
  l'objectif « ne jamais recalculer la même phrase ».
- **Clés d'API dans `settings.json`** : synchronisées par Settings Sync et
  visibles en clair.

## Tests qui prouvent la décision

- Unitaire : `resolveInboxPath()` (pure) respecte l'ordre réglage > env > défaut.
- Unitaire : `computeCacheKey()` (pure) est stable à l'ordre des clés de
  `parameters` et change si l'un de provider/model/voice/paramètres/texte change.
- Unitaire : `planEviction(entries, budget)` (pure) évince par `lastAccessAt`
  croissant jusqu'à 90 % du budget et n'évince jamais une entrée épinglée.
- Unitaire : le parseur d'inbox rejette un fichier de `schemaVersion` inconnue et
  ignore les fichiers `.tmp-*`.
- Unitaire : le nettoyage de `globalState` supprime les clés orphelines.
- Intégration : dépôt d'un fichier hors événement `fs.watch` (watcher désactivé)
  → le message apparaît au tour de polling suivant.
- Confidentialité : aucun log ne contient de valeur issue de `SecretStorage`
  (assertion sur le canal de sortie pour un scénario avec clé factice).
