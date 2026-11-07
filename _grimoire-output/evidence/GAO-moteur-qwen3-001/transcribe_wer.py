#!/usr/bin/env python3
"""Transcrit les WAV de la preuve (faster-whisper, CPU, hors ligne) et relève le WER. Rien n'est joué.

    HF_HUB_OFFLINE=1 ~/.llm-voice/tools/audio-proof-venv/bin/python -P \\
        _grimoire-output/evidence/GAO-moteur-qwen3-001/transcribe_wer.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "scripts" / "audio-proof"))

from analyze import analyze_signal, word_error_rate  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402

ONE = "Le train s'est arrêté au milieu de la campagne, sans la moindre annonce."
TWO = "Les voyageurs ont levé les yeux de leurs livres, puis se sont regardés sans rien dire."
EXPECTED = {
    "figee-1": ONE, "figee-2": TWO, "jouee-1": ONE, "jouee-2": TWO, "figee-1-bis": ONE,
    "ordre2-jouee": ONE, "ordre2-figee": TWO, "apres-annulation": ONE, "apres-jeu": TWO,
}

model = WhisperModel("small", device="cpu", compute_type="int8")
rows = []
for name, expected in EXPECTED.items():
    path = HERE / f"{name}.wav"
    if not path.exists():
        continue
    segments, _ = model.transcribe(str(path), language="fr", vad_filter=True)
    heard = " ".join(segment.text.strip() for segment in segments).strip()
    stats = analyze_signal(path)
    rows.append({
        "name": name, "wer": round(word_error_rate(expected, heard), 4), "heard": heard,
        "duration_s": round(stats.duration_s, 2), "rms": round(stats.rms, 4),
        "silence_between_sounds_ms": round(stats.silence_between_sounds_ms),
    })
    print(json.dumps(rows[-1], ensure_ascii=False), flush=True)
(HERE / "wer.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
