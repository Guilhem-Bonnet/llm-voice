"""Empreinte vocale (encodeur du modèle Base, extract_speaker_embedding) des 8 voix créées, sur CPU : aucune charge GPU."""
import json, os, wave, sys
from pathlib import Path
os.environ["HF_HUB_OFFLINE"] = "1"
import numpy as np, torch
from huggingface_hub import snapshot_download
from qwen_tts import Qwen3TTSModel
m = Qwen3TTSModel.from_pretrained(snapshot_download("Qwen/Qwen3-TTS-12Hz-1.7B-Base", local_files_only=True), device_map="cpu", dtype=torch.float32)
target = m.model.speaker_encoder_sample_rate
def emb(p):
    with wave.open(str(p)) as w: sr = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype("float32") / 32768
    if sr != target:
        import librosa; a = librosa.resample(y=a, orig_sr=sr, target_sr=target)
    e = m.model.extract_speaker_embedding(audio=a, sr=target).float().reshape(-1); return e / e.norm()
files = {}
for d in sorted(Path("/lab/refs/created").glob("v-*")):
    files[json.loads((d / "voice.json").read_text())["name"]] = emb(d / "sample.wav")
for p in sorted(Path("/tmp/proof").glob("*.wav")): files["lecture:" + p.stem] = emb(p)
names = list(files); M = torch.stack([files[n] for n in names]); S = (M @ M.T).numpy().round(3)
print(json.dumps({"encoder_sample_rate": target, "names": names, "cos": S.tolist()}, ensure_ascii=False))
