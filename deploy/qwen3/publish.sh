#!/usr/bin/env bash
# Pousse les trois images Qwen3 vers ghcr.io. Sans --push : affiche seulement ce qui serait fait.
#   deploy/qwen3/publish.sh            # à blanc
#   deploy/qwen3/publish.sh --push     # pousse réellement
# Prérequis (au choix, voir deploy/README.md) :
#   1. la GitHub App du bot reçoit la permission « packages: write » ;
#   2. ou l'utilisateur se connecte lui-même : docker login ghcr.io -u <compte> (jeton write:packages).
set -euo pipefail
VERSION=${QWEN3_VERSION:-0.1.0}
REPO=${QWEN3_REGISTRY:-ghcr.io/guilhem-bonnet}
IMAGES=("$REPO/llm-voice-qwen3:$VERSION-rocm" "$REPO/llm-voice-qwen3:$VERSION-cuda" "$REPO/llm-voice-qwen3-models:$VERSION")
for img in "${IMAGES[@]}"; do
  docker image inspect "$img" >/dev/null || { echo "image absente : $img (deploy/qwen3/build.sh)" >&2; exit 1; }
done
for img in "${IMAGES[@]}"; do
  if [[ ${1:-} == --push ]]; then docker push "$img"; else echo "à blanc : docker push $img"; fi
done
