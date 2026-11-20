"""Outils communs du banc (hôte ou conteneur) : textes, mode jeu, mémoire GPU, écriture WAV + méta."""
import json, os, threading, time, wave
from pathlib import Path

BANC = Path(__file__).with_name("banc.json")
FLAG = Path(os.environ.get("XDG_RUNTIME_DIR", "/nonexistent")) / "gpu-yield" / "active"

def items():
    return json.loads(BANC.read_text())["items"]

def game_mode():
    return FLAG.exists()

def vram_mb():
    for p in sorted(Path("/sys/class/drm").glob("card*/device/mem_info_vram_used")):
        try: return round(int(p.read_text()) / 2**20)
        except Exception: pass
    return None

class VramSampler:
    """Pointe de mémoire de la carte entière (sysfs), échantillonnée toutes les 100 ms."""
    def __init__(self): self.peak = vram_mb() or 0; self._stop = threading.Event(); self._t = threading.Thread(target=self._run, daemon=True)
    def _run(self):
        while not self._stop.wait(0.1): self.peak = max(self.peak, vram_mb() or 0)
    def __enter__(self): self._t.start(); return self
    def __exit__(self, *a): self._stop.set(); self._t.join()

def write_wav(path, samples, sr):
    import numpy as np
    a = np.clip(np.asarray(samples, dtype="float32").reshape(-1), -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((a * 32767).astype("<i2").tobytes())
    return len(a) / sr

def write_meta(out, name, **kw):
    if kw.get("gen_s") and kw.get("audio_s"): kw["rtf"] = round(kw["gen_s"] / kw["audio_s"], 3)
    (Path(out) / f"{name}.json").write_text(json.dumps({"id": name, **kw}, ensure_ascii=False, indent=1))
