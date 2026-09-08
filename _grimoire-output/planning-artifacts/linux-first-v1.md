# Linux-first — vérification technique v1

> Forge (ops-engineer). Répond aux CdC §24-27, §56 et D9 (decisions-cadrage-v1.md). Affirmation non sourcée = **non vérifié**.

## 1. Audio dans VS Code sous Linux (Webview)

La Webview est un `<webview>` Electron/Chromium. Chromium ne parle pas nativement PipeWire : il passe par **PulseAudio**, et PipeWire fournit un module `pipewire-pulse` qui émule ce protocole — voie quasi universelle, sandbox ou non. Sur Fedora 44 (PipeWire natif), un `<audio>` standard doit donc marcher **sans configuration** dès que `pipewire-pulse` tourne.

- **RPM/deb (Microsoft officiel)** : pas de sandbox, accès direct PulseAudio/PipeWire et `localhost`. Mode le plus simple. À tester : `<audio>` dans une vraie Webview (pas juste le process principal), `retainContextWhenHidden`, CSP `media-src`.
- **Flatpak** (`com.visualstudio.code`/VSCodium), sandbox bwrap strict : *audio* nécessite `--socket=pulseaudio` dans le manifeste — présent sur le manifeste officiel, donc `<audio>` marche généralement out-of-the-box ; *réseau* nécessite `--share=network` (présent, sinon aucune extension réseau ne marcherait), `localhost` se comporte alors comme en shell normal ; *binaires hôte* (`spd-say`, etc.) **cassés par défaut**, le sandbox interdit l'exécution directe — VS Code Flatpak contourne via `flatpak-spawn --host` ou l'utilitaire `host-spawn` bundlé (corrige les soucis de TTY de `flatpak-spawn`). Un `child_process.spawn('spd-say')` direct échoue silencieusement en sandbox. **Conséquence** : `SystemTtsProvider` (1b) doit détecter `FLATPAK_ID` et préfixer par `flatpak-spawn --host`, avec message d'erreur explicite si absent/refusé.
- **Snap** : confinement **classic** (approuvé manuellement par Canonical) — accès système quasi complet, comparable au natif, pas de restriction audio/réseau/exec significative. Risque le plus faible après RPM/deb ; comportement des extensions tierces en pratique **non vérifié**.

**À tester** : `<audio>` réel sur RPM (Fedora 44) et Flatpak ; `spd-say` direct vs `flatpak-spawn --host` ; détection du mode d'installation (`FLATPAK_ID`, `SNAP`, sinon natif) ; préférer `127.0.0.1` explicite à `localhost` en Flatpak (résolution DNS parfois différente en sandbox réseau restreint).

