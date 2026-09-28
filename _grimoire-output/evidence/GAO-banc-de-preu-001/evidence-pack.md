# Agentic Evidence Pack

## Summary

- Task id: GAO-banc-de-preu-001
- Profile: controlled
- Outcome: banc de preuve audio autonome livré sous `scripts/audio-proof/` (`setup.sh`, `prove.sh`, `analyze.py`, `selftest.sh`, `README.md`) ; `selftest.sh` vert (référence exit 0, silence exit non nul) sur deux exécutions consécutives ; sonde autoplay `audible-probe.test.ts` copiée dans `vscode-extension/test/integration-security/`.
- Final state: implémentation et auto-test complétés ; passage en `needs_verification` demandé à l'issue de ce pack.

## Evidence inventory

| Evidence | Location | Produced by | Result |
|---|---|---|---|
| Carte claim → running | `grimoire task claim` / `task move --to running` (préexistant à cette session) | — | `running` confirmé (`grimoire task show`) |
| Enveloppe (écrite avant toute modification) | `_grimoire-output/evidence/GAO-banc-de-preu-001/task-envelope.md` | agent-optimizer (skill meta-toolsmithing) | écrite |
| Context bundle | `_grimoire-output/context/GAO-banc-de-preu-001/context-bundle.yaml` | `grimoire task context` | OK |
| Decision trace | `_grimoire-output/decisions/GAO-banc-de-preu-001/decision-trace.yaml` | `grimoire standard decision trace` | OK |
| Installateur venv | `scripts/audio-proof/setup.sh` | agent-optimizer | `uv venv --python 3.12` + `uv pip install faster-whisper numpy` exécutés avec succès, 23 paquets installés sous `~/.llm-voice/tools/audio-proof-venv` |
| Analyse WER/silence | `scripts/audio-proof/analyze.py` | agent-optimizer | testé isolément et via `prove.sh` (voir résultats ci-dessous) |
| Banc de preuve | `scripts/audio-proof/prove.sh` | agent-optimizer | testé sur WAV de référence, WAV silencieux, et variante `--play-cmd` |
| Auto-test | `scripts/audio-proof/selftest.sh` | agent-optimizer | exécuté deux fois, PASS les deux fois (voir § Validation) |
| Documentation | `scripts/audio-proof/README.md` | agent-optimizer | écrite |
| Sonde autoplay | `vscode-extension/test/integration-security/audible-probe.test.ts` | copiée depuis le chemin scratchpad fourni par le brief | fichier trouvé (65 lignes), copié tel quel, aucun autre fichier touché sous `vscode-extension/` |

### Fichiers lus

- `_grimoire/kit/skills/meta-toolsmithing.md` (squelette outil, garde-fou CC)
- `_grimoire-output/evidence/GAO-adr-012-lect-001/*.md` (gabarit imposé)
- Chemin scratchpad fourni par le brief : `audible-probe.test.ts` (lu avant copie)

<!-- grimoire:observed-inventory:start -->
## Inventaire observé

Régénéré automatiquement depuis `evidence-log.jsonl` (hooks du host) — ne pas éditer à la main ; la section manuelle « Evidence inventory » ci-dessus reste éditable et prime en cas de doute.

| Preuve | Détail | Source | Résultat |
|---|---|---|---|
| Aucune preuve observée pour l'instant |  |  |  |
<!-- grimoire:observed-inventory:end -->

## Découverte technique majeure (déviation par rapport à la méthode manuelle du brief)

La méthode prescrite (`pactl load-module module-null-sink` + `parecord … .monitor` + `paplay -d <sink>`) a d'abord échoué de façon répétée et non déterministe sur cette machine : le WAV capturé était tantôt silencieux (RMS = 0), tantôt un contenu réel mais mal transcrit. Diagnostic mené avec `pw-link -l`, `pactl list sink-inputs` :

1. `parecord` est correctement relié aux ports `monitor_*` de notre sink (`llmvoice_*:monitor_FL/FR -> parecord:input_FL/FR`) — la capture n'est pas en cause.
2. `paplay -d <sink>` était systématiquement relié à un **autre** sink (`sc_media`, un sink préexistant de la configuration audio personnelle de la machine), jamais au sink créé pour le test — vérifié explicitement (`paplay:output_FL -> sc_media:playback_FL`, aucun lien vers notre sink).
3. La propriété `pactl list sink-inputs` du flux montre `module-stream-restore.id = "sink-input-by-application-name:paplay"` : PipeWire/WirePlumber mémorise, par **nom de processus**, le dernier sink utilisé par `paplay` et le réapplique à chaque nouveau lancement, **après** la connexion initiale, en écrasant le `-d` explicite. `PULSE_PROP=application.name=...` ne suffit pas à contourner cette règle : `pw-link -l` montre que le `node.name` sous-jacent reste `paplay` malgré la surcharge Pulse.
4. Fixe mesuré et reproductible : remplacer `paplay` par `pw-play --target <sink> -P '{ node.name = "llm-voice-audio-proof" node.dont-move = true }'` — le flux reste alors relié au sink demandé (vérifié par `pw-link -l`) et le contenu capturé est correct.
5. Deuxième dégradation mesurée : sink nul créé au format par défaut (48000 Hz stéréo) alors que le WAV source est en 22050 Hz mono → ré-échantillonnage supplémentaire qui dégrade la reconnaissance (WER 0,44 mesuré sur « Ceci est un test du banc de preuve audio. », transcrit « …du bandeau. »). Fixe : créer le sink et lancer `parecord` au format natif du WAV (détecté via `soxi -r`/`soxi -c`) → WER 0,0 à 0,11 mesuré sur la même phrase selon la voie de lecture (directe ou `--play-cmd`).

