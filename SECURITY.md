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

## Versions supportées

Tant que le projet est en `0.x`, seule la dernière version publiée reçoit des
correctifs de sécurité.
