"""WAV du serveur et mesures simples. Les mesures disent si l'audio change, pas s'il est agréable."""
from __future__ import annotations

import struct
import wave
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class Pcm:
    rate: int
    samples: np.ndarray  # mono, int16


def parse_wav(data: bytes) -> Pcm:
    """Lit un WAV PCM16 mono, y compris l'en-tête de flux dont la taille annoncée est fausse."""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("pas un fichier WAV")
    offset, rate = 12, None
    while offset + 8 <= len(data):
        chunk, size = data[offset : offset + 4], struct.unpack("<I", data[offset + 4 : offset + 8])[0]
        if chunk == b"fmt ":
            fmt, channels, rate, _, _, bits = struct.unpack("<HHIIHH", data[offset + 8 : offset + 24])
            if bits != 16 or channels != 1 or fmt not in (1, 0xFFFE):
                raise ValueError(f"format inattendu : {fmt}, {channels} canaux, {bits} bits")
        elif chunk == b"data":
            if rate is None:
                raise ValueError("chunk data avant fmt")
            body = data[offset + 8 : offset + 8 + size]
            return Pcm(rate, np.frombuffer(body[: len(body) - len(body) % 2], dtype="<i2"))
        offset += 8 + size + size % 2
    raise ValueError("chunk data absent")


def write_wav(path: Path, pcm: Pcm) -> None:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(pcm.rate)
        out.writeframes(pcm.samples.astype("<i2").tobytes())


def concat(parts: list[Pcm], pause_ms: int = 350) -> Pcm:
    if not parts or any(part.rate != parts[0].rate for part in parts):
        raise ValueError("segments vides ou de cadences différentes")
    gap = np.zeros(parts[0].rate * pause_ms // 1000, dtype=np.int16)
    pieces: list[np.ndarray] = []
    for index, part in enumerate(parts):
        if index:
            pieces.append(gap)
        pieces.append(part.samples)
    return Pcm(parts[0].rate, np.concatenate(pieces))


@dataclass(frozen=True)
class Measures:
    duration_s: float
    speech_ratio: float
    pause_count: int
    pause_total_s: float
    pitch_hz: float
    pitch_spread_hz: float
    loudness_spread_db: float

    def as_dict(self) -> dict[str, float]:
        return {key: round(value, 2) for key, value in asdict(self).items()}


def measure(pcm: Pcm, frame_ms: int = 30, min_pause_ms: int = 150) -> Measures:
    samples = pcm.samples.astype(np.float64) / 32768.0
    size = max(1, pcm.rate * frame_ms // 1000)
    count = len(samples) // size
    duration = len(samples) / pcm.rate
    if count == 0:
        return Measures(duration, 0, 0, 0, 0, 0, 0)
    frames = samples[: count * size].reshape(count, size)
    energy = np.sqrt(np.mean(frames**2, axis=1))
    peak = float(energy.max())
    if peak < 1e-4:
        return Measures(duration, 0, 0, 0, 0, 0, 0)
    voiced = energy > peak * 0.08
    pauses, total, run = 0, 0.0, 0
    first, last = int(np.argmax(voiced)), count - 1 - int(np.argmax(voiced[::-1]))
    for active in voiced[first : last + 1]:
        if active:
            if run * frame_ms >= min_pause_ms:
                pauses += 1
                total += run * frame_ms / 1000
            run = 0
        else:
            run += 1
    pitches = [p for p in (_pitch(frame, pcm.rate) for frame in frames[voiced]) if p > 0]
    loud = 20 * np.log10(energy[voiced] + 1e-9)
    return Measures(
        duration,
        float(voiced.mean()),
        pauses,
        total,
        float(np.median(pitches)) if pitches else 0.0,
        float(np.std(pitches)) if pitches else 0.0,
        float(np.std(loud)),
    )


def _pitch(frame: np.ndarray, rate: int, low: int = 70, high: int = 400) -> float:
    frame = frame - frame.mean()
    correlation = np.correlate(frame, frame, mode="full")[len(frame) - 1 :]
    if correlation[0] <= 0:
        return 0.0
    start, stop = rate // high, min(rate // low, len(correlation) - 1)
    if stop <= start:
        return 0.0
    lag = start + int(np.argmax(correlation[start:stop]))
    return rate / lag if correlation[lag] / correlation[0] > 0.45 else 0.0


def normalize_words(text: str) -> list[str]:
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in text)
    return cleaned.split()


def word_error_rate(expected: str, heard: str) -> float:
    ref, hyp = normalize_words(expected), normalize_words(heard)
    if not ref:
        return 0.0 if not hyp else 1.0
    row = list(range(len(hyp) + 1))
    for i, ref_word in enumerate(ref, 1):
        previous, row[0] = row[0], i
        for j, hyp_word in enumerate(hyp, 1):
            previous, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, previous + (ref_word != hyp_word))
    return row[-1] / len(ref)
