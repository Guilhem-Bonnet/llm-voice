#!/usr/bin/env python3
"""Chatterbox clone de vrais narrateurs français (CML-TTS, SIWIS, LibriVox) : écoute personnelle.

Une licence de corpus ne vaut pas consentement au clonage : ces extraits servent à juger la qualité
d'un moteur, ils ne sont pas destinés à être livrés. Demande le service Chatterbox sur 127.0.0.1:8004.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import audio
import lab

SERVER = "http://127.0.0.1:8004"
API = "https://huggingface.co/api/models/kyutai/tts-voices"
RAW = "https://huggingface.co/kyutai/tts-voices/resolve/main"
SHORT = "La pluie avait cessé peu avant l'aube. Sur le quai, le vieux gardien rangeait ses cordages sans se presser, comme il le faisait depuis quarante ans."
ROOT = Path(__file__).resolve().parents[2]


def game_running() -> bool:
    runtime = os.environ.get("XDG_RUNTIME_DIR", "")
    return bool(runtime) and Path(runtime, "gpu-yield", "active").exists()


def upload(path: Path) -> None:
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{path.name}"\r\nContent-Type: audio/wav\r\n\r\n').encode() + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(f"{SERVER}/upload_reference", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    urllib.request.urlopen(request, timeout=120).read()


def speak(text: str, reference: str) -> tuple[audio.Pcm, float]:
    payload = {"text": text, "voice_mode": "clone", "reference_audio_filename": reference, "language": "fr", "output_format": "wav", "exaggeration": 0.4, "cfg_weight": 0.5, "temperature": 0.6, "seed": 1234, "split_text": True, "chunk_size": 200}
    request = urllib.request.Request(f"{SERVER}/tts", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=300) as response:
        data = response.read()
    return audio.parse_wav(data), time.monotonic() - started


def references(folder: Path) -> list[tuple[str, Path, str]]:
    folder.mkdir(parents=True, exist_ok=True)
    siblings = json.load(urllib.request.urlopen(API, timeout=30))["siblings"]
    found: list[tuple[str, Path, str]] = []
    for entry in siblings:
        name = entry["rfilename"]
        if name.startswith("cml-tts/fr/") and name.endswith("_enhanced.wav"):
            target = folder / Path(name).name
            if not target.exists():
                with urllib.request.urlopen(f"{RAW}/{name}", timeout=120) as response, target.open("wb") as out:
                    shutil.copyfileobj(response, out)
            found.append((f"narrateur-{target.name.split('_')[0]}", target, "CML-TTS, livres audio LibriVox, CC BY 4.0"))
    siwis = ROOT / "deploy/tts/reference-audio/fr-female-siwis.wav"
    if siwis.exists():
        found.append(("siwis", siwis, "SIWIS, CC BY 4.0"))
    librivox = Path.home() / ".llm-voice/voices/fr-human-librivox.wav"
    if librivox.exists():
        found.append(("librivox-local", librivox, "référence LibriVox déjà présente sur la machine"))
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--keep", type=int, default=12)
    args = parser.parse_args()
    (args.out / "wav").mkdir(parents=True, exist_ok=True)
    long_texts = dict(lab.corpus.load(ROOT / "docs/essais-voix/04-documents.md").lines)
    transcribe = lab.Transcriber(True, "small")
    bench = lab.Bench(SERVER, args.out, transcribe)
    candidates = []
    for slug, path, source in references(Path.home() / ".llm-voice/voices-lab/cml-tts-fr"):
        if game_running():
            print("mode jeu : arrêt propre du banc", flush=True)
            break
        try:
            upload(path)
            pcm, seconds = speak(SHORT, path.name)
        except (OSError, ValueError, urllib.error.URLError) as error:
            bench.errors.append(f"{slug} : {error}")
            continue
        bench.add("Candidats", slug, f"{slug} · extrait court", SHORT, pcm, seconds, source)
        candidates.append((bench.items[-1], path, source))
        print(slug, bench.items[-1].get("wer"), bench.items[-1]["measures"]["pitch_hz"], round(seconds, 1), flush=True)
    # Diversité : les mieux compris dans chaque moitié grave et aiguë. Le genre n'est pas déduit.
    ranked = sorted(candidates, key=lambda row: row[0].get("wer", 1))
    low = [row for row in ranked if row[0]["measures"]["pitch_hz"] < 165]
    high = [row for row in ranked if row[0]["measures"]["pitch_hz"] >= 165]
    half = args.keep // 2
    selected = low[:half] + high[:half]
    selected += [row for row in ranked if row not in selected][: args.keep - len(selected)]
    items: list[dict] = []
    for item, path, source in selected:
        slug = item["id"]
        items.append({**item, "section": "Sélection", "title": f"{slug} · extrait court"})
        for kind in ("recit", "documentation"):
            if game_running():
                break
            try:
                upload(path)
                pcm, seconds = speak(long_texts[kind], path.name)
            except (OSError, ValueError, urllib.error.URLError) as error:
                bench.errors.append(f"{slug}-{kind} : {error}")
                continue
            bench.add("Sélection", f"{slug}-{kind}", f"{slug} · {kind}", long_texts[kind], pcm, seconds, source)
            items.append(bench.items[-1])
    (args.out / "results.json").write_text(json.dumps({"items": bench.items, "selected": [row[0]["id"] for row in selected], "errors": bench.errors}, ensure_ascii=False, indent=1), encoding="utf-8")
    page = lab.render_page(items, {"Sélection": ["Clonages de vrais narrateurs de livres audio par Chatterbox. Sans consentement au clonage : écoute personnelle, pas de livraison en l'état."]}, args.out)
    (args.out / "index.html").write_text(page.replace("<title>Écoute des voix</title>", "<title>Narrateurs</title>").replace("'llm-voice-ecoute'", "'llm-voice-ecoute-narrateurs'"), encoding="utf-8")
    print(json.dumps({"candidates": len(candidates), "selected": [row[0]["id"] for row in selected], "errors": bench.errors}, ensure_ascii=False))
    return 1 if bench.errors else 0


if __name__ == "__main__":
    sys.exit(main())
