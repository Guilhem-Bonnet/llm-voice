#!/usr/bin/env bash
SP=/home/guilhem/.cache/cct/claude-1000/-mnt-Travail-Projets-Dev-TTS-Voice/2afc355f-1a6f-4749-8260-26c00fa0dc52/scratchpad
HS=$(find ~/.cache/ms-playwright/chromium_headless_shell-1248 -type f -name "chrome-headless-shell" | head -1)
E=/mnt/Travail/Projets/Dev/TTS-Voice/_grimoire-output/evidence/GAO-refonte-ux-0-005
python3 $SP/render/make.py $SP/render
: > $E/render-measures.txt
for spec in "dark-started 1400 1100" "dark-started 1120 1250" "dark-started 800 1400" "dark-started 500 1800" "dark-started 320 2600" "dark-started 260 3000" "dark-stopped 1120 1300" "light-started 1120 1250" "dark-credits 720 620"; do
  set -- $spec
  timeout 40 "$HS" --no-sandbox --disable-gpu --hide-scrollbars --window-size=$2,$3 --virtual-time-budget=1500 --dump-dom "file://$SP/render/$1.html" 2>/dev/null | grep -oE 'RESULT w=[0-9]+ [^<]*' | sed "s/^/$1 /" | tee -a $E/render-measures.txt
  timeout 40 "$HS" --no-sandbox --disable-gpu --hide-scrollbars --window-size=$2,$3 --virtual-time-budget=1500 --screenshot=$E/galerie-$1-$2.png "file://$SP/render/$1.html" >/dev/null 2>&1
done
