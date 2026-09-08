# Revue Sécurité & Confidentialité — LLM Voice (v1)

> Auteur : Vault (security-hardener) — Revue du `cahier-des-charges.md` (sections 3, 10, 25-26, 38-44, 48, 53-56, 78-81, 82).
> Portée : extension VS Code, hors implémentation (le code n'existe pas encore). Findings basés sur le texte du CdC.

## 1. Modèle de menace (STRIDE léger)

Acteurs : utilisateur légitime, processus Claude Code local (semi-fiable — peut produire du texte arbitraire dans `last_assistant_message`), auteur de profil tiers (profil importé, potentiellement malveillant), serveur TTS/Narrator local (supposé fiable mais joignable en réseau), attaquant local (autre process/utilisateur sur la même machine ou sur le LAN si le serveur HTTP écoute au-delà de localhost), attaquant réseau (DNS rebinding, redirection HTTP).

| Surface | STRIDE dominant | Section CdC | Risque principal |
|---|---|---|---|
| Hook Claude `Stop` → Inbox | Tampering, DoS | §39-41, 44 | JSON malformé/géant, écriture concurrente, path traversal via `sessionId`/`cwd` |
| Fichiers Inbox `~/.llm-voice/inbox/` | Info Disclosure, Tampering | §41, 44 | Permissions POSIX non garanties cross-OS, lecture par d'autres users, symlink |
| Webview Player (rendu `spokenText`/résumés) | Tampering (XSS), Info Disclosure | §9, 43 | Injection HTML/JS via contenu Claude/Markdown non fiable |
| Profils JSON (import/export) | Tampering, Spoofing, Info Disclosure | §18, 47 | Prompt injection vers Narrator, `baseUrl` provider pointant hors localhost |
| HTTP localhost (Narrator Ollama, TTS Chatterbox) | Spoofing, Info Disclosure | §21, 25, 48, 80 | Absence de garde `localOnly`, DNS rebinding, redirection vers hôte distant |
| Fichiers voice reference (voice cloning) | Info Disclosure, Repudiation | §55 | Consentement non vérifiable techniquement, fuite si cache exporté |
| Cache audio disque | Info Disclosure | §37-38 | Cache = échos indirects de contenu privé, pas de TTL/purge décrite |
| SecretStorage (clés cloud) | Info Disclosure | §38, §82 AC-17 | Bonne pratique déjà actée ; reste le risque de fuite via logs/erreurs |
| Installation hook (`~/.claude/settings.json`) | Tampering, Repudiation | §39 (implicite, non détaillé) | Modification silencieuse d'un fichier hors du contrôle de l'extension |
| Supply chain npm | Tampering | §57 (implicite) | Dépendances non auditées, absence de lockfile/provenance mentionnée |

---

## 2. Findings

### CRITIQUE

**F-01 — Absence de garde technique `localOnly` explicite (§48, §53, §80)**
Risque : le CdC décrit `llmVoice.tts.baseUrl` / `llmVoice.narrator.baseUrl` comme simples chaînes libres, et §80 exige que `localOnly=true` bloque tout trafic hors `localhost/127.0.0.1/::1`, mais aucune section ne décrit le mécanisme (allowlist, résolution DNS, comportement sur redirection HTTP 3xx). Sans contrôle applicatif, un profil ou un paramètre modifié (accidentellement ou par un profil importé) peut exfiltrer le contenu local vers un serveur distant, en contradiction directe avec §3.2 et §53.
Contrôle : middleware HTTP unique (wrapper `fetch`) qui (a) résout le host avant connexion, (b) vérifie l'IP résolue contre l'allowlist `127.0.0.0/8, ::1` (pas seulement le nom d'hôte, pour contrer le DNS rebinding), (c) refuse de suivre les redirections vers un host hors allowlist, (d) applique la même règle pour Ollama et Chatterbox et pour toute future intégration cloud tant que `localOnly=true`.
Test automatisable : test d'intégration avec un serveur DNS/HTTP factice qui résout `localhost.attacker.test` vers `1.2.3.4` puis redirige vers `evil.example`; assert 0 requête sortante hors allowlist (Nock/MSW pour intercepter `fetch`, ou proxy HTTP de test type `mitmproxy` en CI).

**F-02 — Injection dans la Webview via `last_assistant_message` / Markdown non fiable (§9, §39, §43)**
Risque : le contenu Claude (`last_assistant_message`) et le Markdown source sont rendus dans une Webview HTML (§9). Le CdC ne mentionne aucune CSP, aucun nonce, aucune sanitization avant injection DOM. Un message Claude contenant du HTML/JS (via un prompt injection distant, un fichier `.md` malveillant dans le repo, ou un profil compromis) pourrait s'exécuter dans le contexte de la Webview et, selon les capacités accordées, atteindre l'API `acquireVsCodeApi`/`postMessage` voire le filesystem via le contexte d'extension.
Contrôle : (a) CSP stricte sur la Webview (`default-src 'none'; script-src 'nonce-<random>'; style-src ...`), (b) rendu du texte narré/spokenText en tant que texte pur (textContent, jamais innerHTML), (c) si un rendu Markdown enrichi est nécessaire, passer par un sanitizer (DOMPurify) côté extension avant `postMessage`, jamais côté Webview avec du HTML brut.
Test automatisable : test e2e (Playwright + `vscode-extension-tester` ou harness Webview headless) injectant `<img src=x onerror=alert(1)>` et des payloads XSS classiques (OWASP XSS filter evasion list) dans `spokenText` et vérifiant qu'aucun script ne s'exécute (assert absence d'appel `window.alert`/marker global) + test statique : `grep -R "innerHTML" src/webview` doit retourner vide en CI.

### ÉLEVÉ

**F-03 — Path traversal / symlink sur l'Inbox et le cache (§37, §41)**
Risque : le nom de fichier Inbox intègre `sessionId` (§40-41) et la clé de cache est un SHA256 dérivé de `provider+model+voice+parameters+spokenText` (§37) — le CdC ne précise pas de validation de `sessionId` ni de résolution des symlinks avant écriture/lecture. Un `sessionId` contrôlé (compromission du hook ou d'un client tiers imitant le protocole) contenant `../../` pourrait écrire hors de `~/.llm-voice/inbox/`. Un symlink placé dans le répertoire cache pourrait rediriger une écriture vers un fichier système.
Contrôle : générer le nom de fichier Inbox uniquement à partir de données contrôlées par l'extension (timestamp + UUID interne), ignorer/rejeter tout `sessionId` non conforme à un pattern `^[a-zA-Z0-9_-]{1,64}$` pour l'usage dans un nom de fichier ; résoudre `fs.realpath` et vérifier que le chemin résolu reste sous `globalStorageUri`/`inboxPath` avant chaque write/read (`path.resolve` + `startsWith` sur le répertoire canonique, pas sur la chaîne brute).
Test automatisable : test unitaire fournissant `sessionId = "../../../../etc/cron.d/evil"` et vérifiant `EINVAL`/rejet ; test avec un symlink préexistant dans le dossier cache (créé en fixture) pointant hors du répertoire, vérifiant que l'écriture échoue plutôt que de suivre le lien.

**F-04 — Écriture concurrente Inbox (10 Claude simultanés) sans garantie d'atomicité (§44, §79)**
Risque : §79 exige "10 Claude instances → 10 fichiers distincts", mais rien n'indique une écriture atomique (write temp + rename) ; une écriture directe concurrente sur un nom de fichier généré avec une granularité temporelle insuffisante (ex. horodatage à la seconde) pourrait produire une collision de nom et un fichier tronqué/corrompu lisible par le player.
Contrôle : nom de fichier = timestamp haute résolution + UUID (déjà suffixé `-a8f91` dans l'exemple §41, à documenter comme obligatoire et non prédictible/cryptographiquement aléatoire) ; écriture via fichier temporaire + `fs.rename` atomique dans le même volume ; jamais d'écriture en place sur le fichier final.
Test automatisable : test d'intégration lançant 10-50 écritures concurrentes (Promise.all) avec le collector, puis vérifiant (a) N fichiers valides JSON.parse-ables, (b) aucune collision de nom, (c) aucun fichier partiellement écrit (fixture répétée en CI avec `--runInBand=false` pour forcer la concurrence).

**F-05 — Profils importés : prompt injection et pivot réseau via provider distant (§18, §47)**
Risque : `Import` de profil (§47) charge un JSON définissant `narration.prompt`, `narration.provider`, potentiellement une `baseUrl` custom. Un profil malveillant partagé peut (a) contenir un prompt qui manipule le Narrator pour exfiltrer via le texte généré, (b) pointer `provider`/`baseUrl` vers un serveur distant contrôlé par l'attaquant, contournant silencieusement le mode local si aucune validation de schéma n'existe à l'import.
Contrôle : validation JSON Schema stricte à l'import (types, enums fermés pour `provider`, longueur max du `prompt`), application systématique du garde F-01 sur toute `baseUrl` importée (pas d'exception pour les profils utilisateur), avertissement UI explicite "☁ Remote provider" (déjà prévu §53) déclenché aussi lors de l'import, pas seulement à l'exécution.
Test automatisable : test unitaire d'import avec un profil dont `tts.baseUrl = "http://attacker.example"` et `narrator.provider` inconnu → assert rejet ou downgrade forcé + bannière ; fuzz JSON Schema (ex. `ajv` + corpus de profils malformés) en CI.

**F-06 — Hook Claude modifie `~/.claude/settings.json` sans protocole documenté (§39, implicite)**
Risque : le CdC décrit le hook `Stop` et son payload mais ne documente pas le mécanisme d'installation/désinstallation (consentement explicite, idempotence, sauvegarde de la config existante, retrait propre lors de la désinstallation de l'extension). Une installation qui écrase silencieusement les hooks existants de l'utilisateur (autres extensions/scripts) casse la confiance et peut créer une persistance non désirée.
Contrôle : installation opt-in explicite (bouton/commande dédiée, jamais automatique à l'activation), fusion non destructive du tableau `hooks.Stop` existant (ne jamais `overwrite`), sauvegarde du fichier avant modification, commande de désinstallation qui retire précisément l'entrée ajoutée (identifiable par un marqueur, ex. nom de commande unique) et rien d'autre.
Test automatisable : test d'intégration avec un `settings.json` fixture contenant déjà des hooks tiers → install → assert hooks tiers intacts + hook LLM Voice ajouté ; uninstall → assert retour exact à l'état pré-install (diff JSON).

### MOYEN

**F-07 — Cache audio sans TTL/purge ni contrôle d'accès documenté (§37-38)**
Risque : le cache stocke potentiellement de l'audio dérivé de contenu privé (réponses Claude, code source) indéfiniment dans `globalStorageUri`, sans limite de rétention ni lien avec la suppression d'une entrée Inbox source.
Contrôle : `llmVoice.cache.maxSizeMb` déjà prévu (§48) — compléter par une politique d'éviction LRU documentée + TTL configurable + purge automatique quand l'entrée Inbox correspondante est supprimée (best-effort, via la clé de cache).
Test automatisable : test unitaire simulant un cache dépassant `maxSizeMb` → assert éviction des entrées les plus anciennes jusqu'à respecter la limite.

**F-08 — Logs : périmètre "ne jamais logger" non vérifié automatiquement (§81)**
Risque : §81 liste les interdits (clés API, contenu intégral, réponses Claude, audio) mais rien ne garantit leur respect dans le temps (régression future dans un `logger.debug(JSON.stringify(request))`).
Contrôle : wrapper de logging central unique (pas d'accès direct à `console`/Output Channel ailleurs), lint custom ou test statique interdisant `console.log`/accès direct au canal en dehors du wrapper.
Test automatisable : test qui active tous les niveaux de log (y compris `debug`), exécute le pipeline complet source→TTS avec fixtures contenant une fausse clé API et un secret marker dans le texte, puis grep la sortie de l'Output Channel capturée pour vérifier l'absence du marker.

**F-09 — Permissions POSIX 0600/0700 non applicables sur Windows (§8, §41)**
Risque : §41 prescrit `directory: 0700, files: 0600`, mais le CdC vise aussi Windows (§8 objectif final) où ce modèle de permissions n'existe pas nativement ; sans ACL équivalente, l'Inbox pourrait être lisible par d'autres comptes utilisateurs sur une machine Windows partagée.
Contrôle : sur POSIX, appliquer `chmod 0700/0600` (déjà spécifié) ; sur Windows, utiliser une ACL restreignant l'accès au SID de l'utilisateur courant (ex. `icacls` équivalent programmatique ou lib type `windows-acl`) ; documenter explicitement cette divergence dans le CdC.
Test automatisable : sur CI Linux/macOS, assert `mode & 0o777 === 0o600` (fichier) / `0o700` (dossier) après écriture ; sur CI Windows, assert via `icacls`/API que seul le compte courant a un accès (test skip/adapté par plateforme, pas de faux négatif silencieux).

**F-10 — Supply chain npm non couverte par le CdC**
Risque : aucune section ne mentionne lockfile, audit de dépendances, provenance des packages ou Dependabot/Renovate, alors que l'extension embarque potentiellement des dépendances traitant des flux réseau (fetch/HTTP) et du HTML (Webview).
Contrôle : `package-lock.json` (ou équivalent) committé et vérifié en CI (`npm ci` strict), `npm audit --audit-level=high` en CI bloquant, Dependabot/Renovate activé pour les mises à jour de sécurité, `npm publish --provenance` pour la chaîne de release si publication sur le Marketplace/npm registry.
Test automatisable : job CI dédié `npm ci && npm audit --omit=dev --audit-level=high` (échec = build rouge) ; vérification de présence du lockfile en pre-commit/CI.

### FAIBLE

**F-11 — Voice cloning : consentement déclaratif seulement (§55)**
Risque : le CdC ne demande qu'un rappel UI de consentement, sans mécanisme technique (pas de watermarking, pas de traçabilité de la source du fichier de référence).
Contrôle : accepter que ce soit hors périmètre technique MVP, mais ajouter une case à cocher horodatée/journalisée localement (pas de contenu, juste l'acquittement) pour audit trail minimal.
Test : test unitaire vérifiant que l'activation du mode "reference audio" est bloquée tant que l'acquittement n'est pas enregistré.

**F-12 — Indicateur "🔒 Local" / "☁ Remote" : cohérence UI non testée (§53)**
Risque : l'indicateur est une exigence UX, pas un contrôle de sécurité ; un bug d'affichage (mauvais état affiché) induirait l'utilisateur en erreur sur la confidentialité réelle du flux.
Contrôle : dériver l'indicateur d'un seul état source (le même utilisé par le garde F-01), jamais d'un état dupliqué en Webview.
Test : test de rendu vérifiant que l'indicateur change de façon synchrone avec le changement de `baseUrl`/`localOnly` dans les settings (test de composant Webview).

---

## 3. Exigences de sécurité à ajouter au CdC (critères d'acceptation testables)

- **AC-SEC-01** : Quand `llmVoice.privacy.localOnly=true` (ou par défaut), toute tentative de requête HTTP sortante vers un host dont l'IP résolue n'est pas dans `127.0.0.0/8` ou `::1` est bloquée avant émission, y compris après redirection HTTP.
- **AC-SEC-02** : Le contenu inséré dans la Webview (spokenText, résumés, métadonnées Inbox) est rendu sans exécution possible de script (CSP + nonce actifs, aucun `innerHTML` sur du contenu non fiable).
- **AC-SEC-03** : Un `sessionId`/nom de fichier Inbox contenant des séquences de traversée de chemin (`../`, chemins absolus, caractères de contrôle) est rejeté ou neutralisé avant toute opération filesystem.
- **AC-SEC-04** : 10 écritures Inbox concurrentes produisent 10 fichiers JSON valides et distincts, sans troncature ni collision de nom.
- **AC-SEC-05** : L'import d'un profil est validé contre un schéma JSON strict ; un profil dont la `baseUrl` pointe hors de l'allowlist locale déclenche l'avertissement "☁ Remote provider" avant tout usage.
- **AC-SEC-06** : L'installation du hook Claude Code ne modifie que l'entrée dédiée à LLM Voice dans `~/.claude/settings.json`, préserve les hooks tiers existants, et la désinstallation restaure l'état antérieur pour cette seule entrée.
- **AC-SEC-07** : Aucune clé API, contenu intégral de document, réponse Claude intégrale ou audio n'apparaît dans l'Output Channel, quel que soit le niveau de log actif.
- **AC-SEC-08** : Les clés de providers distants ne sont accessibles qu'via `SecretStorage` ; aucun code ne les lit depuis `globalState`/`workspaceState`/fichiers en clair.
- **AC-SEC-09** : Les fichiers/dossiers Inbox et cache sont créés avec des permissions restreintes au compte utilisateur courant sur chaque plateforme cible (0600/0700 POSIX, ACL équivalente Windows).
- **AC-SEC-10** : Le build CI échoue si `npm audit` détecte une vulnérabilité de sévérité "high" ou supérieure sur les dépendances de production.

## 4. Checklist "privacy by default" pour la 1.0

1. `localOnly` actif par défaut à la première installation, sans configuration requise.
2. Télémétrie désactivée par défaut (`telemetry = OFF`), opt-in explicite si ajoutée plus tard.
3. Indicateur "🔒 Local" / "☁ Remote provider" visible en permanence dans l'UI active.
4. Aucun contenu utilisateur (texte, prompt, audio) transmis à un tiers sans action explicite de configuration par l'utilisateur.
5. Capture Claude Code (`llmVoice.claude.captureEnabled`) désactivée par défaut ou activée avec confirmation explicite à la première utilisation.
6. Clés API cloud exclusivement dans `SecretStorage`, jamais en clair dans les settings VS Code.
7. Logs par défaut sans contenu utilisateur ni secret (niveau `info` minimal en production).
8. Cache audio purgeable manuellement en un clic ; taille max configurable et respectée.
9. Désinstallation de l'extension propose/retire proprement le hook Claude Code installé.
10. Aucune donnée de Voice cloning (fichier de référence) transmise hors machine locale.

## 5. Tests de sécurité automatisables — pyramide

| Niveau | Test | Outil suggéré |
|---|---|---|
| Unit | Validation JSON Schema des profils importés (rejet baseUrl hors allowlist, prompt trop long, provider inconnu) | `ajv` + Jest/Vitest |
| Unit | Rejet des `sessionId`/noms de fichiers avec traversée de chemin | Jest/Vitest, fixtures `../` |
| Unit | Permissions fichiers Inbox/cache après écriture (POSIX + Windows adapté) | Jest/Vitest + `fs.stat`, `icacls` sur Windows CI |
| Unit | Wrapper de log : aucun secret/contenu dans la sortie capturée | Jest/Vitest + capture Output Channel mock |
| Intégration | Garde `localOnly` : blocage requêtes hors allowlist + résistance à la redirection HTTP et au DNS rebinding | Nock/MSW ou `mitmproxy` en CI, DNS mock |
| Intégration | 10 écritures Inbox concurrentes → intégrité et unicité des fichiers | Jest/Vitest + `Promise.all`, FakeNarratorProvider/FakeTtsProvider (§78) |
| Intégration | Installation/désinstallation hook Claude Code : non-destruction des hooks tiers | Jest/Vitest + fixture `settings.json`, diff JSON |
| Intégration | Symlink cache/Inbox pointant hors répertoire autorisé → écriture refusée | Jest/Vitest + fixtures symlink (skip conditionnel Windows si non supporté) |
| E2E | Injection XSS dans la Webview via `spokenText`/résumé Claude (payloads OWASP) | Playwright + `@vscode/test-electron` ou `vscode-extension-tester` |
| E2E | Parcours complet "profil importé malveillant" bloqué avant toute synthèse audio | Playwright/`vscode-extension-tester` + FakeProviders |
| CI (statique) | Audit dépendances npm, lockfile présent, absence de `innerHTML` sur contenu non fiable | `npm audit`, ESLint rule custom / `grep` CI gate, Dependabot |
