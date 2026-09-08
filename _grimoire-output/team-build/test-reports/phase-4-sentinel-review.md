# Phase 4 — Sentinel review + Flow merge — rapport détaillé

Repo : `Guilhem-Bonnet/llm-voice`. Worktree : `wt/review` (détaché sur
`origin/main`, jamais écrit dans `/mnt/Travail/Projets/Dev/TTS-Voice`).

## PR #27 — narrateur Ollama/OpenAI-compatible (ADR-005)

**Statut : mergée** (squash, SHA `c31ead3b9b000cd2a3bb2dbd8905cce06033e622`).

### État initial
lint/audit/unit verts, `integration` **rouge sur les 3 OS**, `package` skip.

### Root cause
`.vscode-test.mjs` (profil `real-provider-unavailable`) globait
`out/test/integration-real/**/*.test.js`. La PR ajoutait
`test/integration-real/ollama-narrator.test.ts` (vitest `describe`/`it`,
gated `LLM_VOICE_E2E_OLLAMA`) dans ce même dossier. mocha (`@vscode/test-cli`)
essayait de le `require()` → `Error: Vitest cannot be imported in a CommonJS
module using require()`. Confirmé via `gh api .../logs` (log complet
récupéré, `--allow-escape-sequences` + strip ANSI).

### Correctifs (commit `64dbf83`)
- `.vscode-test.mjs` : fichier nommé explicitement
  (`out/test/integration-real/tts-unavailable.test.js`) au lieu d'un glob —
  même pattern que celui indépendamment choisi par la PR #30 pour le même
  problème (confirmé en lisant sa branche avant de merger).
- **(a)** `SessionBuild.forceFaithful()` (nouveau, `SessionFactory.ts`) +
  `Pipeline.narrationDisabledForSession` : "Read without narration" force
  désormais le repli 1:1 pour tout groupe pas encore dispatché de la session
  en cours *et* pour tout `start()` futur (ce document ou le suivant),
  jusqu'à "Retry" (qui réinitialise le flag). Nouveau
  `NarrationDegradedReason: "user-disabled"`.
- **(b)** Test unitaire (`parseNarration.test.ts`) sur un groupe de 5 blocs,
  réponse modèle dans un ordre mélangé + non 1:1 (fusion BLOCK_002+003) —
  prouve `blockLabel(index) ⇔ group[index]` positionnel et stable.
- **(c)** AC-09/AC-10 : déjà couverts par la PR d'origine
  (`NoNarrator.test.ts` fetchSpy jamais appelé ; `OllamaNarrator.test.ts`
  assertion sur `style` du profil dans la requête réelle au mock server) —
  vérifiés, pas de changement nécessaire.

### Validation locale
`lint`/`typecheck` clean. `test:unit -- --coverage` : **318/318** (was 316),
92.6% lignes (gate 80%). `xvfb-run -a npx vscode-test` : 13+1 passing (les
deux profils), confirmant le fix CI.

Revue postée en commentaire (approve impossible — même compte que l'auteur
de la PR) : https://github.com/Guilhem-Bonnet/llm-voice/pull/27#issuecomment-5592729429

---

## PR #28 — providers TTS Chatterbox/Kokoro (ADR-005/009)

**Statut : mergée** (squash, SHA `e58dad992c747bb1536ff842728565c54e9e9ae9`).

### Merge de main (post-#27)
1 conflit trivial dans `Pipeline.ts` (import : `createTtsProvider`/
`presetKindForProviderId` côté PR28 vs `createNarratorProvider` côté #27
mergé) — combinés, aucun symbole en trop.

