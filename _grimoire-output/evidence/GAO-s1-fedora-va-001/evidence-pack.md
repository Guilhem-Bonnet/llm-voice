# Evidence Pack — GAO-s1-fedora-va-001

Environnement : Fedora, PipeWire/WirePlumber, `wpctl`/`pactl` réels. Binaire testé : `target/release/llm-voice-core` (`cargo build --release -p llm-voice-core`, vert). Script : `scripts/audio-proof/wayland-validation.sh` (exécutable, trap de restauration/déchargement vérifié). Fichier de référence : `deploy/tts/reference-audio/fr-female-siwis.wav` (24 kHz mono, 12,58 s, 5 phrases ; texte de référence obtenu par transcription initiale faster-whisper, réutilisé comme `--expect`).

Aucun vrai périphérique (Razer, HDMI, USB, `sc_*`) n'a été reconfiguré par ce script : seuls 4 sinks nuls `llmvoice_va_{a,b,c,d}_<pid>` ont été créés/déchargés, et le sink par défaut original (`alsa_output.usb-Razer_Inc_BlackShark...pro-output-0`) a été restauré après chaque exécution (vérifié : `pactl get-default-sink` après coup == valeur avant coup). **Note de transparence** : le Cas 1 révèle que le Core lui-même, faute de ciblage explicite, peut faire router transitoirement l'audio par WirePlumber vers un périphérique réel mémorisé — ce n'est pas une action de ce script mais un comportement du logiciel sous test, documenté ci-dessous comme défaut F-1.

## Tableau des résultats

