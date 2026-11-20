#!/usr/bin/env python3
"""Transcrit le WAV de l'image ROCm (faster-whisper, CPU, hors ligne) et relève le WER. Rien n'est joué.

    HF_HUB_OFFLINE=1 ~/.llm-voice/tools/audio-proof-venv/bin/python -I \\
        _grimoire-output/evidence/GAO-images-docke-001/transcribe_wer.py
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "scripts" / "audio-proof"))
from analyze import analyze_signal, word_error_rate  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402

expected = json.loads((HERE / "timings.json").read_text(encoding="utf-8"))["text"]
path = HERE / "figee-image-rocm.wav"
model = WhisperModel("small", device="cpu", compute_type="int8")
segments, _ = model.transcribe(str(path), language="fr", vad_filter=True)
heard = " ".join(s.text.strip() for s in segments).strip()
stats = analyze_signal(path)
row = {"name": path.stem, "expected": expected, "heard": heard,
       "wer": round(word_error_rate(expected, heard), 4), "duration_s": round(stats.duration_s, 2),
       "rms": round(stats.rms, 4)}
(HERE / "wer.json").write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(row, ensure_ascii=False))
