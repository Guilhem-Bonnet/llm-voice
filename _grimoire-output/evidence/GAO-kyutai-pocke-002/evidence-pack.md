# Evidence pack — GAO-kyutai-pocke-002

## Résumé

`KyutaiPocketProvider` (livré/clos par `GAO-kyutai-pocke-001`) est maintenant
sélectionnable via le même mécanisme de preset/factory que les autres
providers, dans `vscode-extension/src/tts/presets.ts` : `TtsPresetKind`,
`KYUTAI_POCKET_LOCAL_PRESET`, `createTtsProvider`, `presetKindForProviderId`.
Aucun fichier exclu (`defaults.ts`, `EgressGuard.ts`, les classes provider
elles-mêmes) n'a été modifié. `Pipeline.ts` n'a pas été touché (voir
"Décision — Pipeline.ts" ci-dessous).

## Fichiers modifiés

- `vscode-extension/src/tts/presets.ts` (+68/-2) :
  - `TtsPresetKind` gagne `"kyutai-pocket"` (ordre alphabétique conservé).
  - `TtsProviderPreset` gagne `languages?: readonly string[]` — à la
    différence de `referenceAudio`/`parameters` (documentation pure, lue par
    rien ici), ce champ **est** lu directement par `createTtsProvider` pour
    `kind: "kyutai-pocket"` (doc comment in situ).
  - `CreateTtsProviderOptions` gagne `defaultVoice?: string` —
    `kind: "kyutai-pocket"` uniquement, ignoré ailleurs, même esprit que
    `referenceAudioPath`/`apiKey`.
  - `KYUTAI_POCKET_LOCAL_PRESET` ajouté et inséré dans
    `TTS_PROVIDER_PRESETS` : `id: "kyutai-pocket-local"`,
    `kind: "kyutai-pocket"`, `baseUrl: "http://localhost:8000"`,
    `languages: ["fr"]`, `voice: "alba"`, `remote: false`, `label` nommant
    explicitement « pocket-tts serve --language french » comme pré-requis à
    la charge de l'utilisateur.
  - `createTtsProvider` : nouveau `case "kyutai-pocket"` instanciant
    `KyutaiPocketProvider({...providerOptions, languages: preset.languages
    ?? [], ...(options.defaultVoice !== undefined ? {defaultVoice} : {})})`.
    Signature élargie en `Pick<TtsProviderPreset, "kind" | "baseUrl" |
    "languages">` pour que `preset.languages` existe au type.
  - `presetKindForProviderId` : nouveau cas `providerId === "kyutai-pocket"`
    → `"kyutai-pocket"` (convention vérifiée : id *provider*, jamais id
    *preset* — "kyutai-pocket-local" tombe dans le générique
    `"openai-compatible"`, exactement comme "chatterbox-local"/
    "kokoro-local" n'ont jamais été matchés).
- `vscode-extension/test/unit/tts/presets.test.ts` (+50) :
  - Preset : `baseUrl`, `kind`, `languages`, `voice`, `remote`, présence du
    texte `pocket-tts serve --language french` dans le `label`, présence
    dans `TTS_PROVIDER_PRESETS`.
  - `createTtsProvider` : instanciation `KyutaiPocketProvider` ; `languages`
    du preset bien threadé ; un appel avec seulement `{kind, baseUrl}` (la
    forme actuelle de l'appel de `Pipeline.ttsFor`) donne `languages: []`,
    jamais une valeur devinée ; `defaultVoice` forwardé uniquement pour
    `kyutai-pocket`, ignoré pour `kokoro`.
  - `presetKindForProviderId("kyutai-pocket")` → `"kyutai-pocket"` ;
    `presetKindForProviderId("kyutai-pocket-local")` → `"openai-compatible"`
    (test dédié à la convention id-provider vs id-preset).

## Correction de l'orchestrateur (2026-11-05) — Pipeline.ts câblé

L'agent auteur avait documenté, à raison, que `Pipeline.ttsFor` n'appelait
`createTtsProvider` qu'avec `{kind, baseUrl}` (jamais `preset.languages`),
ce qui rendait le preset **inerte en pratique** : un profil sélectionnant
réellement `providerId: "kyutai-pocket"` aurait obtenu `languages: []`, pas
`["fr"]` — le critère « sélectionnable depuis un profil » n'était donc pas
vraiment rempli de bout en bout, même si `createTtsProvider`/
`presetKindForProviderId` pris isolément étaient corrects (c'est ce que les
critères de sortie listés vérifiaient explicitement, donc l'agent n'était
pas en faute).

L'orchestrateur a complété `vscode-extension/src/pipeline/Pipeline.ts`
(méthode `ttsFor`) : quand `presetKindForProviderId(resolved.providerId) ===
"kyutai-pocket"`, `KYUTAI_POCKET_LOCAL_PRESET.languages` est maintenant
transmis à `createTtsProvider`. Un seul preset existe pour ce `kind`
aujourd'hui, donc la référence directe est exacte, pas une supposition — un
second preset `kyutai-pocket` exigerait une résolution par id plutôt que
cette référence directe (commentaire laissé en l'état dans le code).

Vérifié après coup : `npx tsc -p ./ --noEmit` propre, `npx eslint
src/pipeline/Pipeline.ts --max-warnings=0` propre, suite complète toujours
verte (108/1869, voir ci-dessous — troisième exécution après ce changement).

## Relecture indépendante (orchestrateur, 2026-11-05)

**Sentinel (`agent-optimizer`, contexte neuf)** : **accepté, aucun point
bloquant**. Vérification par lecture directe de `presets.ts`, ses tests,
`Pipeline.ts` (lignes 1662-1724) et `defaults.ts` (confirme indépendamment
qu'aucun profil par défaut ne référence `kyutai-pocket`). Seule réserve :
Sentinel n'avait pas Bash et n'a pas pu relancer `npm run test:unit`
lui-même — réserve déjà levée par l'orchestrateur, qui a lui-même ré-exécuté
`npm run test:unit`/`tsc`/`eslint` après sa correction de `Pipeline.ts` (voir
ci-dessus), confirmant indépendamment les mêmes chiffres (108/1869).

## Preuves d'exécution

### `npm --prefix vscode-extension run test:unit` — exécuté deux fois

Run 1 :
```
Test Files  108 passed (108)
     Tests  1869 passed (1869)
```

Run 2 (stabilité) :
```
Test Files  108 passed (108)
     Tests  1869 passed (1869)
```

### `npx tsc -p ./ --noEmit` (depuis `vscode-extension/`)

```
TypeScript: No errors found
```

### `npx eslint src/tts/presets.ts test/unit/tts/presets.test.ts` (depuis `vscode-extension/`)

```
ESLint: No issues found
```

## Non vérifié / non fait dans cette carte

- Aucune vérification en conditions réelles contre un serveur `pocket-tts
  serve` vivant (hors scope : cette carte ne touche que la couche
  preset/factory, pas `KyutaiPocketProvider` lui-même, déjà vérifié par
  `GAO-kyutai-pocke-001`).
- `defaults.ts` intentionnellement non modifié (exigé par l'enveloppe) :
  aucun profil par défaut ne référence `kyutai-pocket`.
- Toujours une limite architecturale, pas un bug : un second preset
  `kyutai-pocket` nécessiterait de résoudre `languages` par id plutôt que
  par référence directe à `KYUTAI_POCKET_LOCAL_PRESET` (commentaire laissé
  dans `Pipeline.ts`).