### Découverte réelle (GET /openapi.json sur localhost:8004, vérifié en direct)
`POST /v1/audio/speech` (`OpenAISpeechRequest`) : `model`+`voice`
obligatoires, **aucun** champ `exaggeration`/`cfg_weight`/`temperature`/
`language`/mode clone — confirme `docs/e2e/report-2026-09-08.md` ("Accent
français") : `language` ignoré par cet endpoint sur ce serveur. Endpoint
natif `POST /tts` (`CustomTTSRequest`) : `text`, `voice_mode`
(`predefined`|`clone`), `predefined_voice_id`, `reference_audio_filename`,
`exaggeration`, `cfg_weight`, `temperature`, `language`, `output_format`.
Upload : `POST /upload_reference` (multipart/form-data, champ `files`).

### Correctifs (commit `67a23ef`)
- **(a)** `ChatterboxProvider.synthesize()` réécrit pour poster sur `/tts`
  (pas `/v1/audio/speech`). `OpenAICompatibleTtsProvider` inchangée,
  documentée comme réservée aux autres moteurs sans alternative native
  (`docs/providers.md`).
- **(b)** `profile.tts.referenceAudio?: string` ajouté à `TtsBindingSchema`
  (rétro-compatible). Upload une fois, paresseux, mémoïsé (appels
  concurrents partagent l'upload en vol) ; échec d'upload/lecture →
  `synthesize()` rejette (pas de repli silencieux vers une autre voix).
  `Pipeline.ttsFor()` résout le chemin relatif contre `context.extensionUri`
  et l'inclut dans la clé de cache du registre de providers.
- **(c)** `CHATTERBOX_LOCAL_PRESET` (et les 4 profils par défaut) :
  `voice_mode: clone`, référence
  `../deploy/tts/reference-audio/fr-female-siwis.wav` (relative à
  l'extension), `exaggeration 0.4`, `cfg_weight 0.5`, `temperature 0.6`,
  `language fr`. Comment l'extension la localise (dev vs `.vsix` empaqueté,
  limite connue : `deploy/` non embarqué dans le `.vsix`, confirmé par
  `npm run package` — la liste de fichiers du VSIX ne contient pas
  `deploy/`) documenté dans `docs/providers.md`.
- **(d)** `test/integration-real/chatterbox-tts.test.ts` étendu : nouveau
  test `ChatterboxProvider` en mode clone, bootstrap sa propre référence
  depuis la voix prédéfinie du serveur réel (aucun asset repo requis),
  upload → `voice_mode: clone` → synthèse. Exécuté contre le serveur réel :
  **latence 8294 ms (7019 ms au second run), 339884 octets, 7080 ms d'audio
  24 kHz mono, WAV valide > 1 s**. Ajout de `test:integration-real`/
  `vitest.integration-real.config.ts` (sinon apportés par #30) pour tester
  la branche seule.
- **(e)** `xvfb-run -a npx vscode-test` : 13+1 passing. Tests
  backoff/buffering/pinning (`AudioQueue`, `DiskAudioCache`) déjà présents
  dans la PR d'origine, tous verts après réécriture.

### Validation locale
`lint`/`typecheck` clean. `test:unit -- --coverage` : **369/369**, 92.66%
lignes.

Revue postée : https://github.com/Guilhem-Bonnet/llm-voice/pull/28#issuecomment-5592896113

---

## PR #30 — ops Linux (ROCm/Chatterbox, E2E réel)

**Statut : voir section finale (CI en cours au moment de la rédaction).**

### Vérifications (a)-(d)
- **(a)** `gitleaks detect` (deploy/docs/scripts séparément, `.gitleaks.toml`)
  → 0 leak. `grep -rn "/home/" deploy docs scripts` → 1 hit, mais
  `docs/adr/ADR-003-claude-code-hook.md:67` (`/home/user/projet`), exemple
  JSON générique préexistant (PR #18, non touché par #30, hors diff).
- **(b)** Ports : `chatterbox` 8004, narrateur 11434, `piper` 5000 — tous
  `127.0.0.1:<port>:<port>` dans `docker-compose.tts.yml`. `HF_HUB_OFFLINE`
  documenté (`.env.example`, `deploy/README.md`, ADR-010) et câblé.
- **(c)** `deploy/tts/reference-audio/ATTRIBUTION.md` : CC BY 4.0, référence
  SIWIS complète (auteurs, source, fichiers exacts). `docs/voices.md`
  documente aussi consentement + option voix perso.
- **(d)** `LLM_VOICE_E2E=1 npm run test:integration-real` : 3/3 passing
  (branche seule, avant merge de #28) ; après merge de main (post-#28),
  5/5 passing avec `LLM_VOICE_E2E_OLLAMA=1` aussi : narrateur Ollama réel
  3271 ms, Chatterbox clone-mode 7019 ms latence / 339884 octets / 7080 ms
  audio.
- `shellcheck scripts/e2e-local.sh` (seul script ajouté par #30) : 0 issue.

### Merge de main (post-#28)
2 passes : (1) post-#27 seul → conflit trivial commentaires dans
`.vscode-test.mjs` (fusionné) ; (2) post-#28 → conflit add/add sur
`test/integration-real/chatterbox-tts.test.ts` (PR28 avait déjà copié +
étendu ce fichier de #30) — résolu en gardant la version étendue (superset).

Revue postée : https://github.com/Guilhem-Bonnet/llm-voice/pull/30#issuecomment-5592885577

---

## PR #29 — Dependabot vitest/mocker/coverage-v8

**Statut : NON mergée — label `deps-major` posé.**

9/9 checks verts mais `vitest`/`@vitest/coverage-v8` passent de `^2.1.8` à
`^5.0.0` (3 majeures, breaking changes documentés en amont : `clearMocks`
par défaut, Node ≥22/Vite ≥6.4 requis, retrait d'API dépréciées). Règle
orchestrateur : patch/minor seulement, sinon label. Laissée ouverte pour
revue manuelle séparée.

Commentaire : https://github.com/Guilhem-Bonnet/llm-voice/pull/29#issuecomment-5592892787

---

## PR #30 (suite) — merge

**Statut : mergée** (squash, SHA `3b9d6ba89fb03ca05e3e7cad352f2c9d9ead3e71`).
9/9 checks verts (attendus après la 2e passe de merge `main` post-#28).

---

## Validation finale sur `origin/main`

`git log --oneline -4` : `3b9d6ba` (#30) → `e58dad9` (#28) → `c31ead3`
(#27) → `7e9f8a5` (#26, base). Ordre respecté.

| Étape | Résultat |
|---|---|
| `npm ci` | OK, 640 packages |
| `npm run lint` | `ESLint: No issues found` |
| `npm run typecheck` | clean |
| `npm run test:unit -- --coverage` | **369/369**, 92.77% lignes (gate 80%) |
| `xvfb-run -a npm run test:integration` | **13 + 1 passing**, exit 0 × 2 |
| `LLM_VOICE_E2E=1 LLM_VOICE_E2E_OLLAMA=1 npm run test:integration-real` | **5/5 passing** — Ollama réel 2383 ms ; Chatterbox `/v1/audio/speech` réel 8347 ms ; **Chatterbox clone-mode réel : latence 7035 ms, 339884 octets, 7080 ms d'audio 24 kHz mono** |
| `npm run package` | `llm-voice.vsix` généré (12 fichiers, 231.42 KB) |

### Latence Chatterbox clone observée (3 runs indépendants, même texte/paramètres)
- PR #28 (avant merge #30) : 8294 ms
- Post-merge #30→#28 (branche PR30) : 7019 ms
- Validation finale sur `main` : 7035 ms

Cohérent (~7-8 s pour ~7 s d'audio généré, GPU chaud, cf.
`docs/e2e/report-2026-09-08.md` "≈10.4-10.6 s pour ~10 s d'audio, GPU chaud"
— même ordre de grandeur, texte plus court ici).

### Récapitulatif PR
| PR | Verdict | SHA |
|---|---|---|
| #27 narrateur | mergée (squash) | `c31ead3b9b000cd2a3bb2dbd8905cce06033e622` |
| #28 providers TTS | mergée (squash) | `e58dad992c747bb1536ff842728565c54e9e9ae9` |
| #30 ops Linux | mergée (squash) | `3b9d6ba89fb03ca05e3e7cad352f2c9d9ead3e71` |
| #29 Dependabot vitest | **non mergée**, label `deps-major` | — |