| Cas | Verdict | Mesure |
|---|---|---|
| 1. Sortie par défaut, sans PIPEWIRE_NODE forcé | **FAIL** | Capture sur le sink nul A silencieuse (`rms=0.0`, `silence_max_ms=15000`) alors que `ended` a bien été reçu et le Core est resté vivant. Whisper hallucine sur le silence (« Sous-titres réalisés par la communauté d'Amara.org »). `wer=0.97`. |
| 2. Bascule à chaud A→B pendant lecture (12,58 s, bascule à t≈5 s) | **PASS** (survie) / **inconclusif** (trajet) | `ended` reçu, aucun `error` WS, Core vivant. Capture A et B toutes deux silencieuses (`silent=true`) — confondu par le même défaut que le Cas 1 (voir F-1) : impossible de conclure « suit » vs « reste » tant que F-1 n'est pas corrigé. |
| 3. Disparition du sink pendant la lecture (déchargé à t≈3 s) | **PASS** | Core toujours vivant (`kill -0` positif), `/health` répond après déchargement (`{"protocolVersion":"1.0","status":"ok",...}`), `ended` reçu, aucun `error` WS. Pas de plantage. |
| 4. Suspension/reprise du sink (suspend à t≈3 s, reprise à t≈5 s) | **PASS** (survie) | Core vivant, `ended` reçu. Capture silencieuse (même confusion F-1 — pas de conclusion possible sur la continuité audio pendant la coupe). |
| 5. Casque USB réel | Non exécuté | **Revue humaine** — toucherait un périphérique réel, hors périmètre autorisé de cet agent. |
| Veille système | Non exécuté | **Revue humaine** — non automatisable sans affecter la machine de l'utilisateur. |

Sorties complètes : `wayland-validation/run.log`, `wayland-validation/case{1,2,3,4}.json`, captures `wayland-validation/case*.wav`.

## Reproduction du Cas 1 en isolant la variable

Pour confirmer que le Cas 1 est un défaut du Core (pas un artefact du banc), rejouée manuellement la même séquence en forçant `PIPEWIRE_NODE`/`PIPEWIRE_PROPS` (`node.dont-move=true`, `node.name` dédié — même parade que `scripts/audio-spike/core-play.sh`) avant de lancer le même binaire sur le même sink nul :

```
{"wer": 0.098 (3 mots sur les 5 attendus dans l'extrait testé), "transcription": "Vous verrez que c'est un sujet important. Cela soulève une vraie interrogation. Aussi, votons laissons réserve. Essayons donc de faire mieux. Les caisses régionales d'épargne organisent quant à elles l'épargne.", "silence_max_ms": 1980.0, "rms": 0.093903, "silent": false}
```
→ Avec le ciblage explicite, la capture n'est plus silencieuse et la transcription correspond exactement au texte de référence. **Confirme** que l'absence de ciblage explicite (Cas 1, tel que demandé par le brief : « sans PIPEWIRE_NODE forcé ») laisse WirePlumber libre de router le flux `cpal` du Core ailleurs que sur le sink par défaut demandé — potentiellement vers un périphérique réel déjà utilisé par un flux du même nom de processus.

## Défauts trouvés

### F-1 — Le Core natif ne cible pas explicitement le sink par défaut à l'ouverture du flux `cpal`
- **Gravité** : Haute (fonctionnelle) — sur une machine avec WirePlumber et une règle `module-stream-restore` mémorisant une route pour le nom de flux du Core, la lecture peut sortir sur un périphérique différent de celui que l'utilisateur vient de choisir comme sortie par défaut, y compris un vrai périphérique (casque, HDMI) alors que l'utilisateur croit écouter sur autre chose.
- **Fichier:ligne** : `crates/llm-voice-audio/src/player.rs:140-143` — `cpal::default_host().default_output_device()` sans propriétés de flux (`node.name`, `node.dont-move`, `target.object`), contrairement à `scripts/audio-spike/core-play.sh:57-66` qui applique ce contournement en externe (variables d'environnement `PIPEWIRE_NODE`/`PIPEWIRE_PROPS`) uniquement pour ses propres bancs de preuve — le Core lui-même, lancé par l'extension VS Code en production, n'a pas ce filet.
- **Preuve reproductible** : `scripts/audio-proof/wayland-validation.sh` Cas 1 (capture silencieuse, `rms=0.0`) contre le même test avec `PIPEWIRE_PROPS` forcé (capture correcte, `wer=0.098`) — seule variable changée entre les deux runs.
- **Correctif proposé (non appliqué)** : dans `crates/llm-voice-audio/src/player.rs`, remplacer `host.default_output_device()` par une sélection de périphérique qui fixe des propriétés de flux dédiées avant `build_output_stream` — en pratique sous PipeWire/ALSA cela passe par les variables d'environnement `PIPEWIRE_PROPS`/`PIPEWIRE_NODE` lues par `pipewire-alsa` au moment de l'ouverture du device (le binding `cpal`/`alsa-rs` ne les expose pas directement) : soit (a) le processus parent (extension) les positionne avant de spawn le Core avec un `node.name` unique et stable (`llm-voice-core`) et `node.dont-move=true`, en s'assurant qu'aucune règle stream-restore ne mémorise une route piégeante pour ce nom, soit (b) documenter dans ADR-012 que le Core doit toujours être lancé avec ces variables et l'ajouter au code de démarrage de l'extension (`vscode-extension/src/playback/CoreProcess.ts`, à vérifier — non lu dans cette tâche). Corrélé au point 6 déjà noté dans `_grimoire-output/evidence/GAO-core-rust-mi-001/evidence-pack.md` (lignes 77) comme limite connue de l'étape A ; ce constat montre qu'elle affecte aussi le chemin nominal (Cas 1), pas seulement le scénario de bascule manuelle de `core-play.sh`.

### F-2 — Impossibilité de distinguer le comportement réel lors d'une bascule/suspension tant que F-1 n'est pas corrigé
- **Gravité** : Moyenne (couverture de test) — les Cas 2 et 4 ne peuvent pas conclure sur la continuité effective de l'audio (suit / reste / coupe) car F-1 rend toute capture sur sink nul non fiable sans ciblage forcé.
- **Fichier:ligne** : conséquence directe de F-1 (`crates/llm-voice-audio/src/player.rs:140-143`) ; pas de code additionnel en cause.
- **Correctif proposé** : une fois F-1 corrigé (ou en forçant `PIPEWIRE_PROPS` comme contournement temporaire), rejouer `scripts/audio-proof/wayland-validation.sh --force-target` (option à ajouter) pour obtenir une mesure fiable du trajet audio lors d'une bascule à chaud du sink par défaut.

## Non-conclusions volontaires
- Cas 5 (casque USB réel) et veille système : non automatisés par choix — toute manipulation aurait touché un vrai périphérique ou l'état d'alimentation de la machine de l'utilisateur, hors du périmètre autorisé de cet agent. Recommandation : revue humaine manuelle, en branchant/débranchant un casque USB réel pendant une lecture et en observant `/health` + événements WS, puis en mettant la machine en veille/réveil pendant une lecture longue.

## Diagnostic final et correctif (concierge, 2026-09-28)

**Cause de F-1 établie** (lecture seule de `~/.local/state/wireplumber/stream-properties`, WirePlumber 0.5.17) : l'entrée
`Output/Audio:application.name:PipeWire ALSA [llm-voice-core]` porte `"target":"sc_media"`. WirePlumber restaure la sortie
mémorisée de l'application, comme pour toute application de bureau. Le Core n'ignore pas le défaut par erreur : le critère
« suit toujours la sortie par défaut » du cas 1 supposait un comportement que PipeWire n'applique à aucune application.

**Correctif** : `CoreProcess.ts` lance le Core avec `PIPEWIRE_PROPS` = `application.name "LLM Voice"`, `node.name
"llm-voice-core"`, `media.role "Accessibility"` (surchargeable par l'environnement, ce que fait le banc).
**Preuve** (fichier silencieux, aucun son émis sur les vrais périphériques) : `pactl list sink-inputs` pendant la lecture via
l'extension → `application.name = "LLM Voice"`, `node.name = "llm-voice-core"`, `media.role = "a11y"`,
`module-stream-restore.id = "sink-input-by-media-role:a11y"`. typecheck 0 erreur, 172 tests playback, build vert.

**Comportement retenu** : LLM Voice suit les règles du bureau — sortie mémorisée par WirePlumber, déplaçable par
l'utilisateur dans les réglages son, défaut système pour un premier lancement. Cas 3 (disparition) et cas 4 (suspension) :
le Core survit et termine (`ended`). Revue humaine restante : casque USB réel, veille système.

**Pollution signalée** : les essais de diagnostic ont laissé des entrées `llm-voice-*` (diag, diag2, wptest, tgt…) dans
`~/.local/state/wireplumber/stream-properties` ; sans effet sur les autres applications, non supprimées (fichier de
l'utilisateur).

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->
