#!/bin/sh
# Copie, une seule fois par version, les modèles et les voix de l'image de données
# llm-voice-qwen3-models vers les volumes nommés du service qwen3.
#   /vol/hf      cache Hugging Face (lecture seule pour le serveur)
#   /vol/refs    catalogue voices.json et extraits de référence (lecture seule)
#   /vol/created voix créées (écriture) : jamais écrasées, seules les voix absentes sont ajoutées
set -eu
VERSION=$(cat /data/VERSION)
MARK=".llm-voice-qwen3-$VERSION"

if [ -e "/vol/hf/$MARK" ]; then
    echo "modèles $VERSION : déjà copiés"
else
    echo "modèles $VERSION : copie..."
    cp -a /data/hf/. /vol/hf/
    # Les blobs LFS du cache portent leur empreinte SHA-256 pour nom : on la vérifie.
    for blob in /vol/hf/hub/models--*/blobs/*; do
        name=$(basename "$blob")
        case "$name" in
            ????????????????????????????????????????????????????????????????)
                sum=$(sha256sum "$blob" | cut -d' ' -f1)
                [ "$sum" = "$name" ] || { echo "empreinte fausse : $blob" >&2; exit 1; } ;;
        esac
    done
    : > "/vol/hf/$MARK"
    echo "modèles $VERSION : copiés et vérifiés"
fi

if [ -e "/vol/refs/$MARK" ]; then
    echo "catalogue $VERSION : déjà copié"
else
    cp -a /data/refs/. /vol/refs/
    mkdir -p /vol/refs/created
    : > "/vol/refs/$MARK"
    echo "catalogue $VERSION : copié"
fi

for voice in /data/created/*; do
    [ -d "$voice" ] || continue
    id=$(basename "$voice")
    if [ ! -e "/vol/created/$id" ]; then
        cp -a "$voice" "/vol/created/$id"
        echo "voix créée ajoutée : $id"
    fi
done
echo "prêt"
