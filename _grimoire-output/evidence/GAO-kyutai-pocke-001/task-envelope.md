# Enveloppe de tâche — GAO-kyutai-pocke-001

## Objectif

Implémenter `KyutaiPocketProvider` (`vscode-extension/src/tts/KyutaiPocketProvider.ts`),
un `TtsProvider` (ADR-005) qui parle au serveur local `pocket-tts serve`
(ADR-016 §2, voie intermédiaire, réglage avancé — pas un défaut).

## Contrat HTTP (vérifié par lecture directe du code source `pocket_tts/main.py`, 2026-11-05)

- `POST /tts` : `multipart/form-data`.
  - `text` (string, obligatoire, non vide).
  - `voice_url` (string, optionnel) **ou** `voice_wav` (fichier, optionnel) —
    mutuellement exclusifs ; ne jamais envoyer de chaîne vide (omettre le
    champ plutôt que `""`).
  - Réponse : flux `audio/wav` chunké (`Transfer-Encoding: chunked`), pas de
    JSON, pas de taille connue à l'avance — lire le flux jusqu'à sa fin.
  - 400 si validation échoue (texte vide, les deux champs voix fournis,
    `voice_url` sans préfixe `http://`/`https://`/`hf://`).
- `GET /health` → `{"status":"healthy"}` (JSON).
- **Pas d'endpoint de liste de voix.** Le catalogue de voix est **statique**,
  côté extension (ADR-016 §4 : CC0/CC-BY seulement, CC-BY-NC exclues).
- **La langue est fixée au démarrage du serveur** (`--language french`), pas
  par requête. `getCapabilities().languages` doit refléter une configuration
  déclarée par l'utilisateur (option de provider), pas une détection
  automatique — il n'existe aucun endpoint pour l'interroger.
- Port par défaut 8000, configurable par flag CLI côté serveur (pas de
  variable d'env lue par `pocket-tts serve`).

## Périmètre outillé

- Autoriser : lecture/écriture dans `vscode-extension/src/tts/`,
  `vscode-extension/src/core/tts.ts` (lecture seule, ne pas modifier le
  contrat `TtsProvider`), `vscode-extension/src/net/EgressGuard.ts` (lecture
  seule, usage via `EgressGuardHandle` injecté, jamais de `fetch` direct) ;
  tests sous `vscode-extension/src/tts/__tests__/` ou l'emplacement des
  tests existants du dossier (vérifier la convention avec `ChatterboxProvider`).
- Exclure : toute modification des providers existants (`ChatterboxProvider`,
  `KokoroProvider`, `OpenAICompatibleTtsProvider`) ; toute modification des
  défauts de profil ; `kyutai-dsm` (TTS 1.6B, hors périmètre de cette carte) ;
  extension d'`EgressGuard` au WebSocket (concerne `kyutai-dsm`, pas ce
  provider qui est HTTP pur).

## Critères de sortie

- `npm --prefix vscode-extension run test:unit` vert, avec des tests pour
  `KyutaiPocketProvider` contre un fake HTTP construit sur le contrat
  ci-dessus (pas un serveur réel — non disponible dans cet environnement).
- `AbortSignal` déjà avorté → rejet par `AbortError` sans requête réseau.
- `health()` → `unreachable` si le serveur ne répond pas ou renvoie une
  erreur ; jamais de faux `ok`.
- Aucune requête hors `127.0.0.1`/`trustedHosts` (test contre `EgressGuard`).
- `getCapabilities()` n'annonce que ce qui est prouvé : pas d'horodatage par
  mot (R4 de l'ADR-016, fermé — absent officiellement), `streaming: false`
  (pas de `synthesizeStream` dans cette carte, l'API ne s'y prête pas :
  réponse en un seul flux WAV, pas de frames discrètes documentées).
- `grimoire standard gate check --strict` vert.
