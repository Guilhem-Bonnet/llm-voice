#!/bin/sh
# Fish S2 Pro : image dérivée locale llm-voice-lab-fish:local, sans réseau, code/poids en lecture seule.
L=$HOME/.llm-voice/voices-lab; B=$(cd "$(dirname "$0")/.." && pwd)
[ -e "$XDG_RUNTIME_DIR/gpu-yield/active" ] && { echo "mode jeu actif : arrêt"; exit 75; }
exec docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges:true \
 --device /dev/kfd --device /dev/dri --group-add 39 --group-add 105 -u 1000:1000 \
 -v $L/fish-s2/weights:/lab/weights:ro -v $L/fish-s2/code:/lab/code:ro -v $B:/lab/banc:ro -v $L/banc/out:/lab/out \
 -v $XDG_RUNTIME_DIR/gpu-yield:/run/user/1000/gpu-yield:ro \
 -e XDG_RUNTIME_DIR=/run/user/1000 -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 -e HF_HUB_OFFLINE=1 -e TRANSFORMERS_OFFLINE=1 -e MODELSCOPE_OFFLINE=1 \
 -e ROCBLAS_USE_HIPBLASLT=0 -e TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL=1 -e MIOPEN_FIND_MODE=FAST -e HALF -e MAX_SEQ -e USER=lab -e LOGNAME=lab \
 --entrypoint python llm-voice-lab-fish:local /lab/banc/fish/gen_fish.py
