#!/usr/bin/env python3
"""Référence : serveur Qwen3 en service (127.0.0.1:8021). Voix figée (Base) et voix jouée (VoiceDesign, `direction`).
Usage : gen_qwen3_ref.py <out_root> [voice_id]  — aucun en-tête Origin ; aucun code entre crochets envoyé."""
import io, sys, time, urllib.parse, urllib.request, wave
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent)); from common import items, game_mode, VramSampler, write_meta
root = Path(sys.argv[1]); voice = sys.argv[2] if len(sys.argv) > 2 else "fr-essais-21-22"
URL = "http://127.0.0.1:8021/tts"
def tts(text, direction=None):
    form = {"text": text, "voice_url": voice}
    if direction: form["direction"] = direction
    req = urllib.request.Request(URL, data=urllib.parse.urlencode(form).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=900) as r: return r.read()
for mode in ("fige", "joue"):
    out = root / f"qwen3-{mode}"; out.mkdir(parents=True, exist_ok=True)
    for it in items():
        name = it["id"]
        if (out / f"{name}.wav").exists(): continue
        if game_mode(): print("mode jeu actif : arrêt propre avant", mode, name); sys.exit(75)
        direction = it.get("direction") if mode == "joue" else None
        with VramSampler() as vs:
            t = time.monotonic(); data = tts(it["text"], direction); dt = time.monotonic() - t
        (out / f"{name}.wav").write_bytes(data)
        with wave.open(io.BytesIO(data)) as w: dur = w.getnframes() / w.getframerate()
        write_meta(out, name, engine=f"qwen3-{mode}", item=name, kind=it["kind"], text=it["text"], input_text=it["text"],
                   method=("consigne VoiceDesign (champ direction)" if direction else "voix figée Base, texte seul (aucun moyen d'état)"),
                   direction=direction, voice=voice, gen_s=round(dt, 2), audio_s=round(dur, 2), vram_card_peak_mb=vs.peak)
        print(mode, name, round(dt, 1), "s pour", round(dur, 1), "s", flush=True)
