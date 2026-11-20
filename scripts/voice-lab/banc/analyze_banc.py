#!/usr/bin/env python3
"""Mesures du banc (CPU, faster-whisper small) : WER français, probabilité de langue (fr/en), mots de balise ou de consigne
prononcés, durée, plus longue pause entre mots. Usage : analyze_banc.py <out_root> <analysis.json> [moteur...]
À lancer avec ~/.llm-voice/tools/audio-proof-venv/bin/python -I (aucune charge GPU)."""
import json, re, sys, unicodedata, wave
from pathlib import Path
import numpy as np
from faster_whisper import WhisperModel
root, dst = Path(sys.argv[1]), Path(sys.argv[2]); only = set(sys.argv[3:])
res = json.loads(dst.read_text()) if dst.exists() else {}
wm = WhisperModel("small", device="cpu", compute_type="int8")
# Mots qui trahissent une balise ou une consigne lue à voix haute (anglais ou français).
TAGW = re.compile(r"\b(breath\w*|cough\w*|sigh\w*|laugh\w*|chuckl\w*|whisper\w*|pant\w*|inhale\w*|angry|shout\w*|throat|embarrass\w*|"
                  r"low voice|soft|toux|tousse\w*|soupir\w*|rire|rit|respir\w*|hal[eè]t\w*|chuchot\w*|crochet\w*|balise\w*)\b", re.I)
def norm(t):
    t = unicodedata.normalize("NFKD", re.sub(r"\[[^\]]*\]", " ", t.lower())); t = "".join(c for c in t if not unicodedata.combining(c))
    return re.findall(r"[a-z0-9]+", t)
def wer(r, h):
    d = list(range(len(h) + 1))
    for i, a in enumerate(r, 1):
        p, d[0] = d[0], i
        for j, b in enumerate(h, 1):
            p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (a != b))
    return round(d[-1] / max(1, len(r)), 3)
for edir in sorted(p for p in root.iterdir() if p.is_dir()):
    if only and edir.name not in only: continue
    for wav in sorted(edir.glob("*.wav")):
        key = f"{edir.name}/{wav.stem}"
        if key in res: continue
        meta = json.loads(wav.with_suffix(".json").read_text())
        with wave.open(str(wav)) as w: sr = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype("float32") / 32768
        _, info = wm.transcribe(str(wav), language=None, beam_size=1)   # détection de langue seule (30 premières s)
        probs = dict(info.all_language_probs or [])
        segs, _ = wm.transcribe(str(wav), language="fr", word_timestamps=True, beam_size=5, temperature=0)
        words = [x for s in segs for x in s.words]
        tr = " ".join(x.word.strip() for x in words)
        gaps = [(round(words[i].start - words[i - 1].end, 2), round(words[i - 1].end, 2)) for i in range(1, len(words))]
        g = max(gaps) if gaps else (None, None)
        res[key] = {"engine": edir.name, "item": wav.stem, "kind": meta.get("kind"), "method": meta.get("method"),
            "transcript": tr, "wer": wer(norm(meta.get("text", "")), norm(tr)), "tag_words": TAGW.findall(tr),
            "lang_detected": info.language, "p_fr": round(probs.get("fr", 0.0), 4), "p_en": round(probs.get("en", 0.0), 4),
            "dur_s": round(len(a) / sr, 2), "peak": round(float(np.abs(a).max()), 3), "max_gap_s": g[0], "max_gap_at_s": g[1],
            "gen_s": meta.get("gen_s"), "rtf": meta.get("rtf"), "vram_peak_alloc_mb": meta.get("vram_peak_alloc_mb"),
            "vram_peak_reserved_mb": meta.get("vram_peak_reserved_mb"), "vram_card_peak_mb": meta.get("vram_card_peak_mb") or meta.get("vram_card_mb")}
        dst.write_text(json.dumps(res, ensure_ascii=False, indent=1))
        r = res[key]; print(key, "WER", r["wer"], "fr", r["p_fr"], "en", r["p_en"], r["tag_words"], flush=True)
