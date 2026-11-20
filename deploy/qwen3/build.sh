#!/usr/bin/env bash
# Construit les trois images Qwen3 en local (ne pousse rien).
#   deploy/qwen3/build.sh [rocm|cuda|models|all]   (défaut : all)
# models attend le contexte de prepare-models-context.sh (QWEN3_MODELS_CONTEXT).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
VERSION=${QWEN3_VERSION:-0.1.0}
REPO=${QWEN3_REGISTRY:-ghcr.io/guilhem-bonnet}
CTX=${QWEN3_MODELS_CONTEXT:-$HOME/.llm-voice/build/qwen3-models-$VERSION}
what=${1:-all}
if [[ $what == rocm || $what == all ]]; then
  docker build --build-arg VERSION="$VERSION" -f "$HERE/Dockerfile.rocm" -t "$REPO/llm-voice-qwen3:$VERSION-rocm" "$HERE"
fi
if [[ $what == cuda || $what == all ]]; then
  docker build --build-arg VERSION="$VERSION" -f "$HERE/Dockerfile.cuda" -t "$REPO/llm-voice-qwen3:$VERSION-cuda" "$HERE"
fi
if [[ $what == models || $what == all ]]; then
  [ -f "$CTX/Dockerfile.models" ] || { echo "contexte absent : $HERE/prepare-models-context.sh" >&2; exit 1; }
  docker build --build-arg VERSION="$VERSION" -f "$CTX/Dockerfile.models" -t "$REPO/llm-voice-qwen3-models:$VERSION" "$CTX"
fi
