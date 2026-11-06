#!/usr/bin/env python3
"""analyze.py — transcrit un WAV capturé et calcule WER + silence + RMS.

Outil du banc de preuve audio GAO-banc-de-preu-001. Stdlib pour le signal
(wave, audioop, unicodedata) ; faster-whisper et numpy pour la transcription
(dépendances installées par setup.sh dans un venv dédié hors dépôt).

Usage CLI :
    python analyze.py --audio capture.wav --expect "phrase attendue" \
        [--lang fr] [--model small] [--device cpu] [--compute-type int8] \
        [--threshold 0.25] [--silence-dbfs -50] [--json]

Sortie JSON sur stdout :
    {"wer": 0.0, "transcription": "...", "duration_s": 2.1,
     "silence_max_ms": 120.0, "rms": 0.0421, "silent": false,
     "wer_ok": true, "pass": true}

Code de sortie : 0 si wer <= seuil ET signal non silencieux, 1 sinon,
2 en cas d'erreur (fichier absent, modèle indisponible, etc).

Interface MCP :
    mcp_analyze(audio_path, expect, lang="fr", model="small", device="cpu",
                compute_type="int8", threshold=0.25, silence_dbfs=-50.0)
        -> dict (même schéma que la sortie JSON, sans "pass"/"wer_ok" recalculés
           séparément : le dict est directement exploitable).
"""

from __future__ import annotations

import argparse
import audioop
import json
import re
import sys
import unicodedata
import wave
from dataclasses import dataclass, asdict
from pathlib import Path

VERSION = "1.0.0"

_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_SPACE_RE = re.compile(r"\s+", re.UNICODE)


def normalize_text(text: str) -> str:
    """Minuscules, sans accents, sans ponctuation, espaces normalisés."""
    text = text.lower().strip()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = _PUNCT_RE.sub(" ", text)
    text = _SPACE_RE.sub(" ", text).strip()
    return text


def word_error_rate(reference: str, hypothesis: str) -> float:
    """WER classique (distance d'édition au niveau mot) / len(reference)."""
    ref_words = normalize_text(reference).split()
    hyp_words = normalize_text(hypothesis).split()
    if not ref_words:
        return 0.0 if not hyp_words else 1.0

    n, m = len(ref_words), len(hyp_words)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if ref_words[i - 1] == hyp_words[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[n][m] / n


@dataclass
class SignalStats:
    duration_s: float
    rms: float
    silence_max_ms: float
    silence_between_sounds_ms: float = 0.0


def analyze_signal(wav_path: Path, silence_dbfs: float = -50.0, window_ms: float = 20.0) -> SignalStats:
    """RMS global et plus long silence interne (fenêtres de `window_ms`)."""
    with wave.open(str(wav_path), "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    duration_s = n_frames / framerate if framerate else 0.0
    if n_channels > 1:
        raw = audioop.tomono(raw, sampwidth, 0.5, 0.5)

    if not raw:
        return SignalStats(duration_s=duration_s, rms=0.0, silence_max_ms=duration_s * 1000.0)

    global_rms = audioop.rms(raw, sampwidth) / float(1 << (8 * sampwidth - 1))

    max_amp = 1 << (8 * sampwidth - 1)
    silence_threshold = max_amp * (10 ** (silence_dbfs / 20.0))

    window_frames = max(1, int(framerate * window_ms / 1000.0))
    window_bytes = window_frames * sampwidth
    n_windows = max(1, len(raw) // window_bytes)

    max_silence_windows = 0
    current_silence_windows = 0
    # Entre le premier et le dernier son : ignore l'attente avant le premier mot et la fin de capture.
    max_internal_windows = 0
    heard_sound = False
    for i in range(n_windows):
        chunk = raw[i * window_bytes:(i + 1) * window_bytes]
        if not chunk:
            continue
        chunk_rms = audioop.rms(chunk, sampwidth)
        if chunk_rms < silence_threshold:
            current_silence_windows += 1
            max_silence_windows = max(max_silence_windows, current_silence_windows)
        else:
            if heard_sound:
                max_internal_windows = max(max_internal_windows, current_silence_windows)
            heard_sound = True
            current_silence_windows = 0

    silence_max_ms = max_silence_windows * window_ms
    return SignalStats(
        duration_s=duration_s,
        rms=global_rms,
        silence_max_ms=silence_max_ms,
        silence_between_sounds_ms=max_internal_windows * window_ms,
    )


def transcribe(wav_path: Path, lang: str, model: str, device: str, compute_type: str) -> str:
    from faster_whisper import WhisperModel  # import tardif : dépendance du venv dédié

    whisper_model = WhisperModel(model, device=device, compute_type=compute_type)
    segments, _info = whisper_model.transcribe(str(wav_path), language=lang, vad_filter=True)
    return " ".join(segment.text.strip() for segment in segments).strip()


def mcp_analyze(
    audio_path: str,
    expect: str,
    lang: str = "fr",
    model: str = "small",
    device: str = "cpu",
    compute_type: str = "int8",
    threshold: float = 0.25,
    silence_dbfs: float = -50.0,
) -> dict:
    """Interface MCP/module : mêmes calculs que la CLI, retourne un dict."""
    wav_path = Path(audio_path)
    if not wav_path.is_file():
        raise FileNotFoundError(f"fichier audio introuvable : {wav_path}")

    stats = analyze_signal(wav_path, silence_dbfs=silence_dbfs)
    transcription = transcribe(wav_path, lang=lang, model=model, device=device, compute_type=compute_type)
    wer = word_error_rate(expect, transcription)

    silent = stats.silence_max_ms >= stats.duration_s * 1000.0 * 0.9 or stats.rms < 1e-4
    wer_ok = wer <= threshold

    return {
        "wer": round(wer, 4),
        "transcription": transcription,
        "duration_s": round(stats.duration_s, 3),
        "silence_max_ms": round(stats.silence_max_ms, 1),
        "silence_between_sounds_ms": round(stats.silence_between_sounds_ms, 1),
        "rms": round(stats.rms, 6),
        "silent": silent,
        "wer_ok": wer_ok,
        "pass": bool(wer_ok and not silent),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analyse WER + silence d'une capture audio.")
    parser.add_argument("--audio", required=True, help="chemin du WAV capturé")
    parser.add_argument("--expect", required=True, help="phrase attendue (texte brut)")
    parser.add_argument("--lang", default="fr")
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--threshold", type=float, default=0.25, help="WER max toléré (0.25 par défaut)")
    parser.add_argument("--silence-dbfs", type=float, default=-50.0)
    parser.add_argument("--json", action="store_true", help="ignoré : la sortie est toujours JSON")
    args = parser.parse_args(argv)

    try:
        result = mcp_analyze(
            audio_path=args.audio,
            expect=args.expect,
            lang=args.lang,
            model=args.model,
            device=args.device,
            compute_type=args.compute_type,
            threshold=args.threshold,
            silence_dbfs=args.silence_dbfs,
        )
    except Exception as exc:  # noqa: BLE001 — rapporté en JSON, pas de traceback pour l'appelant
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 2

    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
