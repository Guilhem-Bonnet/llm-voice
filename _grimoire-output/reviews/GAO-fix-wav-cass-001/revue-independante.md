# Revue indépendante — GAO-fix-wav-cass-001

Lecture seule. `npm test:unit` et `grimoire task show` NON exécutés (aucun outil d'exécution dans ce contexte). Seule preuve citée : `_grimoire-output/evidence/GAO-fix-wav-cass-001/test-run.json` (111 fichiers, 1910 tests passés, exit 0, 2026-11-05T22:28), non rejouée par moi.

## Constats

- IMPORTANT — `src/tts/KyutaiPocketProvider.ts:187-188` + `src/playback/DiskAudioCache.ts:121-123`.
  Un flux coupé proprement par le serveur (fermeture TCP propre, mi-phrase) donne un `data` plus court que prévu. `repairStreamedWavSizes` le « répare » en l'acceptant tel quel. `put` est idempotent (clé existante : on ne réécrit pas), donc l'audio tronqué est mis en cache définitivement pour cette clé et rejoué tronqué à chaque fois. Le correctif ne distingue pas « flux terminé » de « flux interrompu ».
- MINEUR — `src/core/wavRepair.ts:24-27`. `available` n'est pas aligné sur le `blockAlign` (2 octets en PCM16). Un flux coupé sur un nombre impair d'octets produit une taille de `data` impaire ; le décodeur `hound` peut encore refuser le fichier (« Failed to read enough bytes »), même cas que celui corrigé.
- MINEUR — `src/core/wavRepair.ts:21`. Si `size <= available`, le fichier est rendu inchangé, y compris quand la taille RIFF (octets 4-7) est périmée ou vaut 0xFFFFFFFF. Un en-tête de flux avec `data` exact mais RIFF faux n'est pas corrigé.
- MINEUR — `src/playback/DiskAudioCache.ts:128-130, 236-240`. Après un arrêt entre `writeFile(tmp)` et `rename`, les `*.tmp-*` restent orphelins. `listEntries` ne filtre que `.wav`, donc ils ne sont jamais comptés ni évincés : fuite disque lente. Il n'y a pas de corruption du `.wav` (écriture atomique correcte).
- MINEUR — `DiskAudioCache.ts:129-133`. Le `.wav` est renommé avant le sidecar. Un arrêt entre les deux laisse un WAV sans métadonnées : `getMeta` renvoie `undefined`, mais `listEntries` retombe sur `stat`. Pas de corruption ; la durée n'est plus restituée sur cache hit.

## Points vérifiés sans défaut
- Un WAV valide n'est jamais modifié : retour de la même référence si `size <= available` (`wavRepair.ts:21-23`). Les chunks avant `data` sont parcourus avec alignement pair.
- Un chunk de taille énorme avant `data` fait sortir la boucle sans écriture (pas de débordement). `bytes.slice()` copie ; l'original n'est pas muté.
- La réécriture dans `get` passe par tmp + rename.
- `installFreshness.ts` : avertit au plus une fois, tolère un fichier absent. Pas de défaut.

## Verdict
READY sous réserve : aucun constat bloquant. Le constat IMPORTANT (troncature cachée définitivement) devrait être suivi par une carte. Non vérifié : exécution des tests, contenu des tests `disk-audio-cache.test.ts` (non lu), et contenu de `native-real-cache-empoisonne.log` (non lu).


## Suites données par le concierge (2026-11-05)

- Taille impaire d'un flux coupé : corrigée, `test/unit/core/wavRepair.test.ts`.
- Installation partielle de Piper : corrigée, `.onnx.json` exigé, `test/unit/tts/PiperSetup.test.ts`.
- « Profil pointant vers Piper non installé » : constat non retenu. `ttsBindingForTier("piper")` vaut `{ providerId: "system" }` (`test/unit/onboarding/handleVoiceTier.test.ts:170`), donc une voix fonctionnelle reste active si l'installation est refusée.
- Limite conservée : un flux coupé proprement par le serveur reste indiscernable d'un flux complet, faute de taille annoncée fiable ; le WAV tronqué reste en cache pour sa clé.
- La revue n'a pas exécuté les tests : rejoués par le concierge, `npm --prefix vscode-extension run test:unit` vert.
