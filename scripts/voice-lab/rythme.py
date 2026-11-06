#!/usr/bin/env python3
"""Rythme natif de Kyutai 1.6B : `padding_bonus` et `padding_between`, même voix, même texte.

Deux temps : `gen` dans le conteneur GPU, `page` avec le Python du banc. Les mesures disent ce qui
change ; l'oreille dit si c'est mieux. Mode jeu : arrêt propre avant chaque génération.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
VOICE = "cml-tts/fr/577_394"
VARIANTS = [("reference", 0.0, 1), ("bonus-moins-2", -2.0, 1), ("bonus-moins-1", -1.0, 1), ("bonus-plus-1", 1.0, 1), ("bonus-plus-2", 2.0, 1), ("bonus-plus-3", 3.0, 1), ("mots-0", 0.0, 0), ("mots-2", 0.0, 2), ("mots-3", 0.0, 3)]
LABELS = {"reference": "Réglage actuel", "bonus-moins-2": "Nettement plus vif", "bonus-moins-1": "Plus vif", "bonus-plus-1": "Plus posé", "bonus-plus-2": "Nettement plus posé", "bonus-plus-3": "Très posé", "mots-0": "Sans espacement forcé des mots", "mots-2": "Mots plus détachés", "mots-3": "Mots très détachés"}


def texts() -> dict[str, str]:
    sys.path.insert(0, str(HERE))
    import corpus

    return {k: v for k, v in corpus.load(ROOT / "docs/essais-voix/04-documents.md").lines if k in ("recit", "documentation")}


def generate(lab: Path) -> int:
    import numpy as np
    import torch
    from moshi.models.loaders import CheckpointInfo
    from moshi.models.tts import DEFAULT_DSM_TTS_REPO, TTSModel

    runtime = os.environ.get("XDG_RUNTIME_DIR", "")
    flag = Path(runtime, "gpu-yield", "active")
    out = lab / "out" / "rythme"
    out.mkdir(parents=True, exist_ok=True)
    voice = next((Path(os.environ["HF_HOME"]) / "hub/models--kyutai--tts-voices/snapshots").glob(f"*/{VOICE}_*_enhanced.wav.1e68beda@240.safetensors"))
    info = CheckpointInfo.from_hf_repo(DEFAULT_DSM_TTS_REPO)
    model = TTSModel.from_checkpoint_info(info, n_q=32, temp=0.6, device="cuda")
    for kind, text in texts().items():
        for name, bonus, between in VARIANTS:
            target = out / f"{kind}-{name}.wav"
            if target.exists():
                continue
            if flag.exists():
                print("mode jeu : arrêt", file=sys.stderr)
                return 75
            model.padding_bonus = bonus
            begin = time.monotonic()
            entries = model.prepare_script([text], padding_between=between)
            conditions = model.make_condition_attributes([voice], cfg_coef=2.0)
            result = model.generate([entries], [conditions])
            with model.mimi.streaming(1), torch.no_grad():
                pcms = [np.clip(model.mimi.decode(frame[:, 1:, :]).cpu().numpy()[0, 0], -1, 1) for frame in result.frames[model.delay_steps:]]
            samples = np.concatenate(pcms, axis=-1)
            with wave.open(str(target), "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(int(model.mimi.sample_rate))
                handle.writeframes((samples * 32767).astype("<i2").tobytes())
            print(json.dumps({"id": target.stem, "s": round(time.monotonic() - begin, 1), "audio_s": round(len(samples) / model.mimi.sample_rate, 2)}), flush=True)
    return 0


def page(lab: Path, out_dir: Path) -> int:
    sys.path.insert(0, str(HERE))
    import audio
    import lab as bench_lab

    (out_dir / "wav").mkdir(parents=True, exist_ok=True)
    bench = bench_lab.Bench("http://127.0.0.1:0", out_dir, bench_lab.Transcriber(True, "small"))
    all_texts = texts()
    rows = []
    for kind, text in all_texts.items():
        for name, bonus, between in VARIANTS:
            wav = lab / "out" / "rythme" / f"{kind}-{name}.wav"
            if not wav.exists():
                bench.errors.append(f"{wav.stem} absent")
                continue
            words = len(audio.normalize_words(text))
            pcm = audio.parse_wav(wav.read_bytes())
            bench.add("Récit" if kind == "recit" else "Texte technique", wav.stem, LABELS[name], text, pcm, None, f"padding_bonus {bonus}, padding_between {between}, {words / (len(pcm.samples) / pcm.rate):.2f} mots par seconde")
            rows.append({"id": wav.stem, "bonus": bonus, "between": between, "wps": round(words / (len(pcm.samples) / pcm.rate), 2), "wer": bench.items[-1].get("wer"), "pauses": bench.items[-1]["measures"]["pause_count"], "pause_s": bench.items[-1]["measures"]["pause_total_s"]})
    (out_dir / "results.json").write_text(json.dumps({"items": bench.items, "rows": rows, "errors": bench.errors}, ensure_ascii=False, indent=1), encoding="utf-8")
    html = bench_lab.render_page(bench.items, {"Récit": ["Même voix (Camille), même texte. Seul le rythme natif du moteur change."]}, out_dir)
    (out_dir / "index.html").write_text(html.replace("<title>Écoute des voix</title>", "<title>Rythme de Camille</title>").replace("'llm-voice-ecoute'", "'llm-voice-ecoute-rythme'"), encoding="utf-8")
    print(json.dumps(rows, ensure_ascii=False))
    return 1 if bench.errors else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("step", choices=("gen", "page"))
    parser.add_argument("--lab", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    sys.exit(generate(args.lab) if args.step == "gen" else page(args.lab, args.out))
