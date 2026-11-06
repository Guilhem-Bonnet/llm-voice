#!/usr/bin/env python3
"""Cherche une voix « classique » pour Kyutai 1.6B : enregistrements Kyutai et dons de voix.

Écarte les voix non commerciales et de personnes identifiables. Ne juge que la compréhension ;
la voix se choisit à l'oreille. Usage : classique.py --out <dossier> --run <script gpu>.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

import audio
import lab

SUFFIX = ".1e68beda@240.safetensors"
RAW = "https://huggingface.co/kyutai/tts-voices/resolve/main"
API = "https://huggingface.co/api/models/kyutai/tts-voices"
UNMUTE_KEEP = ("default_voice.wav", "developer-1.mp3", "fabieng-enhanced-v2.wav")
NAMES = "Adèle Aimé Alma Basile Blanche Céleste Clément Colette Damien Delphine Édith Émile Flore Gaspard Hélène Irène Jean-Marc Jeanne Laure Léon Lucie Marcel Marthe Mathis Nina Octave Olivia Paul-Henri Pauline Philippe Rose Simon Solène Théo Valérie Victor".split()


def fetch(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    siblings = [entry["rfilename"] for entry in json.load(urllib.request.urlopen(API, timeout=30))["siblings"]]
    wanted = [f"unmute-prod-website/{name}{SUFFIX}" for name in UNMUTE_KEEP]
    wanted += [name for name in siblings if name.startswith("voice-donations/") and name.endswith("_enhanced.wav" + SUFFIX)]
    for name in wanted:
        target = folder / name.split("/")[-1].replace("fabieng-enhanced-v2", "kyutai_fabieng").replace("default_voice", "kyutai_default").replace("developer-1", "kyutai_developer")
        if name not in siblings or target.exists():
            continue
        partial = target.with_suffix(".part")
        with urllib.request.urlopen(f"{RAW}/{name}", timeout=120) as response, partial.open("wb") as out:
            out.write(response.read())
        partial.replace(target)


def run_gpu(script: str, stage: str) -> None:
    code = subprocess.run(["bash", script, stage, "--reverse"]).returncode
    if code not in (0,):
        raise SystemExit(f"génération {stage} interrompue, code {code}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--lab", type=Path, required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--keep", type=int, default=14)
    args = parser.parse_args()
    (args.out / "wav").mkdir(parents=True, exist_ok=True)
    fetch(args.lab / "extra-voices")
    run_gpu(args.run, "extra")
    raw = args.lab / "out" / "raw"
    transcribe = lab.Transcriber(True, "small")
    texts = dict(lab.corpus.load(lab.ROOT / "docs/essais-voix/04-documents.md").lines)
    short = next(line.split('"')[1] for line in (lab.ROOT / "scripts/voice-lab/kyutai16.py").read_text(encoding="utf-8").splitlines() if line.startswith("SHORT"))
    rows = []
    for wav in sorted(raw.glob("court-x-*.wav")):
        name = wav.stem[len("court-x-"):]
        heard = transcribe(wav) or ""
        pcm = audio.parse_wav(wav.read_bytes())
        rows.append({"name": name, "wer": audio.word_error_rate(short, heard), "measures": audio.measure(pcm).as_dict()})
    kept_kyutai = [row for row in rows if row["name"].startswith("kyutai_")]
    others = sorted((row for row in rows if not row["name"].startswith("kyutai_")), key=lambda row: (row["wer"], row["measures"]["pitch_spread_hz"]))
    low = [row for row in others if 0 < row["measures"]["pitch_hz"] < 165]
    high = [row for row in others if row["measures"]["pitch_hz"] >= 165]
    half = args.keep // 2
    selected = kept_kyutai + low[:half] + high[:half]
    (args.lab / "out" / "extra-selection.json").write_text(json.dumps([row["name"] for row in selected]), encoding="utf-8")
    (args.out / "screening.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    run_gpu(args.run, "extra-docs")
    bench = lab.Bench("http://127.0.0.1:0", args.out, lab.Transcriber(False, "small"))
    names = dict(zip((row["name"] for row in selected), NAMES))
    for row in selected:
        name, label = row["name"], names[row["name"]]
        source = "enregistrement Kyutai, CC0" if name.startswith("kyutai_") else f"don de voix « {name.replace('_enhanced', '').split('.')[0]} », CC0, langue non déclarée"
        for kind, text in (("court", short), ("recit", texts["recit"]), ("documentation", texts["documentation"])):
            wav = raw / f"{kind}-x-{name}.wav"
            if wav.exists():
                bench.add(label, f"{label}-{kind}".replace(" ", "-"), f"{label} · {kind}", text, audio.parse_wav(wav.read_bytes()), None, source)
    (args.out / "names.json").write_text(json.dumps(names, ensure_ascii=False, indent=1), encoding="utf-8")
    (args.out / "results.json").write_text(json.dumps({"items": bench.items, "errors": bench.errors, "screened": len(rows)}, ensure_ascii=False, indent=1), encoding="utf-8")
    page = lab.render_page(bench.items, {}, args.out)
    (args.out / "index.html").write_text(page.replace("<title>Écoute des voix</title>", "<title>Voix classiques</title>").replace("'llm-voice-ecoute'", "'llm-voice-ecoute-classique'"), encoding="utf-8")
    print(json.dumps({"screened": len(rows), "selected": names, "errors": bench.errors}, ensure_ascii=False))
    return 1 if bench.errors else 0


if __name__ == "__main__":
    sys.exit(main())
