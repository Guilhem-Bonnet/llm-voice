#!/usr/bin/env bash
# Prépare les poids du service de conversion (deploy/vc/server.py) depuis le cache Hugging Face
# de Chatterbox, déjà sur disque : aucun téléchargement.
#
#   bash deploy/vc/prepare-weights.sh
#
# `ChatterboxVC.from_local` lit `s3gen.safetensors` et `conds.pt` ; le cache n'a que `s3gen.pt`.
# La conversion se fait dans l'image `deploy-chatterbox` (torch, safetensors), sans réseau, non-root.
# Le dossier de sortie est hors du dépôt : ~/.llm-voice/models/chatterbox-vc (VC_WEIGHTS_OUT).
set -euo pipefail

CACHE="${CHATTERBOX_HF_CACHE:-$HOME/.llm-voice/models/chatterbox/hf_cache}"
OUT="${VC_WEIGHTS_OUT:-$HOME/.llm-voice/models/chatterbox-vc}"
IMAGE="${VC_IMAGE:-deploy-chatterbox:latest}"

snapshot=""
for dir in "$CACHE"/hub/models--ResembleAI--chatterbox/snapshots/*/; do
    [[ -e "$dir/s3gen.pt" ]] && snapshot="$dir"
done
if [[ -z "$snapshot" ]]; then
    echo "s3gen.pt introuvable sous $CACHE (lancer d'abord le service chatterbox une fois)." >&2
    exit 1
fi
# Les fichiers du cache sont des liens vers blobs/ : on monte les fichiers réels.
s3gen="$(readlink -f "$snapshot/s3gen.pt")"
conds="$(readlink -f "$snapshot/conds.pt")"
ve="$(readlink -f "$snapshot/ve.pt")"

if [[ -s "$OUT/s3gen.safetensors" && -s "$OUT/conds.pt" ]]; then
    echo "Déjà prêt : $OUT"
    exit 0
fi

mkdir -p "$OUT"
staging="$(mktemp -d "$OUT/.staging-XXXXXX")"
docker run --rm --network none --user "$(id -u):$(id -g)" --cap-drop ALL \
    --security-opt no-new-privileges:true \
    -v "$s3gen:/in/s3gen.pt:ro" -v "$staging:/out" \
    --entrypoint python "$IMAGE" -c '
import torch
from safetensors.torch import save_file
state = torch.load("/in/s3gen.pt", map_location="cpu", weights_only=True)
save_file({k: v.contiguous() for k, v in state.items()}, "/out/s3gen.safetensors")
print("tenseurs", len(state))
'
cp "$conds" "$staging/conds.pt"
cp "$ve" "$staging/ve.pt"
mv "$staging/s3gen.safetensors" "$staging/conds.pt" "$staging/ve.pt" "$OUT/"
rmdir "$staging"
echo "Prêt : $OUT"
