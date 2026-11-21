#!/usr/bin/env python3
"""Empreinte vocale, CPU seulement (aucun périphérique GPU monté) : encodeur de locuteur du modèle Qwen3 Base.
Limite connue : encodeur entraîné avec le modèle Qwen, il sépare mal certaines voix proches et favorise ses propres sorties.
Sorties : /lab/out/embeddings.json = {stabilite par moteur (cosinus moyen et min entre extraits), matrice entre voix créées}."""
import json, os, wave, itertools
from pathlib import Path
os.environ["HF_HUB_OFFLINE"] = "1"
import numpy as np, torch
from huggingface_hub import snapshot_download
from qwen_tts import Qwen3TTSModel
m = Qwen3TTSModel.from_pretrained(snapshot_download("Qwen/Qwen3-TTS-12Hz-1.7B-Base", local_files_only=True), device_map="cpu", dtype=torch.float32)
sr_t = m.model.speaker_encoder_sample_rate
def emb(p):
    with wave.open(str(p)) as w: sr = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype("float32") / 32768
    if sr != sr_t:
        import librosa; a = librosa.resample(y=a, orig_sr=sr, target_sr=sr_t)
    e = m.model.extract_speaker_embedding(audio=a, sr=sr_t).float().reshape(-1); return (e / e.norm()).numpy()
root = Path("/lab/out"); res = {"encoder": "Qwen3-TTS-12Hz-1.7B-Base speaker encoder", "encoder_sample_rate": sr_t, "stability": {}, "voices": {}}
for d in sorted(p for p in root.iterdir() if p.is_dir() and p.name != "voix-candidates"):
    E = {w.stem: emb(w) for w in sorted(d.glob("*.wav"))}
    if len(E) < 2: continue
    cs = [float(E[a] @ E[b]) for a, b in itertools.combinations(E, 2)]
    ref = [k for k in E if not k.startswith(("05", "06", "07", "08", "09", "10"))]
    neutral = [float(E[a] @ E[b]) for a, b in itertools.combinations(ref, 2)]
    res["stability"][d.name] = {"n": len(E), "cos_mean_all": round(float(np.mean(cs)), 3), "cos_min_all": round(min(cs), 3),
                                "cos_mean_sans_etats": round(float(np.mean(neutral)), 3) if neutral else None}
V = {}
for vd in sorted(Path("/lab/created").glob("v-*")):
    meta = json.loads((vd / "voice.json").read_text()); V[vd.name] = {"name": meta["name"], "e": emb(vd / "sample.wav")}
nar = root / "qwen3-fige" / "01-narration.wav"
if nar.exists(): V["fr-essais-21-22"] = {"name": "Voix des essais 21 et 22 (narration du banc)", "e": emb(nar)}
ids = list(V); M = np.stack([V[i]["e"] for i in ids])
res["voices"] = {"ids": ids, "names": [V[i]["name"] for i in ids], "cos": (M @ M.T).round(3).tolist()}
(root / "embeddings.json").write_text(json.dumps(res, ensure_ascii=False, indent=1)); print(json.dumps(res["stability"], indent=1))
