# Evidence pack — GAO-essais-d-cou-001 (en cours)

## État au point d'étape 1 (2026-11-20)
- Carte : ready → claimed → running (commandes `grimoire task move/claim` exécutées, sortie OK).
- Banc commun écrit : `scripts/voice-lab/banc/banc.json` (12 textes : narration 381 car., 3 naturels, 6 états, 2 difficiles complétés car absents du dépôt).
- Scripts : `common.py`, `gen_qwen3_ref.py` (référence HTTP :8021, voix figée + jouée), `gen_qwen3_custom.py` + `go_qwen3_custom.sh` (conteneur `--network none`, lecture seule), `analyze_banc.py` (faster-whisper small CPU : WER, p(fr)/p(en), mots de balise, pauses).
- Génération de référence lancée (processus hôte, sortie `~/.llm-voice/voices-lab/banc/out/qwen3-{fige,joue}/`, journal `~/.llm-voice/voices-lab/banc/ref.log`). Mode jeu vérifié libre avant lancement.
- Mesure partielle : voix figée, narration : 72,9 s de génération pour 22,6 s d'audio (inclut probablement une partie du chargement paresseux du service, non isolé).
- Non encore fait : CustomVoice, Ming tiny, Fish S2, Higgs (étude), voix candidates, page d'écoute, empreinte vocale.

## Point d'étape 2
- Référence Qwen3 terminée : 24 extraits (`out/qwen3-fige`, `out/qwen3-joue`), analysés dans `analysis.json` (faster-whisper small, CPU).
  - Voix figée : WER 0 à 0,095, p(en) max 0,0047, aucun mot de balise ; RTF environ 2,2 (ex. 13,3 s pour 6,0 s).
  - Voix jouée : WER 0 à 0,294 ; p(en) 0,274 (essoufflé) et 0,238 (rire), sinon <= 0,011 ; aucun mot de balise. Sur ces clips riches en bruits non vocaux, Whisper détecte la langue moins sûrement : à vérifier à l'oreille, on ne peut pas en conclure un accent.
- 12 voix candidates créées par `POST /voices/create` (journal `~/.llm-voice/voices-lab/banc/out/voix-created.json`), entre 12,9 et 17,5 s chacune. Lecture des 2 textes de test en cours, chaîne analyse → empreinte (CPU) → filtre lancée (`~/.llm-voice/voices-lab/banc/chain.sh`, journal `chain.log`).
- Incident : un script d'attente bouclait sans fin, parce que `pgrep -f` reconnaissait la commande du script lui-même. Je l'ai tué puis remplacé par une attente sur le PID.

## Point d'étape 3 : la page existe
- Voix : 12 créées, 8 gardées, 4 rejetées (`voix-filter.json`). Seuil de similarité : cosinus centré 0,66, calibré sur le maximum entre voix du catalogue (Homme âgé rauque contre Homme mûr grave : 0,658). Le cosinus brut est inutilisable pour ce tri : il va de 0,915 à 0,988 entre voix du catalogue, Homme mûr grave contre Jeune femme claire donne 0,924, et toutes les candidates sont à 0,977 ou plus d'au moins une voix existante.
- Rejetées, déplacées par `mv` dans `~/.llm-voice/voices-lab/qwen3/created-archive/` : v-309a5a52e4 Conteur grave, v-20dd585675 Adolescente bavarde, v-92f61f6fab Voix radio posée, v-7f14780560 Homme mûr chaleureux. Service redémarré (`docker compose ... restart qwen3`) : `GET /voices` renvoie 18 voix.
- Empreinte vocale (`embeddings.json`, encodeur Base sur CPU) : stabilité de la voix figée 0,99 (min 0,985), voix jouée 0,969 (min 0,935).
- Page : `~/Téléchargements/ecoute-banc-moteurs.html` (4,76 Mo, 48 extraits). `page-check.json` : 48 extraits décodés par ffmpeg sans erreur, durée MP3 à ±0,3 s du WAV, all_ok=true.
- Image dérivée Fish construite (`llm-voice-lab-fish:local`, torch 2.9.1+rocm7.2.3, transformers 5.19.0), pas encore exécutée.
