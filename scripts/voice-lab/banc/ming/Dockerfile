# Image dérivée locale pour l'unique tentative Ming-3.0-tts-tiny (GAO-essais-d-cou-001) : torch ROCm de deploy-chatterbox
# conservé ; fla-core installé sans dépendances pour garder le triton ROCm de l'image. Code Ming monté en lecture seule.
FROM deploy-chatterbox:latest
RUN pip install --no-cache-dir "x-transformers==2.7.4" "einx==0.4.3" "loguru==0.7.3" "onnxruntime==1.23.2" "inflect==7.5.0" "accelerate==1.14.0" \
    && pip install --no-cache-dir --no-deps "fla-core==0.4.2" \
    && python -c "import torch, triton, fla; print(torch.__version__, triton.__version__, 'fla ok')"
