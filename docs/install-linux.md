# Installer LLM Voice sous Linux

Référence : `_grimoire-output/planning-artifacts/linux-first-v1.md`,
`local-guarantee-v1.md`, ADR-009, ADR-010.

## 0. Voix par défaut — rien à installer (S7.1/S8.3)

**Après avoir installé le `.vsix`, aucune des étapes ci-dessous n'est
requise pour obtenir une voix française correcte.** Le premier `LLM Voice:
Speak Document` utilise la voix système ; s'il n'y en a pas encore
d'installée, une seule notification propose « Installer la voix française »
(~60 Mo, une fois, `SystemTtsProvider`/`PiperSetup`) — pas de Docker, pas de
serveur, pas de terminal. Les sections 3 et 4 ci-dessous décrivent des
déploiements **Docker** optionnels, réservés à qui veut le niveau « Qualité
maximale » (clonage de voix) ou héberger un service partagé en équipe —
jamais nécessaires pour un usage individuel de l'extension.

## 1. VS Code

| Mode | Réseau/audio | Binaires système (`spd-say`...) |
|---|---|---|
| RPM (Fedora)/deb (Ubuntu), Microsoft officiel | Direct, sans sandbox | Directs |
| Flatpak (`com.visualstudio.code`) | `--socket=pulseaudio` + `--share=network` déjà dans le manifeste, `<audio>` marche out-of-the-box | **Cassés par défaut** — préfixer par `flatpak-spawn --host` (ou `host-spawn` bundlé) ; l'extension détecte `FLATPAK_ID` et le fait automatiquement pour `SystemTtsProvider` |
| Snap (`--classic`) | Quasi-natif | Comportement des extensions tierces non vérifié en pratique |

Fedora : `sudo dnf install code` (repo Microsoft) ou `flatpak install
flathub com.visualstudio.code`. Ubuntu : `.deb` officiel ou `snap install
code --classic`.

En Flatpak, préférer `127.0.0.1` explicite à `localhost` dans les settings
réseau (résolution DNS parfois différente en sandbox).

