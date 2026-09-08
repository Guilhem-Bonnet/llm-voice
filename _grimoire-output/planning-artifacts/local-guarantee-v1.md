# Garantie « tout local » — LLM Voice (v1)

> Auteur : Vault (security-hardener). Complète `security-privacy-review-v1.md`
> (F-01, AC-SEC-01) et `decisions-cadrage-v1.md` D9 — ne répète pas ces
> findings, les référence. Objectif : répondre factuellement à « est-on sûr
> que rien ne sort ? » pour toute la chaîne, pas seulement l'extension.

## 1. Inventaire des points de sortie réseau possibles

| # | Composant | Quand ça sort | Vers où | Comment couper | Comment prouver |
|---|---|---|---|---|---|
| 1 | Extension — code métier (fetch narrator/TTS) | À chaque synthèse/résumé | `baseUrl` configurée | Géré par `EgressGuard` (§2) ; `localOnly=true` par défaut (F-01) | Test intégration §3a ; `ss -tnp` §3b |
| 2 | Extension — télémétrie produit | Jamais, si aucune lib de télémétrie n'est ajoutée | — | Ne pas dépendre de `@vscode/extension-telemetry` ; grep CI `"applicationinsights\|extension-telemetry"` doit être vide | `grep -R` en CI + audit `package.json` |
| 3 | Extension — check de mise à jour | Jamais : une extension VS Code n'a pas de mécanisme d'auto-update propre, c'est le Marketplace/VS Code qui gère ça | Marketplace (hors périmètre extension) | Rien à coder ; documenter que c'est VS Code qui vérifie, pas nous | Grep : aucun appel à une URL de version dans le code |
| 4 | Webview — fetch/XHR/WebSocket direct | Si un jour du JS webview tentait un `fetch` | N'importe où | CSP `default-src 'none'; connect-src 'none'` (bloque tout, y compris vers l'Extension Host — normal, la webview ne doit *jamais* faire de réseau, seulement `postMessage`) | Test e2e §3a ; DevTools réseau webview vide |
| 5 | Webview — ressources locales | Chargement `<audio src>`/CSS/JS | Cache disque uniquement | `localResourceRoots` restreint au dossier cache + dossier `media/` de l'extension, jamais `[]`-illimité ni racine utilisateur | Revue de `localResourceRoots` en code review |
| 6 | VS Code — télémétrie produit | Selon `telemetry.telemetryLevel` (défaut historique `all`, `error` depuis la V1 privacy) | `dc.services.visualstudio.com` (Microsoft) | Hors périmètre extension. Documenter : régler `"telemetry.telemetryLevel": "off"` dans `settings.json` | `code --status` / doc utilisateur |
| 7 | VS Code — autres extensions installées | Variable selon extension tierce | Variable | Hors périmètre. Documenter : Copilot/Gemini Code Assist etc. font leur propre réseau, indépendamment de LLM Voice | Revue manuelle des extensions actives |
| 8 | Ollama — `ollama pull` (téléchargement modèle) | Explicitement demandé par l'utilisateur | `registry.ollama.ai` | Normal et attendu une seule fois par modèle ; pas de coupure nécessaire, juste informer l'utilisateur avant | `strace`/`ss` pendant un `pull` volontaire |
| 9 | Ollama — inférence (`/api/generate`, `/api/chat`) | À chaque appel narrator | `OLLAMA_HOST` (127.0.0.1:11434 par défaut) | Rien à faire : Ollama **bind sur `127.0.0.1:11434` par défaut** [1]. Ne jamais positionner `OLLAMA_HOST=0.0.0.0` sans pare-feu | `ss -tlnp | grep 11434` doit montrer `127.0.0.1`, pas `0.0.0.0`/`*` |
| 10 | Ollama — auto-update (app desktop macOS/Windows) | Périodique, en tâche de fond | Serveur de mise à jour Ollama | **Pas de réglage officiel pour désactiver** — demande récurrente non résolue à date de rédaction [2][3][4]. Seul contournement : bloquer le réseau sortant du process Ollama (pare-feu, §3b), ou utiliser la variante Linux (CLI, pas d'app, pas d'auto-update silencieux) | Observer les issues GitHub citées ; `strace -f` sur le process Ollama app |
| 11 | Ollama — télémétrie applicative | Non documenté officiellement comme désactivable via un flag propre à Ollama | Inconnu si activé | **Non vérifié** : aucune confirmation officielle d'un flag `OLLAMA_NO_TELEMETRY` dans la doc actuelle [1][5]. À traiter par la garde réseau générique (bloquer tout sauf 127.0.0.1) plutôt que de compter sur un réglage Ollama | Capture réseau pendant usage normal (§3b) |
| 12 | Chatterbox-TTS-Server — téléchargement modèle HF (1er lancement) | Automatique si le modèle n'est pas déjà en cache | `huggingface.co` / CDN HF | Attendu une fois ; ensuite `HF_HUB_OFFLINE=1` empêche tout appel HTTP au Hub, y compris le HEAD de vérification de version [6] | `strace -f -e trace=network` pendant un lancement avec cache déjà rempli |
| 13 | Chatterbox-TTS-Server — télémétrie HF (transformers/huggingface_hub) | À l'usage, si non désactivée | Hub HF (métriques d'usage) | `HF_HUB_DISABLE_TELEMETRY=1` (désactive aussi automatiquement en mode offline) [6] ; variable universelle `DO_NOT_TRACK=1` équivalente [6] | `HF_HUB_OFFLINE=1` + capture réseau vide |
| 14 | Chatterbox-TTS-Server — code applicatif propre (hors HF) | Non vérifié | Non vérifié | **Non vérifié** : le dépôt `devnen/Chatterbox-TTS-Server` n'a pas été audité ligne à ligne pour d'autres appels sortants (CDN de polices web UI, check de licence, etc.). Recommandation : figer une version (tag/commit), auditer avant premier déploiement, exécuter sous pare-feu de test (§3b) au moins une fois | Audit code + §3b sur un run complet |
| 15 | Kokoro (alternative TTS) | Selon mode d'installation (pip/HF vs binaire local) | HF Hub au premier chargement, comme Chatterbox | Mêmes variables `HF_HUB_OFFLINE`/`TRANSFORMERS_OFFLINE` si le wrapper utilise `transformers`/`huggingface_hub` [6][7] | Non vérifié spécifiquement pour Kokoro — à confirmer à l'intégration |
| 16 | npm — installation extension (contributeur/CI) | Au `npm install`/`npm ci`, jamais côté utilisateur final (le Marketplace livre un VSIX déjà construit, aucun `npm install` ne tourne sur la machine utilisateur) | Registry npm + éventuels binaires prébuilts de dépendances natives | `.npmrc` avec `ignore-scripts=true` committé ; `npm ci --ignore-scripts` en CI ; rebuild explicite `--ignore-scripts=false` uniquement pour les paquets qui en ont réellement besoin [8][9] | CI : diff `.npmrc`, job `npm ci --ignore-scripts` |
| 17 | Hook Claude Code / collector Node | Jamais — lit stdin, écrit un fichier local, exit | — | Aucune dépendance réseau dans le script (déjà spécifié D7) ; lint CI interdisant `http`/`https`/`fetch` dans `llm-voice-capture.js` | `grep -R "fetch\|http\.\|https\." integrations/claude-code/` doit être vide |
| 18 | Cache audio disque | Jamais | — | Lecture/écriture filesystem uniquement | N/A (pas de code réseau dans ce module) |