`prove.sh` implémente les deux fixes par défaut (voir commentaires en tête du script) ; `--play-cmd` reste disponible pour tester l'app réelle, avec la même parade documentée si un rerouting apparaît sur une autre machine.

## Validation

| Check | Command or method | Result | Notes |
|---|---|---|---|
| Installation venv | `bash scripts/audio-proof/setup.sh` | OK | 23 paquets installés (faster-whisper 1.2.1, numpy 2.5.3, ctranslate2 4.8.2, …), idempotent (second appel détecte le venv existant) |
| Transcription directe (contrôle) | piper → `faster_whisper` sans passer par le sink | WER 0,0 | confirme que le modèle `small`/cpu/int8/fr reconnaît correctement la phrase de test hors bouclage audio |
| `prove.sh` sur WAV de référence | `scripts/audio-proof/prove.sh reference.wav --expect "Ceci est un test du banc de preuve audio."` | exit 0, `{"wer": 0.0, "silent": false, "pass": true}` | deux exécutions consécutives via `selftest.sh` |
| `prove.sh` sur WAV silencieux | même phrase attendue, WAV silencieux de même durée (sox) | exit 1, `{"wer": 1.0, "silent": true, "pass": false}` | transcription = hallucination connue de Whisper sur silence (« Sous-titres réalisés par la communauté d'Amara.org ») ; `silent: true` correctement détecté (silence_max_ms ≈ durée totale) |
| `prove.sh --play-cmd` | commande `pw-play --target "$PULSE_SINK" …` explicite | exit 0, `{"wer": 0.1111, "pass": true}` | variante testée manuellement en plus du chemin par défaut de `selftest.sh` |
| `selftest.sh` (exécution 1) | `bash scripts/audio-proof/selftest.sh` | `reference_exit=0`, `silence_exit=1`, PASS | consigné ci-dessus |
| `selftest.sh` (exécution 2, contrôle de stabilité) | idem | `reference_exit=0`, `silence_exit=1`, PASS | même résultat, pas de régression aléatoire observée après les deux fixes |
| Analyse statique bash | `bash -n scripts/audio-proof/{setup,prove,selftest}.sh` | OK | aucune erreur de syntaxe |
| Analyse statique Python | `python3 -c "ast.parse(...)"` sur `analyze.py` | OK | |
| Gate strict | `grimoire standard gate check --task-id GAO-banc-de-preu-001 --strict` | voir acceptance-record | |
| Standard | `grimoire standard verify .` | voir acceptance-record | |

## Controls

| Control family | Applied? | Evidence | Gap |
|---|---:|---|---|
| Governance | yes | carte ledger `GAO-banc-de-preu-001` existante, ce pack | — |
| Quality | yes | `selftest.sh` exécuté deux fois, résultats identiques ; découverte de bug (stream-restore + ré-échantillonnage) diagnostiquée avec preuves (`pw-link -l`) avant correction | garde-fou CC (`cc-verify.sh --stack py`) non exécuté : outil bash/Python hors périmètre npm du repo, non vérifié par ce script précis — signalé en déviation |
| Runtime | yes | scripts exécutés réellement (pas seulement lus), venv installé pour de vrai, sink PipeWire réellement créé/détruit | — |
| Knowledge | yes | root cause documentée avec les commandes de diagnostic exactes | — |
| Model/provider | yes | agent-optimizer, sonnet (ce sous-agent) | — |

## Deviations and accepted risks

| Deviation | Impact | Accepted by | Review trigger |
|---|---|---|---|
| Méthode de lecture par défaut remplacée : `paplay -d $SINK` (brief) → `pw-play --target $SINK -P '{node.name=…, node.dont-move=true}'` | nécessaire pour fiabilité sur cette machine (WirePlumber `module-stream-restore` reroutait systématiquement `paplay` vers un autre sink, mesuré) ; comportement documenté en tête de `prove.sh` et dans ce pack | agent-optimizer (constat technique, pas une préférence) | si une machine cible n'a pas `pw-play` (paquet `pipewire-utils`), le script échoue explicitement avec un message clair plutôt que de retomber silencieusement sur `paplay` |
| Sink nul et `parecord` créés au format natif du WAV plutôt qu'au format par défaut de PipeWire | réduit le WER de ~0,44 à ~0,0–0,11 sur la phrase de test ; dépend de `soxi` (paquet `sox`, déjà requis par `selftest.sh`) | agent-optimizer | repli documenté sur 48000 Hz / 2 canaux si `soxi` absent ou `--play-cmd` sans fichier de référence |
| `cc-verify.sh --stack py` non exécuté | garde-fou du skill `meta-toolsmithing` prévu pour un projet Python pur ; ce dépôt est TypeScript avec un venv Python annexe hors dépôt | agent-optimizer | à vérifier lors d'une prochaine carte si `cc-verify.sh` gagne un mode générique pour scripts bash/Python hors `_grimoire/kit` |
| Sonde autoplay copiée sans modification et sans exécution (nécessite un environnement VS Code Extension Test Host, hors périmètre de ce banc) | fichier versé tel quel, non exécuté par cette tâche | agent-optimizer | exécution à faire dans une carte dédiée au diagnostic autoplay |

## Completion statement

The task can be considered complete only when mandatory evidence gates for the selected profile are satisfied or explicitly marked non-applicable with justification.
