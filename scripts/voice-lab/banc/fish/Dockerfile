# Image dérivée locale pour l'essai Fish S2 Pro (GAO-essais-d-cou-001). Même torch que le Dockerfile.rocm officiel
# (2.9.1+rocm7.2.3, déjà dans deploy-chatterbox) ; on ajoute seulement les dépendances pip publiques listées par ce
# Dockerfile, sans copier le code Fish (monté en lecture seule à l'exécution) et sans pyaudio (micro inutile ici).
FROM deploy-chatterbox:latest
RUN pip install --no-cache-dir \
        "transformers==5.19.0" "tokenizers==0.23.2" hydra-core natsort einops librosa kui loguru pyrootutils resampy \
        "einx[torch]==0.2.2" pydub "modelscope==1.17.1" "opencc-python-reimplemented==0.1.7" silero-vad ormsgpack \
        "tiktoken>=0.8.0" "pydantic==2.9.2" cachetools descript-audio-codec safetensors soundfile vector_quantize_pytorch \
    && pip install --no-cache-dir --no-deps --upgrade "protobuf>=4.25,<6.0" \
    && python -c "import torch, transformers; print(torch.__version__, transformers.__version__)"
