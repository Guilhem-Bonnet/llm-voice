# Audit de sécurité — LLM Voice 0.1

> Vault (security-hardener), S6.1, 2026-09-09. Audit du **code livré**, pas
> du cahier des charges : la revue documentaire est
> `_grimoire-output/planning-artifacts/security-privacy-review-v1.md`.
> Références : ADR-003 (hook/collector), ADR-004 (stockage), ADR-010
> (EgressGuard), AC-SEC-01..10.

## 1. Périmètre audité

| Surface | Fichiers |
|---|---|
| Chemins issus de données externes | `src/claude/**`, `src/core/safePath.ts`, `src/playback/DiskAudioCache.ts`, `integrations/**` |
| Webview | `src/views/player/**`, `media/player/*` |
| Réseau | `src/net/**`, `src/tts/**`, `src/narrator/**` |
| Secrets et journal | `src/infrastructure/logger.ts`, `src/core/redact.ts`, `src/pipeline/Pipeline.ts` |
| Profils | `src/profiles/**`, `src/core/profile.schema.ts` |
| Hook Claude Code | `src/claude/hookEntry.ts`, `hookInstallerIO.ts`, collector + CLI |
| Chaîne d'approvisionnement | `package.json`, `package-lock.json`, `.vscodeignore`, contenu du VSIX |

**Hors périmètre** : le serveur TTS/Narrator lui-même, Claude Code, VS Code et
ses autres extensions, l'auto-update du client Ollama desktop.

## 2. Findings

14 findings, **14 corrigés**. Chacun est verrouillé par au moins un test
d'attaque (§3) qui échoue si la correction est retirée.

### Critique

| Id | Finding | Statut |
|---|---|---|
| **F-01** | `profile.tts.apiKeyRef` était passé tel quel à `SecretStorage.get()`. Un profil **importé** pouvait nommer la clé d'un *autre* provider (`llmVoice.apiKey.openai`) et se la faire envoyer en `Bearer` vers son propre `baseUrl` — « importer un profil » suffisait à exfiltrer la clé cloud de l'utilisateur. | **Corrigé** — le schéma restreint `apiKeyRef` au namespace `llmVoice.apiKey.*`, et `Pipeline.resolveApiKey` exige l'égalité avec `apiKeySecretKey(providerId)` du provider réellement résolu ; sinon la clé est ignorée et un `warn` (sans valeur) est journalisé. |

### Élevé

| Id | Finding | Statut |
|---|---|---|
| **F-02** | `EgressGuard` résolvait le DNS, validait l'IP loopback… puis passait le **nom** à `fetch`, qui le re-résolvait. Deux résolutions = deux réponses possibles : le rebinding qu'ADR-010 prétend bloquer restait ouvert (TOCTOU). | **Corrigé** — `guardedFetch` compose l'URL réellement appelée avec l'**adresse validée** (`localhost` → `127.0.0.1`, `::1` → `[::1]`). Le résolveur n'est consulté qu'une fois : il n'y a plus de fenêtre. |
| **F-03** | `tts.referenceAudio` (chemin local d'un profil importé) était lu puis téléversé sans aucune validation : `~/.ssh/id_rsa`, `.env`, n'importe quoi. | **Corrigé** — allowlist d'extensions audio + rejet des caractères trompeurs au schéma ; à la lecture, `lstat` (symlink refusé si sa cible n'est pas audio), fichier régulier obligatoire, plafond 25 Mio. |
| **F-04** | Aucune allowlist de schéma. `file://localhost/etc/passwd` était **autorisé** en mode local (son hostname *est* `localhost`) ; `data:`/`ws:` traversaient la classification avec un hostname vide. | **Corrigé** — `http:`/`https:` uniquement, avant toute autre décision, et aussi sur la cible d'une redirection. |

### Moyen

