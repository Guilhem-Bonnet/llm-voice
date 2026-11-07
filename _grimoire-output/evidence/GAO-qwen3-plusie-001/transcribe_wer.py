"""Transcription faster-whisper (CPU, hors ligne) et WER des lectures de GAO-qwen3-plusie-001."""
import json, os, re, sys, unicodedata
os.environ["HF_HUB_OFFLINE"] = "1"
from faster_whisper import WhisperModel
ref = "Le train s'est arrêté au milieu de la campagne, sans la moindre annonce."
def words(t): return re.sub(r"[^\w' ]", " ", unicodedata.normalize("NFC", t.lower()).replace("’", "'")).split()
def wer(a, b):
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1):
            p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[len(b)] / len(a)
for name in ("large-v3", "medium", "small", "base"):
    try: model = WhisperModel(name, device="cpu", compute_type="int8"); break
    except Exception as e: print("modèle absent:", name, type(e).__name__, file=sys.stderr)
out = {"whisper_model": name, "reference": ref, "files": {}}
for f in sys.argv[1:]:
    segs, info = model.transcribe(f, language="fr", beam_size=5)
    hyp = " ".join(s.text.strip() for s in segs)
    out["files"][os.path.basename(f)] = {"transcript": hyp, "wer": round(wer(words(ref), words(hyp)), 3), "duration_s": round(info.duration, 2)}
print(json.dumps(out, ensure_ascii=False, indent=2))
