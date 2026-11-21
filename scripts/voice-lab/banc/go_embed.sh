#!/bin/sh
# Empreintes vocales sur CPU (aucun /dev/kfd ni /dev/dri), conteneur sans réseau, lecture seule sauf embeddings.json.
L=$HOME/.llm-voice/voices-lab; B=$(cd "$(dirname "$0")" && pwd)
exec docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges:true -u 1000:1000 \
 -v $L/qwen3/hf:/lab/hf:ro -v $L/qwen3/extras:/lab/extras:ro -v $B:/lab/banc:ro -v $L/banc/out:/lab/out \
 -v $L/qwen3/created:/lab/created:ro \
 -e HOME=/tmp -e HF_HOME=/lab/hf -e PYTHONPATH=/lab/extras -e PYTHONDONTWRITEBYTECODE=1 -e HF_HUB_OFFLINE=1 -e TRANSFORMERS_OFFLINE=1 -e CUDA_VISIBLE_DEVICES= -e HIP_VISIBLE_DEVICES= \
 --entrypoint python deploy-chatterbox:latest /lab/banc/embed_banc.py