| Id | Finding | Statut |
|---|---|---|
| **F-05** | `addHookEntry`/`containsHookEntry`/`removeHookEntry` levaient une `TypeError` sur des formes légitimes de hooks tiers (groupe `Stop` sans clé `hooks`, entrée `null`) : la commande d'installation plantait à cause de la config d'un autre outil. | **Corrigé** — normalisation défensive à chaque niveau ; 10 formes malformées testées. |
| **F-06** | Un `settings.json` contenant du JSON valide mais non-objet (tableau, chaîne) était **remplacé** par notre hook : perte du contenu. | **Corrigé** — refus explicite ; le fichier n'est pas touché. |
| **F-07** | `this.baseUrl` interpolé dans 3 messages d'erreur de provider. Un `baseUrl` avec segment userinfo (`https://user:clé@host`) déversait ce secret dans l'Output Channel. | **Corrigé** — `endpointLabel()` (hôte + chemin) partout. |
| **F-08** | La redaction ne connaissait que les valeurs enregistrées via `trackSecret`. Une clé arrivée autrement (userinfo d'URL, en-tête renvoyé par le serveur, exception non gérée) passait, même en `debug`. | **Corrigé** — `redactSecretPatterns` : userinfo d'URL, `Bearer/Basic/token`, `api_key=`/`access_token=`, clés `sk-…`. Appliquée à la ligne entière, après les deux passes existantes. |
| **F-09** | `InboxRepository.scan()` utilisait `fs.stat` : un symlink en `.json` déposé dans l'inbox était suivi, lu, et son contenu potentiellement lu à voix haute. `remove()`/`archive()` acceptaient n'importe quel `id` avant `path.join`. | **Corrigé** — `fs.lstat` (les non-réguliers sont ignorés), allowlist `isSafePathSegment` sur les noms lus **et** sur les ids reçus. |

### Faible

| Id | Finding | Statut |
|---|---|---|
| **F-10** | Nonce CSP dérivé de `Math.random()` — PRNG prédictible. | **Corrigé** — `randomBytes(24)`, régénéré à chaque rendu (prouvé). |
| **F-11** | `isLoopbackUrl` classait `0.0.0.0` comme loopback : le badge 🔒 annonçait « local » pour une destination que la garde refuse. | **Corrigé** — retiré ; badge et garde disent la même chose. |
| **F-12** | `audio.src` acceptait tout hôte *contenant* `vscode-webview` (`https://vscode-webview.evil.example/`). | **Corrigé** — comparaison par suffixe sur `.vscode-cdn.net` / `.vscode-webview.net`. |
| **F-13** | Collector : aucun plafond de taille (un message de 50 Mo était écrit tel quel et relu à chaque scan), fichier `.tmp-` orphelin si l'écriture échoue, et rien ne garantissait le `exit 0` hors du `try` de `writeAtomic`. | **Corrigé** — plafond 1 Mio avec mention de troncature, nettoyage du tmp, `uncaughtException`/`unhandledRejection` → `exit 0`. |
| **F-14** | `.vscodeignore` incomplet (`.nvmrc`, `docs/`, lockfile) et aucune vérification automatique de ce qui est publié ni des licences de production. | **Corrigé** — `.vscodeignore` réécrit ; `scripts/check-vsix.mjs` et `scripts/check-licenses.mjs` ; `npm run check:security`. |

## 3. Tests d'attaque écrits

`test/unit/security/` (231 assertions) et `test/integration-security/` (7, VS Code réel) :

- **`path-traversal.test.ts`** — 16 formes hostiles (`..`, absolu POSIX/Windows, UNC, `%2f`, NUL, saut de ligne, RLO, zero-width, solidus pleine largeur, 4096 caractères…) contre `sessionId` (collector **et** CLI), les ids d'inbox, `remove()`/`archive()` ; **symlink réel** créé dans un tmpdir et pointant hors de l'inbox ; `referenceAudio` et `apiKeyRef` d'un profil importé.
- **`webview-injection.test.ts`** — CSP et nonce ; le **vrai `media/player/player.js`** exécuté contre un DOM minimal et nourri de 10 charges (script, `<img onerror>`, `javascript:`, échappement d'attribut, séquences ANSI, RLO) : tout finit en `textContent` ; 9 URLs hostiles refusées par `audio.src`, 2 légitimes acceptées ; garde statique contre `innerHTML` & co.
- **`egress-bypass.test.ts`** — userinfo, IPv4 décimale/octale/hexa/courte (canonicalisées par WHATWG : documenté et verrouillé), `::ffff:1.2.3.4`, `0.0.0.0`, `[::]`, `file:`/`data:`/`ws:`, rebinding (réponse mixte, vide, publique), **TOCTOU à deux résolutions**, redirections croisées et vers schéma interdit, `strictLocal`, absence de query string dans le journal.
- **`secret-redaction.test.ts`** — clé dans une URL, un en-tête, un message d'erreur provider, une exception ; niveau `debug` ; champs bannis ; absence de clé dans `globalState`, le cache disque et les sidecars.
- **`hook-robustness.test.ts`** — 10 `settings.json` malformés × 3 opérations, hooks tiers préservés, double installation, désinstallation exacte (diff JSON), modes 0600 ; collector avec 50 Mo, binaire, surrogate isolé, BOM, JSON invalide, inbox non créable, **échec d'écriture** (aucun `.tmp-` résiduel) : toujours `exit 0`.
- **`supply-chain-and-permissions.test.ts`** — lockfile, dépendances de prod, `.vscodeignore` ; inbox `0700` / fichiers `0600` après écriture réelle, resserrement d'un dossier laissé en `0755`, `archive/` en `0700`.
- **`test/integration-security/webview-csp.test.ts`** — CSP servie par une vraie webview, nonce différent entre deux rendus, `localResourceRoots` effectifs, message d'inbox hostile traversant le pipeline réel, import de profil hostile contre le vrai `SecretStorage`.

## 4. Chaîne d'approvisionnement

- `npm audit --omit=dev` : **0 vulnérabilité**. 74 paquets de production, **tous MIT** (`npm run check:licenses`, refus de GPL/AGPL/SSPL et de toute licence non identifiée).
- VSIX : **14 entrées**, aucun test, aucune fixture, aucun `.map`, aucune source `.ts`, aucun secret (`npm run check:vsix`).
- Les dépendances **de développement** portent 10 vulnérabilités connues (2 critiques, 2 hautes : `esbuild`/`vite`/`serialize-javascript` via `vitest` et `@vscode/test-cli`). **Accepté** : rien de tout cela n'entre dans le VSIX, et les correctifs disponibles sont des changements majeurs de l'outillage de test. À traiter en 0.2, hors gel de release.

## 5. Ce qui reste hors garantie

1. **Windows** — aucune ACL n'est posée sur l'inbox ; seule l'ACL du profil utilisateur protège. Documenté dans `SECURITY.md`, suivi pour 0.2 (F-09 de la revue v1).
2. **Prompt injection du narrateur** — un document ou une réponse d'agent peut influencer le texte que le narrateur produit. C'est du contenu, pas du code : la webview le rend inerte, mais rien ne garantit que le texte *narré* soit fidèle.
3. **Voice cloning** — le consentement reste déclaratif (pas de watermarking, pas de traçabilité de la source).
4. **ENOSPC réel** — simulé par un système de fichiers non inscriptible, pas par un disque plein (nécessiterait un montage loopback root). Le chemin de nettoyage est couvert par construction.
5. **Hors de notre contrôle** — télémétrie de VS Code et des autres extensions, auto-update du client Ollama desktop, premier téléchargement HuggingFace des modèles TTS (volontaire, une fois).
6. **Attaquant local déjà présent** — un processus tournant sous le compte de l'utilisateur peut lire l'inbox et le cache. Les modes `0700`/`0600` protègent des *autres* comptes, pas de celui-ci.
