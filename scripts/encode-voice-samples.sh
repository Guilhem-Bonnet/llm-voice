#!/usr/bin/env bash
# Compresse en Ogg Vorbis les échantillons WAV générés par Kyutai Pocket TTS,
# (pas Opus : le webview de VS Code 1.145 ne le décode pas, carte 0-005)
# vers vscode-extension/media/voices/. Seuls les noms du catalogue sont copiés.
# Usage : scripts/encode-voice-samples.sh <dossier des WAV>
set -euo pipefail

source_dir="${1:?Usage: encode-voice-samples.sh <dossier des WAV>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
catalog="$root/vscode-extension/src/tts/kyutaiVoiceCatalog.ts"
target="$root/vscode-extension/media/voices"
mkdir -p "$target"

ids="$(grep -oE '^  (vctk|voiceZero|voice)\("[a-z_]+"' "$catalog" | grep -oE '"[a-z_]+"' | tr -d '"')"
for id in $ids; do
  ffmpeg -nostdin -loglevel error -y -i "$source_dir/$id.wav" -ac 1 -c:a libvorbis -q:a 2 -map_metadata -1 "$target/$id.ogg"
done
du -ch "$target"/*.ogg | tail -1
