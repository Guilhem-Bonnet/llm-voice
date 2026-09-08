# ADR-010 — `EgressGuard` : garantie « rien ne sort », prouvée

## Statut

Accepté (2026-09-08).

## Contexte

`local-guarantee-v1.md` recense 18 points de sortie réseau possibles dans
la chaîne LLM Voice. Ce qui sort réellement par défaut : `ollama pull`
(volontaire), le téléchargement HuggingFace au premier lancement de
Chatterbox/Kokoro (volontaire, une fois), et l'auto-update du client
desktop Ollama sur macOS/Windows. D10 exige que la garantie locale soit
**prouvée**, pas seulement affirmée.

## Décision

- **Module unique `net/EgressGuard.ts`** : point de passage obligatoire
  pour tout `fetch` de l'Extension Host (jamais la Webview, déjà bloquée
  par CSP `connect-src 'none'`). Résolution DNS avant connexion (anti
  rebinding — on ne fait confiance qu'à l'IP résolue), IP obligatoirement
  dans `127.0.0.0/8` ou `::1` en mode local, refus des redirections
  cross-host (`redirect: 'manual'`, comparaison du `Location`), journal
  hôte + chemin **sans jamais le corps**.
- **Trois listes** : `localhost` toujours autorisé ; `trustedHosts`
  (niveau entreprise, ADR-009) ; tout le reste refusé ou consentement
  explicite. `LLM_VOICE_STRICT_LOCAL=1` (variable d'environnement, pas un
  setting VS Code — pour qu'un profil malveillant ne puisse pas le
  désactiver) force le mode bunker : ignore même `trustedHosts`.
- **Règle d'architecture** : toute nouvelle intégration réseau (narrator,
  TTS, futur provider) doit passer par `guardedFetch` ; interdiction de
  `fetch`/`http.request` direct ailleurs (règle ESLint custom).
- **Preuve à trois niveaux** :
  1. **Unit** : cas nominal loopback, IP non-loopback + `localOnly=true`
     (rejet), hôte de confiance normal (accepté) vs `strict` (rejeté),
     redirection 302 cross-host (rejetée).
  2. **Intégration** : scénario complet (narrator + TTS + player) avec
     interception de toutes les requêtes sortantes (`MockAgent`/`undici`
     ou `nock`) ; 0 requête non interceptée en mode `localOnly=true`,
     échec de build sinon.
  3. **Preuve machine (Linux)** : recette nftables ou firewalld bloquant
     toute sortie sauf loopback par uid, scénario complet exécuté dessous ;
     observation complémentaire `strace`/`ss` filtrée hors 127.0.0.1/::1.
- **Commande `LLM Voice: Verify Local Mode`** : dix contrôles (hôtes
  narrator/TTS résolus en loopback, `localOnly=true`, `trustedHosts` vide
  ou confirmé, détection `STRICT_LOCAL`, CSP webview effective,
  `localResourceRoots` restreint, absence de dépendance télémétrie…).
  Badge **🔒 Local** seulement si tous les contrôles vérifiables sont
  verts ; sinon **⚠️ À vérifier**, jamais de faux positif silencieux — un
  point non vérifiable affiche « non vérifiable ».
- **Honnêteté documentée** : télémétrie VS Code et autres extensions hors
  contrôle de l'extension ; auto-update Ollama desktop non désactivable à
  ce jour ; `HF_HUB_OFFLINE=1`/`HF_HUB_DISABLE_TELEMETRY=1` fixés après le
  premier téléchargement dans `docker-compose.tts.yml`.

## Conséquences

- Chaque nouveau provider (ADR-009) hérite automatiquement de la garantie
  sans code réseau dupliqué.
- Le journal d'audit devient la seule source d'état pour le badge 🔒/☁,
  évitant un état dupliqué côté Webview.
- Coût : discipline ESLint obligatoire sur tout appel réseau, et
  maintenance du pare-feu de test dans la CI/documentation.

## Alternatives rejetées

- **Confiance au nom d'hôte sans résoudre l'IP** : rejeté, vulnérable au
  DNS rebinding.
- **Autoriser `fetch` direct dans certains modules « de confiance »** :
  rejeté, casse le point de passage unique et la traçabilité du journal.
- **`STRICT_LOCAL` en setting VS Code** : rejeté, un profil ou une
  extension tierce malveillante pourrait le modifier silencieusement.

## Tests qui prouvent la décision

- Unit `EgressGuard` : les 4 cas listés ci-dessus (loopback, non-loopback,
  trusted vs strict, redirection).
- Intégration : scénario narrator + TTS + player sous `MockAgent`, 0 fuite.
- Manuel/CI documentée : recette nftables/firewalld dans
  `local-guarantee-v1.md` §3b, à exécuter avant chaque release majeure.
- Unit : `LLM Voice: Verify Local Mode` retourne les 10 statuts attendus
  sur un environnement de test contrôlé (mock de chaque contrôle).
