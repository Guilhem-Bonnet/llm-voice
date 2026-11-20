# Task envelope — GAO-essais-d-cou-001

- Titre : Essais d'écoute — meilleur moteur et meilleures voix pour LLM Voice
- Agent : backend-engineer (Stack), skills platform-deploy-release / platform-reliability-sre
- Périmètre écrit : `scripts/voice-lab/banc/` (scripts, textes), `_grimoire-output/evidence/GAO-essais-d-cou-001/` (mesures JSON, preuves). Audio et poids hors dépôt (`~/.llm-voice/voices-lab/banc/`).
- Hors périmètre : `vscode-extension/`, `deploy/qwen3/server.py`, tout `git push`.
- Contraintes : aucun son sur les enceintes ; mode jeu vérifié avant chaque charge GPU ; code téléchargé exécuté seulement en conteneur `--network none`, montages en lecture seule ; service `deploy-qwen3-1` redémarré après tout arrêt ; voix rejetées déplacées (`mv`) dans `created-archive/`, jamais supprimées.
- Critères d'acceptation : banc commun identique pour tous les moteurs ; mesures (WER, p(fr)/p(en), balises prononcées, durée, RTF, VRAM de pointe, stabilité de voix) en JSON ; page d'écoute vérifiée par ffprobe et copiée dans `~/Téléchargements/ecoute-banc-moteurs.html` ; écoute de l'utilisateur (critère humain : la carte ne passe pas en needs_verification sans elle).
