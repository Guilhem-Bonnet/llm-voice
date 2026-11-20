# Enveloppe de tâche — GAO-kyutai-pocke-002

## Objectif

Rendre `KyutaiPocketProvider` (livré, carte `GAO-kyutai-pocke-001`, closed)
sélectionnable depuis un profil, via le même mécanisme que les autres
providers (`vscode-extension/src/tts/presets.ts`), sans en faire un défaut
(ADR-016 : opt-in, réglage avancé).

## Périmètre outillé

- Autoriser : `vscode-extension/src/tts/presets.ts` (lecture/écriture),
  `vscode-extension/src/tts/KyutaiPocketProvider.ts` (lecture seule),
  `vscode-extension/src/pipeline/Pipeline.ts` (lecture seule, et écriture
  seulement si `createTtsProvider`/`presetKindForProviderId` ne suffisent
  pas à transporter `languages` jusqu'au provider — vérifier d'abord), tests
  sous la convention existante du dossier `tts/`.
- Exclure : `vscode-extension/src/profiles/defaults.ts` (aucun profil par
  défaut ne doit référencer `kyutai-pocket`), `EgressGuard.ts`,
  `ChatterboxProvider.ts`, `KokoroProvider.ts`, `OpenAICompatibleTtsProvider.ts`,
  `SystemTtsProvider.ts`, `KyutaiPocketProvider.ts` (le provider lui-même ne
  change pas, seule son instanciation est câblée).

## Critères de sortie

- `kind: "kyutai-pocket"` ajouté à `TtsPresetKind`.
- Un preset `KYUTAI_POCKET_LOCAL_PRESET` ajouté à `TTS_PROVIDER_PRESETS`
  (donc sélectionnable dans l'UI de profil existante, sans modification de
  cette UI) : `baseUrl: "http://localhost:8000"`, `voice: "alba"`, `remote:
  false`, un `label` qui indique explicitement que le serveur doit avoir été
  lancé avec `pocket-tts serve --language french`.
- `createTtsProvider({kind: "kyutai-pocket", ...})` instancie
  `KyutaiPocketProvider` avec les bonnes options (`baseUrl`, `egress`,
  `languages`, `defaultVoice`) — `languages` ne doit jamais être deviné, il
  vient du preset ou d'une option explicite, documentée comme reflétant la
  configuration réelle du serveur de l'utilisateur, jamais détectée (aucun
  endpoint ne l'expose, voir le commentaire du constructeur de
  `KyutaiPocketProvider`).
- `presetKindForProviderId("kyutai-pocket")` retourne `"kyutai-pocket"`.
- Aucun profil par défaut ne référence `kyutai-pocket` (`defaults.ts`
  inchangé) : il reste un choix explicite de l'utilisateur dans l'éditeur de
  profil.
- Tests unitaires couvrant `createTtsProvider` pour ce nouveau `kind` et
  `presetKindForProviderId("kyutai-pocket")`.
- `npm --prefix vscode-extension run test:unit` vert.
- `grimoire standard gate check --strict` vert.