Sources : [Audio portal · xdg-desktop-portal](https://github.com/flatpak/xdg-desktop-portal/discussions/1142) · [Sandbox Permissions — Flatpak](https://docs.flatpak.org/en/latest/sandbox-permissions.html) · [com.vscodium.codium — flatpak-spawn/host-spawn](https://deepwiki.com/flathub/com.vscodium.codium/4.1-host-system-integration-(flatpak-spawn-and-host-spawn)) · [com.visualstudio.code.oss #45](https://github.com/flathub/com.visualstudio.code.oss/issues/45) · [Classic confinement — Snap](https://snapcraft.io/docs/explanation/security/classic-confinement/) · [PipeWire vs PulseAudio](https://itsfoss.com/pipewire-vs-pulseaudio/)

## 2. Chatterbox sur RDNA4 (gfx1201)

**Verdict : support réel et documenté**, à condition d'utiliser ROCm ≥ 7.2 (chemin RDNA4 dédié), pas ROCm 6.1.

- ROCm 7.2 (~janvier 2026) liste officiellement gfx1201 (RX 9070, RX 9070 XT, Radeon AI PRO R9700, Navi 48) comme supporté ; ROCm 6.1 ne le supporte **pas**. PyTorch 2.9+ fournit des wheels ROCm couvrant gfx1201 (AMD, octobre 2025).
- `HSA_OVERRIDE_GFX_VERSION` **inutile** avec détection native ROCm 7.0+/7.2 ; le README Chatterbox-TTS-Server prévient que la forcer sur du matériel natif peut **provoquer des crashs**. Ne sert qu'aux outils embarquant leur propre runtime ROCm ancien.
- `devnen/Chatterbox-TTS-Server` fournit un chemin dédié `Dockerfile.rdna4` + `docker-compose-rdna4.yml` (ROCm 7.2 / PyTorch 2.5+), avec `ROCBLAS_USE_HIPBLASLT=0` (stabilité gfx1201, évite des plantages hipBLASLt — cf. rapports croisés côté Ollama sur erreurs Tensile `gfx1200.dat` avec ROCm/rocBLAS mal alignés) et `TTS_BF16=on` (~+40 % de débit, RDNA4 gère bf16 nativement).
- VRAM : Chatterbox (~0,5 Md paramètres) n'est pas contraint sur une RX 9070/9070 XT (16 Go) ; 8-12 Go déjà confortables. Aucune exigence spécifique gfx1201 documentée au-delà du minimum général.

### `docker-compose.tts.yml` (Chatterbox ROCm + Ollama)

```yaml
services:
  chatterbox-tts:
    build:
      context: ./Chatterbox-TTS-Server
      dockerfile: Dockerfile.rdna4        # ROCm 7.2 / PyTorch 2.5+, gfx1201
    ports: ["8004:8004"]
    volumes:
      - ./tts/config.yaml:/app/config.yaml
      - ./tts/voices:/app/voices
      - hf_cache:/app/hf_cache
    devices: [/dev/kfd, /dev/dri]
    group_add: [video, render]
    ipc: host
    shm_size: 8g
    security_opt: [seccomp=unconfined]
    environment:
      - ROCBLAS_USE_HIPBLASLT=0           # stabilité gfx1201
      - TTS_BF16=on
      - HF_HUB_ENABLE_HF_TRANSFER=1
      - HF_HUB_OFFLINE=${HF_HUB_OFFLINE:-0}   # passer à 1 après 1er run
    restart: unless-stopped

  ollama:
    image: ollama/ollama:rocm
    ports: ["11434:11434"]
    volumes: [ollama_data:/root/.ollama]
    devices: [/dev/kfd, /dev/dri]
    group_add: [video, render]
    restart: unless-stopped

volumes:
  hf_cache:
  ollama_data:
```

`HF_HUB_OFFLINE=1` casse le premier démarrage (téléchargement des poids) : piloter via `.env`, lancer une première fois à 0 puis basculer à 1. Pas de `HSA_OVERRIDE_GFX_VERSION` : gfx1201 natif sur ROCm 7.2.

Sources : [Chatterbox-TTS-Server README](https://github.com/devnen/Chatterbox-TTS-Server/blob/main/README.md) · [Dockerfile.rocm](https://github.com/devnen/Chatterbox-TTS-Server/blob/main/Dockerfile.rocm) · [docker-compose-rdna4.yml](https://raw.githubusercontent.com/devnen/Chatterbox-TTS-Server/main/docker-compose-rdna4.yml) · [AMD — PyTorch 2.9 Wheel Variant / ROCm](https://www.amd.com/en/developer/resources/technical-articles/2025/pytorch-2-9-wheel-variant-support-expands-to-rocm.html) · [ROCm/rocm-libraries #7192](https://github.com/ROCm/rocm-libraries/issues/7192) · [Ollama docs — Hardware support](https://docs.ollama.com/gpu) · [Ollama 0.15.4 ROCm 7.2 gfx1201 — Level1Techs](https://forum.level1techs.com/t/ollama-0-15-4-with-rocm-7-2-and-gfx1201/245568)

## 3. TTS locaux légers, sans GPU, bons en français

| Solution | Qualité FR | Poids | CPU/GPU | Licence | API OpenAI-compatible |
|---|---|---|---|---|---|
| **Piper** (siwis/upmc/tom) | Correcte, claire ; siwis = corpus académique net en prose longue, tom plus chaleureux | Qq dizaines de Mo/voix (ONNX) | CPU seul, très rapide | Code MIT ; poids AGPL-3.0 si redistribution/fine-tune + droits de la voix | Oui via wrapper (`piper-tts-http-server`, etc.) |
| **Kokoro** (82M) | FR limité : un seul voicepack FR, doc reconnaît un support non-anglais plus pauvre | ~82M paramètres | CPU correct, GPU accélère | Apache 2.0 | Oui, `Kokoro-FastAPI` (actif) |
| **espeak-ng/speech-dispatcher** | Faible, très synthétique | Minuscule | CPU trivial | GPL-3.0 | Non (moteur système, pas serveur HTTP) |
| **Coqui XTTS v2** | Très bonne, clonage voix multilingue | ~1,8 Md paramètres, lourd | GPU recommandé | CPML ; société fermée janv. 2024, **fork actif** `idiap/coqui-ai-TTS` (PyPI `coqui-tts`) | Oui via `openedai-speech` (**archivé 4 janv. 2026, obsolète annoncé**) |
| **MeloTTS** | Bonne, moins de voix FR que Piper | Léger, edge/mobile | CPU très efficace | MIT | Pas de wrapper OpenAI officiel connu (**non vérifié**) |
| **Orpheus TTS** | Bonne, voix FR dédiées (pierre, amelie, marie), backbone Llama-3B lourd | ~3 Md paramètres | GPU quasi indispensable | Apache 2.0 (canopyai) | Oui, `Orpheus-FastAPI`/forks |

**Recommandation D9 (« local sans GPU ») : confirmée — Piper derrière un petit serveur compatible OpenAI**, seule option cochant CPU pur rapide, poids minuscule, qualité FR acceptable, licence serveur permissive. Deux nuances : (1) **`openedai-speech` est archivé** (4 janv. 2026, obsolète officiellement) — ne pas s'y appuyer pour une nouvelle intégration ; alternatives actives : `piper-tts-http-server`/forks, ou `speaches` (couple Whisper et Kokoro/Piper) ; un wrapper maison ~100 lignes autour de `piper` CLI reste robuste vu la simplicité du contrat `/v1/audio/speech`. (2) Kokoro reste un bon fallback n°2 (CdC §27, `Kokoro-FastAPI` actif), pas n°1, à cause de son FR limité.

Sources : [piper/VOICES.md](https://github.com/rhasspy/piper/blob/master/VOICES.md) · [Piper voices ranked](https://quick-tts.com/blog/piper-voices-ranked.html) · [piper-fr-fr-siwis-medium — HF](https://huggingface.co/Trelis/piper-fr-fr-siwis-medium) · [openedai-speech (archivé)](https://github.com/matatonic/openedai-speech) · [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) · [piper-tts-http-server](https://github.com/Kamil-Krawiec/piper-tts-http-server) · [coqui-ai/TTS #3488](https://github.com/coqui-ai/TTS/issues/3488) · [canopyai/Orpheus-TTS](https://github.com/canopyai/Orpheus-TTS) · MeloTTS wrapper OpenAI : **non vérifié**

## 4. Voix système Linux (`spd-say`/speech-dispatcher)

`spd-say` est le client CLI de **speech-dispatcher**, couche d'abstraction TTS standard (lecteurs d'écran). Il n'existe **pas de module `sd_piper`** officiel ; l'intégration Piper passe par le module générique **`sd_generic`** (fichier `.conf` définissant la commande shell : Piper en entrée, `pw-play`/`paplay`/`aplay` en sortie). Limite connue : speech-dispatcher envoie le texte phrase par phrase, créant des silences perceptibles même si Piper pourrait pré-synthétiser en continu.

**Utilité vs serveur HTTP** : un serveur HTTP direct (§3) donne un contrôle bien supérieur (streaming, cache, timestamps mot-à-mot, sélection de voix par profil) que speech-dispatcher + `sd_generic` + Piper, qui ajoute latence et découpage sans prise fine côté extension.

**Recommandation** : réserver `spd-say` au niveau 1b (zéro installation, voix déjà configurées par l'utilisateur) ; ne pas y brancher Piper — pour la qualité Piper, passer par le niveau 1 (serveur HTTP dédié).

Sources : [Install Piper as speech dispatcher module (gist)](https://gist.github.com/alexkuz/f24f93245ff80458c9b6ec93c644c40b) · [speech-dispatcher and piper — mailing list](https://lists.gnu.org/archive/html/speechd-discuss/2024-03/msg00004.html) · [Speech dispatcher — ArchWiki](https://wiki.archlinux.org/title/Speech_dispatcher) · [rhasspy/piper #285](https://github.com/rhasspy/piper/issues/285)

## 5. Tests d'intégration VS Code sous Linux CI

`@vscode/test-electron` lance un vrai Electron/Chromium. Sur `ubuntu-latest` sans affichage : serveur X virtuel **`xvfb-run`** + bibliothèques attendues d'un desktop (`libnss3`, `libgbm1`, `libgtk-3-0`, `libasound2`/renommé, `xvfb`). Pièges : sandbox Chromium plante souvent en CI (`--no-sandbox` ou conteneur non privilégié) ; DBus pas toujours présent (`dbus-run-session` si notifications système) ; sur `ubuntu-24.04`, `libasound2` a été renommé/scindé (`libasound2t64`), l'installer sous l'ancien nom échoue.

```yaml
# .github/workflows/test-linux.yml (extrait)
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - name: Install Electron/VS Code runtime deps
        run: |
          sudo apt-get update
          sudo apt-get install -y xvfb libnss3 libgbm1 libgtk-3-0 \
            libasound2t64 libatk-bridge2.0-0 libdrm2
      - name: Run extension tests
        run: xvfb-run -a npm test
```

Sources : [VS Code — Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration) · [vscode #174744 — renderer crash xvfb-run](https://github.com/microsoft/vscode/issues/174744) · [setup-chrome #618 — libasound2 ubuntu-24.04](https://github.com/browser-actions/setup-chrome/issues/618) · [setup-xvfb Action](https://github.com/marketplace/actions/setup-xvfb)

## 6. Checklist « Linux validé » — Definition of Done 1.0

- [ ] **Distributions** : Fedora (stable), Ubuntu LTS (22.04/24.04), Arch — un test manuel complet par distribution avant tag 1.0.
- [ ] **Installation VS Code** : RPM/deb ; Flatpak (audio, localhost, `SystemTtsProvider` via `flatpak-spawn --host`) ; Snap (`--classic`, extensions tierces à confirmer en pratique).
- [ ] **Audio & display server** : PipeWire natif, PulseAudio pur, `pipewire-pulse` (compat layer, majoritaire 2026) ; Wayland et X11 (highlight éditeur et Webview sous Wayland).
- [ ] **GPU** : AMD ROCm (RDNA4 gfx1201, machine de référence, ROCm 7.2) ; NVIDIA CUDA (une carte de référence) ; CPU seul (Chatterbox CPU + Piper en repli).
- [ ] **Réseau & hook** : `localhost`/`127.0.0.1` fonctionnel vers le serveur TTS par mode d'installation (Flatpak en particulier) ; collector Node du hook Claude Code testé par mode d'installation (chemins home, permissions 0600, `~/.llm-voice/inbox/`).
- [ ] **Voix système (1b)** : `spd-say` fonctionnel sur un desktop standard (GNOME/KDE) avec speech-dispatcher déjà configuré par la distribution.

## Points « non vérifié »

- MeloTTS : absence de wrapper OpenAI-compatible officiel — à confirmer.
- Snap : comportement précis des extensions tierces en confinement classic.
- Résolution DNS `localhost` vs `127.0.0.1` en sandbox Flatpak selon versions de `xdg-desktop-portal` — à tester sur la machine cible.
