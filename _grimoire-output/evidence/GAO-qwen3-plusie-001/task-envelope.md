# GAO-qwen3-plusie-001 — Qwen3 : plusieurs voix, jeu de départ
- Portée : deploy/qwen3/server.py, test_server.py, create_starter_voices.py, deploy/docker-compose.tts.yml (montage rw du seul dossier created). Hors portée : vscode-extension/.
- Critère : `python3 -P deploy/qwen3/test_server.py` vert ; 8 voix créées en réel, persistance après redémarrage, 2 lectures figées + 1 jouée transcrites (WER), empreintes vocales.
- Interdits respectés : aucun son joué, aucun téléchargement, pas de push, kyutai16 non arrêté, mode jeu vérifié avant chaque charge GPU.
