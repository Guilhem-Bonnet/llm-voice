# Pack de preuve — GAO-qwen3-plusie-001
- Commit : 4117b49 (serveur, tests, compose, script de départ).
- Unitaires : `python3 -P deploy/qwen3/test_server.py` → Ran 96 tests, OK (moteur factice ; 16 nouveaux tests classe Creation + 1 RealAdapter).
- Montages réels : mounts.txt (/lab/refs/created rw=true, le reste rw=false).
- Création réelle : starter-voices.json (8 voix, 201, 2 min 44 s au total, 13 à 33 s par voix).
- Persistance : voices-after-restart.json après `up --force-recreate` : 9 voix dont 8 origin=created.
- /sample : 200 (sample-v-b0d22ecbc1.wav) ; chemin encodé → 404.
- Lectures : tts-timings.txt, fige-*.wav, joue-femme-agee.wav ; transcription-wer.json.
- Empreintes : speaker-similarities.json (encodeur Base sur CPU, script speaker_embeddings.py).
- VRAM : vram.txt (mem_info_vram_used, tous processus).
## Résumé mesuré
whisper small
fige-homme-mur-grave.wav WER 0.0 | Le train s'est arrêté au milieu de la campagne, sans la moindre annonce.
fige-jeune-femme-claire.wav WER 0.0 | Le train s'est arrêté au milieu de la campagne sans la moindre annonce.
joue-femme-agee.wav WER 0.0 | Le train s'est arrêté au milieu de la campagne sans la moindre annonce.
cos entre les 8 voix : min 0.9150000214576721 max 0.9900000095367432 moyenne 0.958
paire la plus proche (0.9900000095367432, "Voix d'enfant", 'Jeune femme claire')
lecture:fige-homme-mur-grave -> plus proche (0.9909999966621399, 'Homme mûr grave')
lecture:fige-jeune-femme-claire -> plus proche (0.9919999837875366, 'Jeune femme claire')
lecture:joue-femme-agee -> plus proche (0.9789999723434448, 'Femme âgée chaleureuse')