**Bilan** : sur 18 points recensés, **3 sortent réellement par défaut au moins une fois** : Ollama (`ollama pull`, volontaire), Chatterbox/Kokoro (téléchargement HF au 1er lancement, volontaire), Ollama desktop (auto-update, **non désactivable officiellement** — le seul point préoccupant car non piloté par l'utilisateur). Tout le reste est soit coupé par construction (webview, hook, cache), soit hors périmètre extension (VS Code, autres extensions), soit hypothétique/non vérifié (télémétrie Ollama, code propre de Chatterbox hors HF).

## 2. Garde technique — `net/EgressGuard.ts`

Principe : un seul point de passage pour tout `fetch` émis par l'**Extension Host** (jamais par la Webview — CSP `connect-src 'none'` l'interdit déjà côté webview, voir ligne 4). Résolution DNS avant connexion (anti DNS-rebinding : on ne fait pas confiance au nom, seulement à l'IP résolue), refus de suivre les redirections vers un autre host, journal sans corps.

```ts
// net/EgressGuard.ts
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const isLoopback = (ip: string) => ip.startsWith('127.') || ip === '::1';

export async function guardedFetch(
  url: string, init: RequestInit,
  opts: { localOnly: boolean; trustedHosts: string[]; strict: boolean }
): Promise<Response> {
  const { hostname, pathname } = new URL(url);
  const ip = isIP(hostname) ? hostname : (await lookup(hostname)).address;
  const trusted = !opts.strict && opts.trustedHosts.includes(hostname);
  if (!isLoopback(ip) && !trusted) {
    if (opts.localOnly || opts.strict) throw new EgressBlockedError(hostname);
  }
  const res = await fetch(url, { ...init, redirect: 'manual' });
  const loc = res.headers.get('location');
  if (loc && new URL(loc, url).hostname !== hostname) {
    throw new EgressBlockedError(`redirect->${loc}`);
  }
  auditLog.append({ host: hostname, path: pathname, ts: Date.now() }); // jamais le body
  return res;
}
```

Points de conception à retenir (au-delà du pseudo-code) :
- `trustedHosts` = grille D9 niveau 2 (entreprise) ; ignoré en mode `strict` (bunker, §3c).
- Un statut HTTP 3xx est intercepté **avant** que `fetch` ne le suive (`redirect: 'manual'`), donc jamais de redirection transparente vers un hôte non autorisé.
- Le journal (`auditLog`) est le **seul** état source de l'indicateur 🔒/☁ (rejoint F-12 : pas d'état dupliqué en Webview).
- Toute nouvelle intégration réseau (narrator, TTS, futur provider cloud) doit passer par `guardedFetch` — interdiction de `fetch`/`http.request` direct ailleurs (règle ESLint custom, cf. F-08 pour le pattern équivalent sur les logs).

