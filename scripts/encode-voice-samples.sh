#!/usr/bin/env bash
# Compresse en Ogg Opus les échantillons WAV générés par Kyutai Pocket TTS,
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
  ffmpeg -nostdin -loglevel error -y -i "$source_dir/$id.wav" -ac 1 -c:a libopus -b:a 32k -map_metadata -1 "$target/$id.ogg"
done
du -ch "$target"/*.ogg | tail -1
