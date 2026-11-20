# Banc de preuve audio (GAO-banc-de-preu-001)

Banc que les agents lancent seuls, sans oreille humaine, pour vérifier qu'un
son a réellement été joué sur les haut-parleurs (Fedora/Wayland/PipeWire).

Méthode : sink PulseAudio/PipeWire nul (`module-null-sink`), capture de son
moniteur avec `parecord` (pas `pw-record --target`, qui rend un fichier quasi
silencieux — prouvé le 2026-09-27), lecture avec `paplay` (ou une commande
custom), transcription `faster-whisper` (`small`, cpu, int8, fr), WER
normalisé + plus long silence interne, nettoyage systématique du sink.

## Installation

```bash
scripts/audio-proof/setup.sh
```

Crée un venv Python 3.12 sous `~/.llm-voice/tools/audio-proof-venv` (hors
dépôt, idempotent) et y installe `faster-whisper` + `numpy`. Le Python système
peut être en 3.14, incompatible avec ces dépendances au moment de l'écriture.

## Usage

```bash
scripts/audio-proof/prove.sh capture-attendue.wav --expect "phrase attendue"
```

Variante avec une commande de lecture custom (par ex. l'app elle-même) :

```bash
scripts/audio-proof/prove.sh reference.wav --expect "phrase" \
  --play-cmd 'mon-app --play "$LLM_VOICE_AUDIO_PROOF_WAV"'
```

`--play-cmd` s'exécute avec `PULSE_SINK` exporté vers le sink de test : la
commande DOIT jouer sur ce sink pour que la capture voie quelque chose.

Sortie JSON sur stdout : `wer`, `transcription`, `duration_s`,
`silence_max_ms`, `rms`, `silent`, `wer_ok`, `pass`. Code de sortie 0 si
`wer <= seuil` (0.25 par défaut, `--threshold`) et signal non silencieux, non
nul sinon. Le sink de test est toujours détruit (trap), même en cas d'échec.

Analyse seule (déjà un WAV capturé) : `scripts/audio-proof/analyze.py --audio
capture.wav --expect "phrase"`.

## Auto-test

```bash
scripts/audio-proof/selftest.sh
```

Génère un WAV de référence avec `piper` (voix `fr_FR-siwis-medium`) et un WAV
silencieux de même durée avec `sox`, lance `prove.sh` sur les deux, imprime
les deux codes de sortie obtenus.

## Seuil WER

0.25 par défaut : tolère une variation de ponctuation/liaison par groupe de
quatre mots après normalisation (minuscules, sans accents, sans ponctuation).
À resserrer si ce banc devient un gate strict de non-régression.