## 3. Trois niveaux de preuve

### (a) Tests automatiques
- **Unit** : `EgressGuard` — cas nominal loopback, cas IP non-loopback avec `localOnly=true` (rejet), cas hôte de confiance en mode normal (accepté) vs mode `strict` (rejeté), cas redirection 302 vers un autre host (rejeté), cas DNS résolvant vers `127.0.0.1` pour un nom public type "rebinding" (rejeté si le nom n'est pas explicitement loopback — la garde teste l'IP réelle, donc ce cas passe correctement mais illustre pourquoi la résolution DNS avant connexion est nécessaire).
- **Intégration** : scénario complet (narrator + TTS + player) avec interception de toutes les requêtes sortantes via `nock` (mock du module `http`/`https` Node) ou interception au niveau `undici` (`setGlobalDispatcher` avec un `MockAgent`, la méthode recommandée si l'extension utilise le `fetch` natif de Node ≥ 18, basé sur `undici`) ; assertion : 0 requête `MockAgent` non interceptée en mode `localOnly=true`, échec de build si une requête sort de l'allowlist.

### (b) Preuve sur la machine (Linux)

**nftables — bloquer toute sortie du process VS Code sauf loopback, par uid, pendant une session de test :**
```bash
# Table/chaîne dédiée, à activer seulement pendant le test
sudo nft add table inet llmvoice_test
sudo nft add chain inet llmvoice_test out { type filter hook output priority 0 \; policy accept \; }
sudo nft add rule inet llmvoice_test out meta skuid $(id -u) oif lo accept
sudo nft add rule inet llmvoice_test out meta skuid $(id -u) drop
# Lancer VS Code, dérouler le scénario complet (narrator + TTS + lecture)
# ... puis nettoyer :
sudo nft delete table inet llmvoice_test
```
Alternative **firewalld** (zone dédiée le temps du test) :
```bash
sudo firewall-cmd --permanent --new-zone=llmvoice-test
sudo firewall-cmd --permanent --zone=llmvoice-test --set-target=DROP
sudo firewall-cmd --permanent --zone=llmvoice-test --add-interface=lo
sudo firewall-cmd --reload
# lancer le test, puis :
sudo firewall-cmd --permanent --delete-zone=llmvoice-test && sudo firewall-cmd --reload
```
**Observation complémentaire pendant le scénario :**
```bash
strace -f -e trace=network -p $(pgrep -f "code.*extensionHost") 2>&1 | grep -v "127.0.0.1\|::1"
ss -tnp | grep -E "code|node|ollama|chatterbox"   # doit ne montrer que 127.0.0.1/::1
```
Si `nftables`/`firewalld` bloquent tout sauf loopback et que le scénario complet (narrator → TTS → lecture) fonctionne sans erreur réseau visible côté extension, c'est la preuve la plus forte : même une fuite non détectée par les tests unitaires serait physiquement coupée.

### (c) Mode « bunker »
`LLM_VOICE_STRICT_LOCAL=1` (variable d'environnement du processus VS Code, lue au démarrage de l'extension) force `EgressGuard` en mode `strict: true` : **tout** `trustedHosts` (niveau entreprise D9) est ignoré, seule une IP loopback résolue passe, quel que soit `localOnly` (utile pour un audit/démo où on veut la garantie maximale sans dépendre des settings utilisateur, qui pourraient avoir été modifiés). Ce mode ne peut pas être activé depuis les settings VS Code (seulement variable d'env) pour éviter qu'un profil malveillant (F-05) le désactive.

## 4. Ce que l'utilisateur doit honnêtement savoir

| Ce qu'on ne peut pas garantir | Pourquoi | Réglage recommandé |
|---|---|---|
| Télémétrie produit VS Code | Hors du contrôle d'une extension | `"telemetry.telemetryLevel": "off"` dans `settings.json` |
| Comportement des autres extensions installées | Chaque extension a son propre accès réseau, indépendant de LLM Voice | Auditer manuellement les extensions actives ; Copilot/Gemini/etc. envoient déjà du contenu à leurs fournisseurs par nature |
| Auto-update Ollama desktop (macOS/Windows) | Aucun réglage officiel pour le désactiver à date de rédaction [2][3][4] | Préférer la distribution CLI Linux (pas d'auto-update silencieux), ou bloquer le réseau du process Ollama hors 127.0.0.1 via pare-feu si l'auto-update est inacceptable |
| Serveur TTS mal configuré (`OLLAMA_HOST=0.0.0.0`, Chatterbox bind `0.0.0.0`) | C'est une action explicite de l'utilisateur/admin, hors code de l'extension | Documenter clairement : ne jamais binder ces serveurs au-delà de `127.0.0.1` sauf besoin réseau interne assumé (niveau 2 D9), et dans ce cas utiliser `trustedHosts` + TLS |
| Mises à jour npm entre deux versions de l'extension | Une nouvelle dépendance pourrait introduire un appel réseau non prévu | `npm audit` bloquant en CI (AC-SEC-10), revue de diff de `package-lock.json` à chaque PR touchant les dépendances |
| Code propre de Chatterbox-TTS-Server / Kokoro hors chargement HF | Non audité ligne à ligne (point #14 de l'inventaire) | Figer une version testée, exécuter au moins une fois sous le pare-feu de test (§3b) avant de faire confiance |
| DNS rebinding sur un hôte "trusted" niveau entreprise | Le nom peut changer de résolution après l'ajout dans `trustedHosts` | `EgressGuard` résout l'IP à chaque appel (pas de cache DNS long), donc un rebinding vers une IP non-loopback est rejeté même pour un host trusted si l'IP change vers l'extérieur *sans* que l'admin l'ait explicitement voulu — mais un attaquant qui contrôle déjà le DNS d'un host trusted a un vecteur résiduel à documenter |

## 5. Checklist « Local vérifié » (commande `LLM Voice: Verify Local Mode`)

1. Hôte narrator résolu → IP dans `127.0.0.0/8` ou `::1` — sinon ❌.
2. Hôte TTS résolu → IP dans `127.0.0.0/8` ou `::1` — sinon ❌.
3. `localOnly` = `true` dans les settings actifs — sinon ⚠️.
4. Aucun `trustedHosts` non vide sans confirmation explicite préalable — sinon ⚠️.
5. `LLM_VOICE_STRICT_LOCAL` détecté → badge renforcé, ignore le point 4.
6. Requête `GET /health` au serveur TTS (si exposé) : présence d'un champ `offline`/`hf_hub_offline` — si absent, statut « non vérifiable côté extension », jamais ❌ silencieux.
7. CSP webview active (`default-src 'none'; connect-src 'none'`) — vérifiée par lecture du HTML généré, pas déclarative seulement.
8. `localResourceRoots` restreint (pas de racine utilisateur/filesystem entier) — sinon ❌.
9. Aucune dépendance `@vscode/extension-telemetry`/`applicationinsights` dans `package.json` embarqué — sinon ❌.
10. Résultat global : badge **🔒 Local** seulement si 1, 2, 3, 7, 8, 9 sont verts ; sinon badge **⚠️ À vérifier** avec détail point par point (jamais de faux positif silencieux — un point non vérifiable affiche « non vérifiable », pas vert).

## 6. Sources

- [1] Ollama — FAQ officielle, bind `127.0.0.1:11434` par défaut, `OLLAMA_HOST`/`OLLAMA_ORIGINS` : https://docs.ollama.com/faq
- [2] Ollama — demande de désactivation de l'auto-update (issue ouverte) : https://github.com/ollama/ollama/issues/4498
- [3] Ollama — demande similaire : https://github.com/ollama/ollama/issues/6024
- [4] Ollama — demande similaire (désactivation permanente) : https://github.com/ollama/ollama/issues/11804
- [5] Ollama — issue historique sur la nature de la télémétrie (non tranchée officiellement dans le thread consulté) : https://github.com/ollama/ollama/issues/2567 — **non vérifié**, à retraiter si Ollama publie une réponse officielle.
- [6] Hugging Face `huggingface_hub` — variables d'environnement `HF_HUB_OFFLINE`, `HF_HUB_DISABLE_TELEMETRY`, `DO_NOT_TRACK` : https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables
- [7] Hugging Face `transformers` — `TRANSFORMERS_OFFLINE=1` (variable historique, toujours fonctionnelle) : https://huggingface.co/docs/transformers/v4.31.0/installation
- [8] npm — `ignore-scripts` comme mitigation supply-chain : https://www.nodejs-security.com/blog/npm-ignore-scripts-best-practices-as-security-mitigation-for-malicious-packages
- [9] OWASP — NPM Security Cheat Sheet : https://cheatsheetseries.owasp.org/cheatsheets/NPM_Security_Cheat_Sheet.html
- [10] VS Code — Webview API, CSP et `localResourceRoots` : https://code.visualstudio.com/api/extension-guides/webview
- [11] VS Code — `@vscode/extension-telemetry`, respect de `isTelemetryEnabled` : https://www.npmjs.com/package/@vscode/extension-telemetry
- [12] VS Code — réglage `telemetry.telemetryLevel` : https://code.visualstudio.com/docs/configure/telemetry
- [13] devnen/Chatterbox-TTS-Server — téléchargement modèle HF au premier lancement, cache local : https://github.com/devnen/Chatterbox-TTS-Server (documentation.md) — comportement réseau du code applicatif propre **non vérifié en détail** (point #14 de l'inventaire).
- Kokoro — comportement réseau **non vérifié spécifiquement** ; hypothèse par analogie avec l'écosystème HF/transformers, à confirmer à l'intégration.
- nftables — `skuid`, chaîne `output`, `iif lo accept` : https://wiki.nftables.org/wiki-nftables/index.php/Matching_packet_metainformation et https://wiki.nftables.org/wiki-nftables/index.php/Quick_reference-nftables_in_10_minutes
