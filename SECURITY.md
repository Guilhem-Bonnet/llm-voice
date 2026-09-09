# Politique de sécurité

## Signaler une vulnérabilité

Merci de **ne pas** ouvrir d'issue publique pour une vulnérabilité de
sécurité. Utilisez plutôt les
[GitHub Security Advisories](https://github.com/Guilhem-Bonnet/llm-voice/security/advisories/new)
de ce dépôt pour un signalement privé.

Merci d'inclure :

- une description du problème et son impact potentiel,
- les étapes de reproduction,
- la version de l'extension et l'OS concernés.

Nous accusons réception sous 7 jours et visons une résolution ou un plan de
correction sous 30 jours pour les vulnérabilités critiques.

## Périmètre

- Fuite de contenu (documents, clés API) vers un réseau autre que
  `localhost` sans consentement explicite.
- Exécution de code non prévue via le hook Claude Code ou l'inbox.
- Stockage en clair de secrets (clés API) hors de `SecretStorage`.

## Protection des fichiers locaux

L'inbox (`~/.llm-voice/inbox/`, ou `llmVoice.claude.inboxPath`) et le cache
audio contiennent des dérivés de contenu privé (réponses d'agent, documents
lus, audio synthétisé).

- **Linux/macOS** : le dossier est créé en `0700` et chaque fichier en
  `0600`, posés explicitement (l'`umask` de l'environnement du hook n'est
  pas garanti) et **ré-appliqués à chaque écriture** — un dossier laissé
  trop ouvert est resserré, pas ignoré.
- **Windows** : les modes POSIX n'existent pas ; `chmod` est un no-op que le
  collector avale volontairement. La seule protection en place en 0.1 est
  l'ACL du profil utilisateur qui contient le dossier. **Aucune ACL
  spécifique n'est posée par l'extension** : sur une machine Windows
  partagée entre plusieurs comptes administrateurs, considérez l'inbox comme
  lisible. Suivi pour 0.2 (F-09 de la revue sécurité).

## Garantie « rien ne sort »

Tout appel réseau de l'extension passe par `EgressGuard` (ADR-010) : DNS
résolu avant connexion, connexion établie **vers l'adresse validée** (et non
vers le nom, re-résolu), schémas limités à `http`/`https`, redirections
inter-hôtes refusées. `LLM_VOICE_STRICT_LOCAL=1` (variable d'environnement,
volontairement pas un réglage VS Code) force le mode bunker.

Le rapport d'audit 0.1 — périmètre, findings, ce qui reste hors garantie —
est dans [`docs/security/audit-0.1.md`](docs/security/audit-0.1.md).

## Versions supportées

Tant que le projet est en `0.x`, seule la dernière version publiée reçoit des
correctifs de sécurité.
