# Contexte Partagé — TTS-Voice (produit : « LLM Voice »)

> Ce fichier est chargé par tous les agents au démarrage.
> Il est la source de vérité pour le contexte projet.
> Mis à jour par Marcel (concierge) le 2026-09-08 à partir de `cahier-des-charges.md`.

## Projet

- **Nom** : TTS-Voice (nom produit : **LLM Voice**)
- **Description** : Extension Visual Studio Code qui transforme du contenu textuel de l'IDE
  (Markdown, sélection, curseur, presse-papiers, réponses finales de Claude Code) en lecture
  vocale locale, avec profils de narration (transformation LLM facultative), plusieurs voix,
  surlignage synchronisé du segment lu, et contrôles Play/Pause/Stop/Précédent/Suivant.
- **Type** : extension VS Code (TypeScript) + scripts d'intégration (hook Claude Code) + services locaux optionnels
- **Stack** : TypeScript, Node.js 22, VS Code Extension API, unified + remark-parse + remark-gfm, Zod,
  vitest (unit), @vscode/test-cli + @vscode/test-electron (intégration), @vscode/vsce (packaging)
- **Providers locaux** : Ollama (narrator, `localhost:11434`, structured outputs) ; Chatterbox
  Multilingual V3 via serveur HTTP compatible `/v1/audio/speech` (TTS principal) ; Kokoro (fallback léger)
