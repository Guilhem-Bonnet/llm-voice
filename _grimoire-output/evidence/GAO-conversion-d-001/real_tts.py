import json, os, sys, time, urllib.request, urllib.parse, wave, io, glob
OUT = sys.argv[1]; TAG = sys.argv[2]; VOICES = sys.argv[3].split(",")
FLAG = os.path.join(os.environ["XDG_RUNTIME_DIR"], "gpu-yield", "active")
TEXT = "Tu m'as menti depuis le début ! Je ne veux plus jamais te revoir, tu m'entends ?"
DIRECTION = "Furious, shouting with anger, voice trembling with rage."
def vram():
    best = None
    for t in glob.glob("/sys/class/drm/card*/device/mem_info_vram_total"):
        tot = int(open(t).read()); used = int(open(t.replace("total", "used")).read())
        if best is None or tot > best[0]: best = (tot, used)
    return round(best[1] / 2**20)
rows = []
for voice in VOICES:
    if os.path.exists(FLAG): print("mode jeu"); sys.exit(75)
    form = {"text": TEXT, "voice_url": voice}
    if TAG != "frozen": form["direction"] = DIRECTION
    req = urllib.request.Request("http://127.0.0.1:8021/tts", data=urllib.parse.urlencode(form).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"})
    t = time.monotonic()
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read(); status = r.status; conv = r.headers.get("X-LLM-Voice-Converted")
    dt = time.monotonic() - t
    with wave.open(io.BytesIO(data)) as w: dur = w.getnframes() / w.getframerate(); rate = w.getframerate()
    name = f"{voice}-{TAG}.wav"; open(os.path.join(OUT, name), "wb").write(data)
    row = {"voice": voice, "mode": TAG, "status": status, "converted_header": conv, "wall_s": round(dt, 2), "audio_s": round(dur, 2), "rate": rate, "file": name, "vram_used_mib_after": vram()}
    rows.append(row); print(json.dumps(row), flush=True)
with open(os.path.join(OUT, f"tts-{TAG}.jsonl"), "a") as f:
    for row in rows: f.write(json.dumps(row) + "\n")
