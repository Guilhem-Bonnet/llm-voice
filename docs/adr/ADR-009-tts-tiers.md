# ADR-009 — Offre TTS à trois niveaux : local, entreprise, API

## Statut

Accepté (2026-09-08), D9 mise à jour par D11 (Linux first).

## Contexte

Le CdC prévoit déjà un provider cloud en P2 (UC-16) via `/v1/audio/speech`.
En entreprise, on ne peut pas toujours installer un serveur TTS avec GPU.
D9 propose une grille à trois niveaux sur le même contrat `TtsProvider`.
D11 (`linux-first-v1.md` §2-3) affine le niveau « local sans installation »
et le niveau 1 GPU pour la machine cible (RDNA4/gfx1201).

## Décision

| Niveau | Provider | Version |
|---|---|---|
| 1. Local (GPU) | Chatterbox / Kokoro sur `localhost`, conteneur `Dockerfile.rdna4` + `docker-compose-rdna4.yml`, `ROCBLAS_USE_HIPBLASLT=0` pour gfx1201 (ROCm ≥ 7.2, pas de `HSA_OVERRIDE_GFX_VERSION`) | 0.1 |
| 1b. Local sans installation | **Piper** (voix fr_FR siwis/tom) en premier choix, derrière un petit serveur compatible `/v1/audio/speech` (`openedai-speech` est archivé depuis janvier 2026 → wrapper actif type `piper-tts-http-server`/`speaches`, ou wrapper maison ~100 lignes) ; Kokoro fallback n°2 ; `spd-say`/`espeak-ng` en dernier recours système | 0.2 |
| 2. Entreprise | Même provider compatible OpenAI, pointé sur un serveur TTS hébergé par la DSI, HTTPS + jeton, `llmVoice.network.trustedHosts` verrouillable par politique VS Code | 0.2 |
| 3. API cloud | `OpenAICompatibleTtsProvider` (OpenAI TTS, tout service compatible), puis providers dédiés (ElevenLabs, Azure Speech) | 0.2 (compatible OpenAI), 0.3 (dédiés) |

- **Un seul code pour 1, 2 et 3** : `OpenAICompatibleTtsProvider` avec
  `baseUrl`, `apiKey?`, `voice`, `model`. Seul le niveau 1b a un provider
  dédié (`SystemTtsProvider`).
- **Garde réseau à trois listes** : `localhost` toujours autorisé ; hôtes
  d'entreprise dans `trustedHosts` ; tout le reste demande un consentement
  explicite et affiche ☁. TLS obligatoire hors localhost.
- **Narrateur** (optionnel) : même logique — Ollama local, ou endpoint
  compatible OpenAI hébergé par l'entreprise. Aucun LLM cloud ajouté.
- **Recommandation de séquencement** : niveau 1 en 0.1 ; 1b, 2 et 3
  (compatible OpenAI) ensemble en 0.2 ; providers cloud dédiés en 0.3
  seulement si demandés.

## Conséquences

- Le contrat `TtsProvider` unique simplifie fortement le code et les tests
  (un seul chemin HTTP à garantir sûr, cf. ADR-010).
- La dépendance à `openedai-speech` est explicitement écartée : le niveau
  1b doit budgéter l'écriture ou l'intégration d'un wrapper actif.
- gfx1201 (RDNA4) est un chemin natif ROCm 7.2, pas de bricolage de
  variables d'environnement de compatibilité — réduit le risque de crash
  documenté avec `HSA_OVERRIDE_GFX_VERSION` forcé sur matériel natif.

## Alternatives rejetées

- **Un provider TTS distinct par niveau** : rejeté, duplique le code HTTP,
  complique les tests et la garde réseau (ADR-010) qui doit rester au
  même point de passage unique.
- **Coqui XTTS v2 comme niveau 1b** : rejeté, trop lourd sans GPU (~1,8 Md
  paramètres) et dépend d'`openedai-speech` (archivé).
- **`HSA_OVERRIDE_GFX_VERSION` pour gfx1201** : rejeté, inutile avec ROCm
  7.2 natif et documenté comme cause de crash sur ce matériel.

## Tests qui prouvent la décision

- Unit : `OpenAICompatibleTtsProvider` contre un stub HTTP pour les
  niveaux 1, 2 et 3 (mêmes assertions de contrat `TtsProvider`).
- Unit : `SystemTtsProvider` (niveau 1b) — sélection Piper si serveur
  disponible, fallback `spd-say`/`espeak-ng` sinon.
- Intégration : `docker-compose-rdna4.yml` démarre Chatterbox et répond
  sur `/v1/audio/speech` en local (CI ou machine de développement RDNA4).
- Intégration : requête vers un hôte hors `trustedHosts`/`localhost` est
  bloquée par défaut et affiche le badge ☁ (couvert en détail par
  ADR-010).