## 2. Ollama natif (narrateur)

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull <modèle>   # seul appel réseau volontaire, une fois par modèle
```

Bind par défaut sur `127.0.0.1:11434` — ne jamais positionner
`OLLAMA_HOST=0.0.0.0` sans pare-feu. Vérifier :
`ss -tlnp | grep 11434` doit montrer `127.0.0.1`, pas `0.0.0.0`/`*`.

Sur Linux (CLI, pas d'app desktop), pas d'auto-update silencieux — contexte
préférable au client desktop macOS/Windows dont l'auto-update n'est pas
désactivable à ce jour (local-guarantee-v1.md §4).

## 3. Chatterbox (optionnel — niveau « Qualité maximale », GPU ROCm, Docker)

Voir `deploy/README.md` pour le détail complet (prérequis ROCm/RDNA4,
`.env`, premier lancement, mode hors-ligne, repli CPU) :

```bash
docker compose -f deploy/docker-compose.tts.yml --env-file deploy/.env up chatterbox
```

Machine de référence : AMD RDNA4 (gfx1201), ROCm 7.2+, **pas** de
`HSA_OVERRIDE_GFX_VERSION` (natif, le forcer peut planter). Sans GPU/ROCm
fonctionnel : `CHATTERBOX_DEVICE=cpu` (latence bien plus élevée, mais prouve
la chaîne).

## 4. Piper en serveur partagé (optionnel — équipe/entreprise, Docker)

Le `SystemTtsProvider` de l'extension (§0 ci-dessus) installe et exécute
Piper **sans Docker, sans serveur** pour un usage individuel — cette section
ne concerne que qui veut exposer Piper comme service partagé (ex. DSI,
`llmVoice.tts.baseUrl` pointé sur un hôte de confiance) :

```bash
docker compose -f deploy/docker-compose.tts.yml --profile light up piper
```

CPU pur, voix `fr_FR-siwis-medium`, `127.0.0.1:5000`, wrapper actif (voir
`deploy/piper/`) — `openedai-speech` est archivé, ne pas s'y intégrer.

## 5. Vérifier le mode « tout local »

Recette pare-feu (`local-guarantee-v1.md` §3b) : bloquer toute sortie
réseau du process VS Code sauf loopback pendant un scénario complet, avec
`nftables` ou `firewalld` :

```bash
sudo nft add table inet llmvoice_test
sudo nft add chain inet llmvoice_test out { type filter hook output priority 0 \; policy accept \; }
sudo nft add rule inet llmvoice_test out meta skuid $(id -u) oif lo accept
sudo nft add rule inet llmvoice_test out meta skuid $(id -u) drop
# ... dérouler narrator → TTS → lecture dans VS Code, puis :
sudo nft delete table inet llmvoice_test
```

Si le scénario complet fonctionne sous ce pare-feu, c'est la preuve la plus
forte de « rien ne sort » — voir `local-guarantee-v1.md` pour l'alternative
`firewalld` et l'observation `strace`/`ss` complémentaire.

## 6. Voix de référence pour le clonage (CdC §55)

Les 28 voix prédéfinies de Chatterbox-TTS-Server sont des échantillons
anglophones : sur du texte français, l'accent reste perceptible même avec
`language: "fr"` (constaté S4.3, `docs/e2e/report-2026-09-08.md`). Pour une
voix française, utiliser le clonage (`voice_mode: "clone"`) avec un
échantillon propre, 12-15 s, sans musique ni long silence. Référence par
défaut livrée (`fr-female-siwis.wav`, CC BY 4.0, `docs/voices.md`) —
remplacer par sa propre voix reste recommandé :

```bash
# Sa propre voix (recommandé, consentement CdC §55 : n'utiliser que sa
# propre voix ou une voix avec accord). 15s puis Ctrl-C (ALSA : arecord -f
# S16_LE -r 24000 -c 1 -d 15 ~/.llm-voice/voices/ma-voix.wav) :
pw-record --rate 24000 --channels 1 ~/.llm-voice/voices/ma-voix.wav

# Copier la référence dans le conteneur puis appeler /tts en mode clone :
docker cp ~/.llm-voice/voices/ma-voix.wav deploy-chatterbox-1:/app/reference_audio/
curl -s -X POST http://127.0.0.1:8004/tts -H 'content-type: application/json' -d '{
  "text": "Texte à synthétiser.", "voice_mode": "clone",
  "reference_audio_filename": "ma-voix.wav", "language": "fr",
  "exaggeration": 0.4, "cfg_weight": 0.5, "temperature": 0.6
}' -o sortie.wav
```

Les fichiers de référence restent locaux — CdC §55, jamais de voix tierce sans accord.

## 7. Dépannage

- **ROCm ne détecte pas le GPU** : vérifier `/dev/kfd` et `/dev/dri`
  présents (`ls -la /dev/kfd /dev/dri`), pilote noyau `amdgpu` chargé
  (`lsmod | grep amdgpu`), GID `video`/`render` dans `deploy/.env` corrects
  (`getent group video render`). Le conteneur tourne en root : un souci de
  permission GID bloque rarement, un device absent bloque toujours.
- **VRAM insuffisante / OOM** : Chatterbox (~0,5 Md paramètres) tient
  confortablement en 8-12 Go ; si l'erreur persiste, vérifier qu'aucun autre
  process ne sature le GPU (`amdgpu_top` ou équivalent), ou replier en
  `CHATTERBOX_DEVICE=cpu`.
- **PipeWire/audio silencieux** : vérifier `pipewire-pulse` actif
  (`systemctl --user status pipewire-pulse`), tester `paplay`/`pw-play` sur
  un WAV connu avant d'accuser l'extension.
- **`curl localhost:8004` ne répond pas** : vérifier `docker compose ps`
  (colonne `STATUS`, healthcheck), puis `docker compose logs chatterbox`.
