# Claim Ledger — GAO-s1-fedora-va-001

| # | Affirmation | Preuve | Vérifié |
|---|---|---|---|
| 1 | `cargo build --release -p llm-voice-core` compile sans erreur | sortie `cargo build` : `Finished release profile` | oui |
| 2 | Aucun vrai périphérique n'a été reconfiguré | `pactl get-default-sink` identique avant/après (`alsa_output.usb-Razer_Inc_BlackShark_V3_Pro...pro-output-0`) | oui |
| 3 | Cas 1 (sortie par défaut sans PIPEWIRE_NODE) échoue : capture silencieuse malgré `ended` reçu | `wayland-validation/case1.json` : `rms=0.0`, `silent=true`, `ended` confirmé dans `run.log` | oui |
| 4 | Le même scénario réussit si `PIPEWIRE_PROPS`/`node.dont-move` est forcé | test manuel isolé (`/tmp/quick_case1_fix_test.sh`, non versionné) : `rms=0.093903`, `wer=0.098`, transcription conforme au texte de référence | oui (reproduit une fois, non re-testé en répétition) |
| 5 | Cas 3 : le Core survit à la disparition du sink pendant la lecture et `/health` répond ensuite | `wayland-validation/case3.json` : `core_alive=1`, `health_final` non vide, `ended=1` | oui |
| 6 | Cas 4 : le Core survit à `suspend-sink 1` puis `0` pendant la lecture | `wayland-validation/case4.json` : `ended` reçu, Core vivant confirmé dans `run.log` | oui |
| 7 | Cas 2 : aucun crash ni `error` WS pendant la bascule à chaud | `run.log` : `err_ws=0`, `ended=1`, Core vivant | oui |
| 8 | Le trajet audio exact du Cas 2 (suit/reste/coupe) n'est pas déterminable en l'état | capture A et B toutes deux `silent=true` dans `wayland-validation/case2.json`, corrélé à F-1 | oui (conclusion négative assumée, pas devinée) |
| 9 | Cas 5 (casque USB réel) et veille système non automatisés | choix explicite documenté dans `run.log` et `evidence-pack.md` | oui (déclaratif, pas un test) |
| 10 | Sinks nuls créés (`llmvoice_va_{a,b,c,d}_<pid>`) tous déchargés en fin d'exécution | `run.log` : ligne `cleanup : ... déchargement des sinks nuls` + `pactl list short sinks` post-run ne montre plus ces noms (vérifié interactivement, non journalisé en fichier) | oui |
