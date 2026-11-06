#!/usr/bin/env python3
"""Compare les voix de narration déclarées France : Piper fr_FR et Estelle.

Usage : france.py --out <dossier>. Télécharge les modèles Piper une fois depuis Hugging Face,
hors de l'extension, puis génère localement. La licence de chaque modèle figure sur la page.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

import audio
import lab

BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR"
MODELS = {
    "siwis-medium": ("siwis/medium", [None], "CC BY 4.0"),
    "gilles-low": ("gilles/low", [None], "CC0"),
    "tom-medium": ("tom/medium", [None], "AGPLv3, à examiner avant toute intégration"),
    "upmc-medium": ("upmc/medium", [0, 1], "CC BY-SA 4.0"),
    "mls_1840-low": ("mls_1840/low", [None], "CC BY 4.0"),
    "mls-medium": ("mls/medium", [0, 18, 37, 56, 75, 94, 113], "CC BY 4.0, 125 locuteurs"),
}
ROOT = Path(__file__).resolve().parents[2]


def fetch(models_dir: Path, name: str, folder: str) -> Path:
    onnx = models_dir / f"fr_FR-{name}.onnx"
    for target in (onnx, Path(f"{onnx}.json")):
        if not target.exists():
            url = f"{BASE}/{folder}/{target.name}"
            print("téléchargement", url, flush=True)
            partial = Path(f"{target}.part")
            with urllib.request.urlopen(url, timeout=300) as response, partial.open("wb") as out:
                while chunk := response.read(1 << 20):
                    out.write(chunk)
            partial.replace(target)
    return onnx


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--models", type=Path, default=Path.home() / ".llm-voice/voices-lab")
    parser.add_argument("--piper", type=Path, default=Path.home() / ".config/Code/User/globalStorage/guilhem-bonnet.llm-voice/piper/bin/piper")
    parser.add_argument("--server", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    (args.out / "wav").mkdir(parents=True, exist_ok=True)
    args.models.mkdir(parents=True, exist_ok=True)
    texts = dict(lab.corpus.load(ROOT / "docs/essais-voix/04-documents.md").lines)
    samples = {"recit": texts["recit"], "documentation": texts["documentation"]}
    bench = lab.Bench(lab.loopback_url(args.server), args.out, lab.Transcriber(False, "small"))
    env = {**os.environ, "LD_LIBRARY_PATH": str(args.piper.parent)}
    for kind, text in samples.items():
        bench.say("Référence Kyutai", f"estelle-{kind}", f"Estelle · {kind}", text, "estelle", "Kyutai, enregistrement français, CC0")
    for name, (folder, speakers, licence) in MODELS.items():
        try:
            onnx = fetch(args.models, name, folder)
        except OSError as error:
            bench.errors.append(f"{name} : {error}")
            continue
        for speaker in speakers:
            label = name if speaker is None else f"{name} locuteur {speaker}"
            slug = label.replace(" ", "-").replace("_", "-")
            for kind, text in samples.items():
                target = args.out / f"tmp-{slug}-{kind}.wav"
                command = [str(args.piper), "--model", str(onnx), "--output_file", str(target)]
                if speaker is not None:
                    command += ["--speaker", str(speaker)]
                try:
                    subprocess.run(command, input=text.encode(), env=env, check=True, capture_output=True, timeout=240)
                    pcm = audio.parse_wav(target.read_bytes())
                except (OSError, ValueError, subprocess.SubprocessError) as error:
                    bench.errors.append(f"{label} : {error}")
                    continue
                bench.add("Piper, France", f"{slug}-{kind}", f"{label} · {kind}", text, pcm, None, f"licence : {licence} ; accent non vérifié au-delà du code fr_FR")
                target.replace(args.out / "wav" / target.name)
    (args.out / "results.json").write_text(json.dumps({"items": bench.items, "errors": bench.errors}, ensure_ascii=False, indent=1), encoding="utf-8")
    (args.out / "index.html").write_text(lab.render_page(bench.items, {}).replace("<title>Écoute des voix</title>", "<title>Voix de France</title>").replace("llm-voice-ecoute", "llm-voice-ecoute-france"), encoding="utf-8")
    print(json.dumps({"count": len(bench.items), "errors": bench.errors}, ensure_ascii=False))
    return 1 if bench.errors else 0


if __name__ == "__main__":
    sys.exit(main())