- **Plateforme prioritaire** : Linux (machine dev AMD RDNA4 / ROCm) ; cible Windows + macOS pour la 1.0
- **Spécification** : `cahier-des-charges.md` (88 sections, 17 critères d'acceptation AC-01..AC-17)

## Invariants non négociables (P0)

1. **Zéro autoplay** : aucun chemin de code `Claude Stop → Player.play()`. Le hook Claude ne fait que déposer dans l'Inbox.
2. **Local-first** : par défaut aucun contenu ne quitte la machine ; garde `localOnly` (localhost/127.0.0.1/::1).
3. **Provider agnostic** : Chatterbox, Kokoro, Ollama, Claude, Copilot derrière des interfaces ; jamais de dépendance forte.
4. **Profils configurables** plutôt que modes codés en dur.
5. **Modèles jamais embarqués dans le VSIX** ; le GPU est géré par le serveur TTS.

## Infrastructure

| Hôte | Rôle | Services |
|------|------|----------|
| Machine dev locale (Fedora, RDNA4) | dev + E2E réel | VS Code, Ollama :11434, Chatterbox-TTS-Server :8004, Weaviate/Neo4j/Redis (mémoire Grimoire) |
| GitHub `Guilhem-Bonnet/llm-voice` (à créer) | repo public, CI matrice 3 OS | GitHub Actions, Dependabot, CodeQL, Releases (VSIX) |

## Organisation du travail

- Plan maître : `_grimoire-output/planning-artifacts/master-plan-llm-voice-v1.md`
  (routage LLM par agent, chaîne de vérification, pyramide de tests, phases 0→6).
- Rapports phase 0 : `review-cdc-v1.md`, `brainstorm-llm-voice-v1.md`,
  `security-privacy-review-v1.md`, `github-repo-ci-plan-v1.md` (même dossier).
- Routage LLM : Fable = orchestration/gates uniquement ; Opus = ADR, state machine, audit sécurité ;
  Sonnet = code/tests/revues ; Haiku = CI/docs/mémoire. **Toujours passer `model:` au dispatch**
  (les agents `.claude/agents/*.md` en `inherit` tourneraient sinon sur Fable).
- Vérificateur ≠ auteur, contexte neuf. Gate de phase = `grimoire standard gate check --task-id <phase> --strict`.

## Conventions

- Langue de communication : Français
- Conventional Commits, SemVer, trunk-based, PR obligatoire sur `main`
- Toutes les décisions sont loggées dans `decisions-log.md`
- Briefs de sous-agents préfixés `MODE NON-INTERACTIF` ; sortie dans un fichier, retour ≤ 10 lignes

## Requêtes inter-agents

- [ ] [forge→backend-engineer] `OpenAICompatibleTtsProvider` (`vscode-extension/src/tts/OpenAICompatibleTtsProvider.ts`)
      ne colle pas au contrat réel de Chatterbox-TTS-Server (confirmé en E2E réel, S4.3, 2026-09-08,
      `docs/e2e/report-2026-09-08.md`) : (1) `POST /v1/audio/speech` répond HTTP 422 sans `model` **et**
      `voice` dans le corps — le provider ne les envoie que `if (request.xxx !== undefined)`, donc un
      `TtsRequest` sans voix/modèle explicite (cas courant) échoue contre ce serveur ; (2)
      `GET /v1/audio/voices` répond `{ status, voices: string[] }` (noms de fichiers, ex. `"Emily.wav"`),
      pas `{ voices: { id, name, language }[] }` — `listVoices()` mapperait chaque entrée sur `id:
      undefined`. À réconcilier (soit adapter le provider à ce serveur précis, soit documenter/adapter
      côté `deploy/tts/config.yaml` un contrat différent) avant de considérer ADR-009 "un seul code pour
      1/2/3" validé de bout en bout contre ce serveur communautaire.
      **(3) Accent anglophone confirmé sur du texte FR** (retour utilisateur, diagnostiqué 2026-09-08,
      2 itérations) : `POST /v1/audio/speech` accepte un champ optionnel `language` (schéma
      `OpenAISpeechRequest`), mais l'envoyer (`"language":"fr"`) produit un WAV **strictement
      identique octet pour octet** à ne pas l'envoyer (checksums MD5 comparés) — donc **ignoré** par cet
      endpoint sur ce serveur. `POST /tts` (endpoint natif, hors contrat OpenAI), lui, **honore** bien
      `language` (checksums différents entre `language` absent/`"fr"`/`"en"` sur les mêmes texte/voix).
      Modèle bien `chatterbox-multilingual` chargé côté serveur (logs : `ChatterboxMultilingualTTS`,
      23 langues dont `fr` confirmées via `GET /api/model-info`) — ce n'est donc pas un modèle anglais
      chargé par erreur, c'est spécifiquement `/v1/audio/speech` qui n'applique pas `language`. Aucune
      voix prédéfinie étiquetée française parmi les 28 embarquées (`GET /get_predefined_voices`), ni
      dans `reference_audio/` (`Gianna.wav`, `Robert.wav`) — probable accent résiduel même avec
      `language` correctement appliqué ; le clonage vocal avec un échantillon FR (CdC §55) reste la
      vraie solution pour une voix nativement française. **Pertinent pour `ChatterboxProvider` (PR #28)**
      si ce serveur communautaire est retenu comme défaut livré : il devra soit utiliser `/tts` au lieu
      de `/v1/audio/speech` pour que `language` soit pris en compte, soit documenter/contourner
      autrement. Non corrigé ici (hors périmètre ops, S4.3) ; validation à l'oreille du résultat non
      faite par cet agent (pas de perception audio) — un humain doit confirmer sur
      `~/.llm-voice/e2e/reference.wav` (régénéré via `/tts` + `language=fr`, `docs/e2e/report-2026-09-08.md`).
      **Cause racine confirmée par retour utilisateur direct** : les 28 voix prédéfinies sont anglophones,
      Chatterbox clone l'accent de la référence quel que soit `language`. `voice_mode: "clone"` avec une
      référence FR (testé : Piper `fr_FR-siwis-medium` synthétique, puis extrait LibriVox humain domaine
      public, 3 jeux de paramètres A/B/C) améliore le résultat mais reste un correctif, pas une solution
      produit. **Le mode voix prédéfinie du serveur communautaire donne un accent anglais en français ;
      le provider Chatterbox doit supporter `voice_mode: clone` avec un échantillon français, et LLM
      Voice doit embarquer ou générer une référence FR par défaut (Piper siwis) — point de revue pour la
      PR #28 et exigence CdC §55.** Détail complet, sources et tableau latence/paramètres :
      `docs/e2e/report-2026-09-08.md`.
