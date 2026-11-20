#!/usr/bin/env python3
"""Étape voix : crée les candidates (POST /voices/create) puis lit 2 textes du banc en voix figée avec chacune.
Usage : gen_voix.py <out_root>  — journal des créations dans <out_root>/voix-created.json ; reprise possible."""
import io, json, sys, time, urllib.parse, urllib.request, wave
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent)); from common import items, game_mode, write_meta
root = Path(sys.argv[1]); out = root / "voix-candidates"; out.mkdir(parents=True, exist_ok=True)
cfg = json.loads(Path(__file__).with_name("voix_candidates.json").read_text()); texts = {i["id"]: i for i in items()}
log_p = root / "voix-created.json"; created = json.loads(log_p.read_text()) if log_p.exists() else {}
def post(path, form, timeout=900):
    req = urllib.request.Request("http://127.0.0.1:8021" + path, data=urllib.parse.urlencode(form).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=timeout) as r: return r.read()
for c in cfg["candidates"]:
    if c["name"] in created: continue
    if game_mode(): print("mode jeu actif : arrêt propre"); sys.exit(75)
    t = time.monotonic(); r = json.loads(post("/voices/create", {"name": c["name"], "description": c["description"], "sample_text": cfg["sample_text"]}))
    r["create_s"] = round(time.monotonic() - t, 1); created[c["name"]] = r; log_p.write_text(json.dumps(created, ensure_ascii=False, indent=1))
    print("créée", c["name"], r["id"], r["create_s"], "s", flush=True)
for name, r in created.items():
    for tid in cfg["tests"]:
        stem = f"{r['id']}-{tid}"
        if (out / f"{stem}.wav").exists(): continue
        if game_mode(): print("mode jeu actif : arrêt propre"); sys.exit(75)
        t = time.monotonic(); data = post("/tts", {"text": texts[tid]["text"], "voice_url": r["id"]}); dt = time.monotonic() - t
        (out / f"{stem}.wav").write_bytes(data)
        with wave.open(io.BytesIO(data)) as w: dur = w.getnframes() / w.getframerate()
        write_meta(out, stem, engine="voix-candidates", item=tid, kind=texts[tid]["kind"], text=texts[tid]["text"], voice=r["id"], voice_name=name,
                   description=r.get("description"), method="voix créée, figée (Base)", gen_s=round(dt, 2), audio_s=round(dur, 2))
        print("lu", stem, round(dt, 1), "s", flush=True)
