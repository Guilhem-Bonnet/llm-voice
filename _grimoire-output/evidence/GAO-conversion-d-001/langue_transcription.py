"""Langue détectée et transcription (faster-whisper, CPU int8), sans jouer aucun son."""
import json, sys, wave
from faster_whisper import WhisperModel
files = sys.argv[1:]
for name in ("large-v3", "medium", "small"):
    try:
        model = WhisperModel(name, device="cpu", compute_type="int8"); break
    except Exception as e:
        print("modèle absent:", name, type(e).__name__, file=sys.stderr)
out = {"whisper_model": name, "files": {}}
for f in files:
    segs, info = model.transcribe(f, beam_size=5)  # sans `language` : détection libre
    text = " ".join(s.text.strip() for s in segs)
    probs = dict(info.all_language_probs or [])
    with wave.open(f) as w: dur = w.getnframes() / w.getframerate()
    out["files"][f] = {"audio_s": round(dur, 2), "detected": info.language, "p_detected": round(info.language_probability, 3),
                       "p_fr": round(probs.get("fr", 0.0), 3), "p_en": round(probs.get("en", 0.0), 3),
                       "top3": [(k, round(v, 3)) for k, v in sorted(probs.items(), key=lambda kv: -kv[1])[:3]], "text": text}
    print(f, json.dumps(out["files"][f], ensure_ascii=False), flush=True)
json.dump(out, open("langue-transcription.json", "w"), ensure_ascii=False, indent=2)
