# Niveau 1b (ADR-009) : Piper CPU derrière un wrapper OpenAI-compatible
# maison (openedai-speech est archivé, cf. linux-first-v1.md §3). Image
# légère, aucun modèle embarqué (téléchargé au premier lancement, voir
# entrypoint.sh) — CPU seul, pas de GPU nécessaire.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir piper-tts

WORKDIR /app
COPY server.py entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh

EXPOSE 5000
ENTRYPOINT ["/app/entrypoint.sh"]
