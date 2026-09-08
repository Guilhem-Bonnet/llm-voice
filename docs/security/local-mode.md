# Mode local — ce que garantit `EgressGuard`

Voir ADR-010 pour la décision complète ; ce document résume la portée réelle
de la garantie « rien ne sort ».

## Ce qui est garanti

- Tout appel réseau de l'Extension Host passe par `EgressGuard` (point de
  passage unique) : DNS résolu **avant** connexion, IP vérifiée en
  `127.0.0.0/8`/`::1` en mode local, redirections cross-host refusées.
- Un nom qui *ressemble* à local (`localhost.evil`) n'est jamais assimilé à
  `localhost` — seule une correspondance exacte ou une résolution DNS
  vérifiée compte.
- `LLM_VOICE_STRICT_LOCAL=1` force le mode local même si `trustedHosts` est
  configuré : un profil corrompu ne peut pas rouvrir le réseau.
- Le journal ne contient jamais le corps ni les en-têtes d'une requête —
  seulement hôte, chemin (sans requête) et méthode.

## Ce qui n'est pas garanti

- **La Webview** n'est pas couverte par ce module : elle est bloquée par la
  CSP `connect-src 'none'`, un mécanisme distinct — voir le contrôle
  correspondant dans `verifyLocalMode`.
- **VS Code lui-même** (télémétrie du cœur, marketplace, mises à jour) et les
  **autres extensions** installées échappent totalement au contrôle de cette
  extension.
- **Le serveur TTS/Ollama** local (Chatterbox, Kokoro, Ollama) : le
  téléchargement HuggingFace initial et l'auto-update du client desktop
  Ollama restent hors périmètre — voir `local-guarantee-v1.md`.
- `EgressGuard` est une discipline logicielle, pas une sandbox système : un
  process compromis au même niveau de privilège peut la contourner.

## Preuve machine

La recette pare-feu (nftables/firewalld, bloquant tout sauf loopback par
uid, à exécuter avant chaque release majeure) est documentée dans
`_grimoire-output/planning-artifacts/local-guarantee-v1.md` §3b — ne pas la
dupliquer ici.
