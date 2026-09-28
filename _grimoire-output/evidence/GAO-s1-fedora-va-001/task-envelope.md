# Agentic Task Envelope

## Task
- Task id: GAO-s1-fedora-va-001
- Request: Valider sous Fedora/Wayland/PipeWire le comportement du Core natif `llm-voice-core` face aux changements de périphérique audio (sortie par défaut sans forçage, bascule à chaud, disparition de sink, suspension/reprise) ; casque USB réel et veille système exclus de l'automatisation (revue humaine). Aucune modification des vrais périphériques de l'utilisateur : sinks nuls créés/déchargés par le script, sink par défaut original toujours restauré (trap).
- Owner agent: systems-debugger (Probe) — dispatch non-interactif
- Current state: `running` (état de la carte non modifié par cet agent ; aucun commit)
- Risk level: medium (le Core lui-même peut router transitoirement l'audio vers le périphérique réel courant si le bug du cas 1 se manifeste — comportement du logiciel testé, pas une action de l'agent ; sink par défaut restauré dans tous les cas)

## Contexte lu
- `scripts/audio-spike/core-play.sh` — protocole HTTP/WS du Core, contournement WirePlumber connu (node.dont-move, node.name dédié)
- `scripts/audio-proof/prove.sh`, `scripts/audio-proof/analyze.py` — banc WER/silence via faster-whisper (venv `~/.llm-voice/tools/audio-proof-venv`)
- `_grimoire-output/evidence/GAO-core-rust-mi-001/evidence-pack.md` point 6 — WirePlumber reroute déjà documenté comme limite connue
- `crates/llm-voice-core/src/server.rs` — routes `/health`, `/v1/{enqueue,play,pause,resume,stop,seek,ws}`
- `crates/llm-voice-audio/src/player.rs:140-143` — `cpal::default_host().default_output_device()`, sans ciblage explicite

## Tool boundary
| Tool | Permission | Scope |
|---|---|---|
| Read | read | crates/**, scripts/**, evidence |
| Bash | execute | cargo build --release, pactl/pw/parecord sur sinks nuls uniquement, curl loopback ; jamais sur les vrais sinks (Razer, HDMI, sc_*) |

## Cas testés
1. Sortie par défaut, sans PIPEWIRE_NODE forcé
2. Bascule à chaud du sink par défaut pendant une lecture longue (5 phrases, 12.58 s)
3. Disparition du sink pendant la lecture
4. Suspension/reprise du sink pendant la lecture
5. Casque USB réel — NON automatisé (revue humaine)
6. Veille système — NON automatisable (revue humaine)

## Evidence gates
| Gate | Preuve | Statut |
|---|---|---|
| Script de preuve exécutable | `scripts/audio-proof/wayland-validation.sh` | fait |
| Exécution réelle contre le binaire release | sortie horodatée, JSON par cas | voir evidence-pack |
| Chaque échec documenté fichier:ligne + correctif proposé, sans corriger | evidence-pack §Défauts | fait |
