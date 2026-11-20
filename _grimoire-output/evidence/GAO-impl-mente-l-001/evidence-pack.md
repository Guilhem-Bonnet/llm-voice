# Evidence pack — GAO-impl-mente-l-001

## Origine

Implémentation des deux points "bloque la compréhension de base" de l'audit
UX (`GAO-audit-ux-com-001`), suite à la demande explicite de l'utilisateur de
continuer sur les correctifs priorité 1.

## Diff — 1. Retour visible persistant du choix de voix

- `vscode-extension/src/profiles/ttsProviderLabel.ts` (nouveau) :
  `friendlyTtsProviderLabel(providerId: string | undefined): string` —
  traduit chaque `providerId` connu en libellé clair ("Chatterbox (qualité
  maximale)", "Kokoro (voix locale rapide)", etc.), `undefined` → "Voix
  automatique", inconnu → repli sur l'id brut (jamais une exception).
- `vscode-extension/src/pipeline/Pipeline.ts` : nouveau champ
  `currentVoiceLabel`, mis à jour aux 8 mêmes sites que `currentProfileLabel`
  (`captureAndSpeak`, `selectProfileById`, un chemin de lecture directe,
  `setVoiceForProfile`, `browseVoices`→apply, `setReferenceAudio`,
  `refreshLocalModeBadge`, `applyVoiceTierChoice`) ; branché dans
  `statusBarModel()` (`voiceLabel`) et `pushPlayerState()` (`voice`).
- `vscode-extension/src/core/playback.ts` : `PlayerStateView.voice: string`.
- `vscode-extension/src/ui/statusBarText.ts` :
  `StatusBarViewModel.voiceLabel?: string`, intégré dans
  `formatStatusBarTooltip` (ex. "LLM Voice — Professeur technique
  (Chatterbox (qualité maximale)) — cliquer pour les actions de lecture").
- `vscode-extension/src/views/player/playerHtml.ts` : nouveau
  `<span id="voice">` dans `#profile-group`, visible en permanence (le
  `#title-line` n'est pas masqué par `data-state="idle"`, donc visible
  immédiatement après un choix de voix, sans attendre une lecture).
- `media/player/player.js` : `voiceEl.textContent` alimenté par
  `state.voice`, même garde `typeof === "string"` que `profileEl` (AC-SEC-02,
  aucun `innerHTML`).
- `media/player/player.css` : `.field-hint`/`#voice` stylé en texte
  secondaire discret, préfixé "· " uniquement quand non vide.

**Limitation connue, documentée** (relecture Sentinel de l'audit) : "Voix
système" et "Voix française autonome (Piper)" résolvent au même
`providerId: "system"` — cette implémentation ne les distingue donc pas
(label identique pour les deux). Les distinguer demanderait de câbler
`SystemTtsProvider.detectEngine()` (async) jusqu'aux 3 surfaces, non fait
ici — limitation assumée et déclarée dans l'enveloppe de tâche.

## Diff — 2. Éditeur de profil sans jargon brut

- `vscode-extension/src/views/profileEditor/profileEditorHtml.ts` :
  - `<html lang="en">` → `lang="fr"` ; titre "Profile Editor" → "Éditeur de
    profil".
  - Options de `field-mode` : "Narré" → "Narré (une IA reformule avant de
    lire)", etc.
  - Options de `field-narrator-provider` : chaque option porte maintenant
    son effet ("Ollama — IA locale, aucune donnée envoyée hors de cette
    machine", etc.).
  - Options de `field-tts-provider` : réordonnées (système en premier, déjà
    prêt) et réécrites ("Voix système — déjà installée, aucune
    configuration", "Chatterbox — voix clonée, qualité maximale (nécessite
    Docker)", etc.) — mêmes `value` qu'avant, donc aucun impact sur le code
    qui les lit.
  - Fieldset "Narration" renommé "Réécriture par IA avant la lecture" ;
    nouveau `<p class="field-hint" id="help-style">` expliquant que
    "Consigne de narration" est un prompt envoyé à une IA, avec un exemple
    concret repris de `TECHNICAL_TEACHER_PROFILE.style`.
  - Label "Base URL" complété : "— adresse du serveur de voix (laisser vide
    pour « Voix système »)".
- `media/profileEditor/profileEditor.css` : classe `.field-hint`.

## Résultat des vérifications

```
cd vscode-extension
npx tsc -p ./ --noEmit                                             → No errors found
npx eslint src/profiles/ttsProviderLabel.ts src/profiles/index.ts \
  src/pipeline/Pipeline.ts src/ui/statusBarText.ts \
  src/core/playback.ts src/views/player/playerHtml.ts \
  src/views/profileEditor/profileEditorHtml.ts \
  test/unit/profiles/ttsProviderLabel.test.ts \
  test/unit/ui/statusBarText.test.ts --max-warnings=0                → No issues found
npm run test:unit   → Test Files 109 passed (109) / Tests 1880 passed (1880)
```

Nouveaux tests : `test/unit/profiles/ttsProviderLabel.test.ts` (3 cas :
providers connus, `undefined`→"Voix automatique", id inconnu→repli sans
exception) ; 3 nouveaux cas dans `test/unit/ui/statusBarText.test.ts` pour
`formatStatusBarTooltip` (sans voix, avec voix, état erreur ignore la voix).
Aucune régression sur les 1874 tests préexistants (108 fichiers → 109,
1874 → 1880 tests).

## Relecture Sentinel et corrections apportées

Relecture indépendante (`agent-optimizer`, 2026-11-05) : **accepté avec
réserves, aucune bloquante**. Les 8 sites de `currentVoiceLabel` ont été
revérifiés un par un par le relecteur (lignes exactes citées), les valeurs
`value` des `<option>` confirmées inchangées, la limitation Piper/système
confirmée honnête. Deux réserves non bloquantes corrigées avant clôture :

- **R1** : le nouveau champ `voice` du panneau lecture n'était couvert que
  par le test statique "pas d'`innerHTML`" (`test/unit/security/
  webview-injection.test.ts`), jamais par la couche dynamique qui exécute
  réellement `player.js` contre des charges XSS et vérifie `textContent`.
  Corrigé : `voice` ajouté à la liste d'éléments du DOM factice, au test
  `it.each(XSS_PAYLOADS)` (assertion `voice.textContent).toBe(payload)`) et
  au test de tolérance aux champs non-chaîne.
- **R2** : le test "translates every known providerId" utilisait
  `toContain("Chatterbox")`, qui aurait réussi même si la fonction avait
  renvoyé le nom brut du produit sans traduction. Corrigé : assertions
  `toBe` avec le texte exact attendu, plus un nouveau test
  `never returns the raw providerId unchanged` qui boucle sur tous les ids
  connus et vérifie explicitement qu'aucun n'est renvoyé tel quel.

Points non bloquants, non corrigés (le relecteur lui-même ne les a pas
revérifiés par exécution, seulement par lecture) : CL-002 (règles CSS idle)
et CL-004 (fichier installé) — déjà vérifiés indépendamment par
l'orchestrateur avant la relecture, revérifiés ci-dessous après ce
correctif.

## Reconstruction et réinstallation réelles

`npm run package:linux-x64` puis `code --install-extension
llm-voice-linux-x64.vsix --force` ; vérifié sur le fichier réellement
installé (`~/.vscode/extensions/guilhem-bonnet.llm-voice-0.3.0/dist/extension.js`),
pas seulement le dépôt source — même méthode que les cartes précédentes.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
