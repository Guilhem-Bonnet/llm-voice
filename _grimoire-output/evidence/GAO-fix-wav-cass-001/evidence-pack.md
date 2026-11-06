# Evidence pack — GAO-fix-wav-cass-001

## Diagnostic mesuré

- Profil actif `faithful-local` (`state.vscdb`), tts `kyutai-pocket`, voix `estelle` : le choix était bien enregistré.
- `LLM Voice.log` de la fenêtre : dernière activation 16:58, correctif installé 17:14.
- Cache : 5 WAV `kyutai-pocket` cassés créés à 17:23, sessions 12 et 13 en échec `playback`.
- `resolveDefaultProfileId` et `llmVoice.profiles.bySource` : aucune surcharge Markdown en cause.

## Diff

- `src/core/wavRepair.ts` : réparation déplacée, partagée par le provider et le cache.
- `src/playback/DiskAudioCache.ts` : `get()` répare et réécrit de façon atomique.
- `src/pipeline/Pipeline.ts` : `warnIfInstallIsNewer`, au lancement d'une lecture.
- `scripts/audio-proof/native-real.sh` : `LLM_VOICE_NATIVE_REAL_KEEP_CACHE`.

## Preuves

- Scénario réel, cache volontairement empoisonné : test vert, WER 0,0, silence 2500 ms ;
  fichier passé de 2 000 000 000 à 293 760 octets annoncés (`native-real-cache-empoisonne.log`).
- `npm run test:unit` : 111 fichiers, 1910 tests verts. `tsc`, `eslint` sans erreur.
- `npm run package:linux-x64` puis installation : `dist/extension.js` du 2026-11-05 17:28.

## Limites

- `warnIfInstallIsNewer` n'est couvert par aucun test ; il ne prend effet qu'après un premier rechargement.
- La lecture de document de l'utilisateur après rechargement reste à confirmer ; la preuve réelle passe par le chemin du bouton Test.

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
