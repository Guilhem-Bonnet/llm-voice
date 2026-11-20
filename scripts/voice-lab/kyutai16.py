#!/usr/bin/env python3
"""Banc Kyutai TTS 1.6B (en_fr) : voix françaises précalculées de CML-TTS et voix Estelle.

Trois étapes, car la génération (torch + moshi, CPU ou GPU ROCm en conteneur) et la transcription
(faster-whisper, audio-proof-venv) n'ont pas les mêmes dépendances :

  gen     génère les WAV bruts (venv moshi ou conteneur) ; reprenable, un verrou par tâche
  select  transcrit la phrase courte, garde 12 voix (6 graves, 6 aiguës) -> selection.json
  page    assemble results.json et la page d'écoute autonome (lab.Bench, lab.render_page)

Aucun texte ne sort de la machine : le mode hors ligne de Hugging Face est exigé pour `gen`.
Le code de sortie ne juge que la validité de l'audio ; la qualité se juge à l'oreille.
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
SHORT = "La pluie avait cessé peu avant l'aube. Sur le quai, le vieux gardien rangeait ses cordages sans se presser, comme il le faisait depuis quarante ans."
DOC_KINDS = ("recit", "documentation")
ESTELLE = "unmute-prod-website/developpeuse-3.wav.1e68beda@240.safetensors"
CML = "cml-tts/fr/"
CML_SUFFIX = "_enhanced.wav.1e68beda@240.safetensors"


def voice_files(hub: Path) -> dict[str, Path]:
    """Voix disponibles dans le cache local : identifiant court -> fichier safetensors."""
    voices: dict[str, Path] = {}
    for snapshot in sorted((hub / "models--kyutai--tts-voices" / "snapshots").iterdir()):
        estelle = snapshot / ESTELLE
        if estelle.exists():
            voices["estelle"] = estelle
        for path in sorted((snapshot / CML).glob(f"*{CML_SUFFIX}")):
            speaker = "_".join(path.name.split("_")[:2])
            voices[f"cml-{speaker}"] = path
    return voices


def doc_texts() -> dict[str, str]:
    sys.path.insert(0, str(HERE))
    import corpus

    text = corpus.load(ROOT / "docs" / "essais-voix" / "04-documents.md")
    return {kind: line for kind, line in text.lines if kind in DOC_KINDS}


def jobs_for(stage: str, lab: Path, voices: dict[str, Path]) -> list[tuple[str, Path, str]]:
    extra = sorted((lab / "extra-voices").glob("*.safetensors")) if (lab / "extra-voices").exists() else []
    if stage == "extra":
        return [(f"court-x-{path.name.split('.')[0]}", path, SHORT) for path in extra]
    if stage == "extra-docs":
        chosen = json.loads((lab / "out" / "extra-selection.json").read_text(encoding="utf-8"))
        texts = doc_texts()
        by_name = {path.name.split(".")[0]: path for path in extra}
        return [(f"{kind}-x-{name}", by_name[name], texts[kind]) for kind in DOC_KINDS for name in chosen]
    if stage == "screen":
        return [(f"court-{name}", path, SHORT) for name, path in voices.items()]
    chosen = json.loads((lab / "out" / "selection.json").read_text(encoding="utf-8"))["selected"]
    texts = doc_texts()
    return [(f"{kind}-{name}", voices[name], texts[kind]) for kind in DOC_KINDS for name in chosen]


def write_wav(path: Path, samples, rate: int) -> None:
    import numpy as np

    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm.tobytes())


def command_gen(args: argparse.Namespace) -> int:
    runtime = os.environ.get("XDG_RUNTIME_DIR", "")
    if os.environ.get("HF_HUB_OFFLINE") != "1":
        print("kyutai16 : HF_HUB_OFFLINE=1 exigé (aucun accès réseau pendant la génération)", file=sys.stderr)
        return 2
    lab = Path(args.lab)
    out = lab / "out" / "raw"
    out.mkdir(parents=True, exist_ok=True)
    voices = voice_files(Path(os.environ["HF_HOME"]) / "hub")
    jobs = jobs_for(args.stage, lab, voices)
    if args.reverse:
        jobs.reverse()
    if args.limit:
        jobs = jobs[: args.limit]

    import numpy as np
    import torch
    from moshi.models.loaders import CheckpointInfo
    from moshi.models.tts import DEFAULT_DSM_TTS_REPO, TTSModel

    if args.threads:
        torch.set_num_threads(args.threads)
    device = args.device
    started = time.monotonic()
    info = CheckpointInfo.from_hf_repo(DEFAULT_DSM_TTS_REPO)
    model = TTSModel.from_checkpoint_info(info, n_q=32, temp=0.6, device=device)
    load_s = time.monotonic() - started
    print(f"modèle chargé en {load_s:.1f} s sur {device} ({torch.__version__}, hip={getattr(torch.version, 'hip', None)})", flush=True)
    for name, voice, text in jobs:
        target = out / f"{name}.wav"
        lock = out / f"{name}.lock"
        if target.exists():
            continue
        if runtime and Path(runtime, "gpu-yield", "active").exists():
            print("kyutai16 : mode jeu actif, génération interrompue", file=sys.stderr)
            return 75
        try:
            os.close(os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        except FileExistsError:
            continue
        frames_seen, first = 0, None
        begin = time.monotonic()

        def on_frame(frame) -> None:
            nonlocal frames_seen, first
            if (frame != -1).all():
                frames_seen += 1
                if first is None:
                    first = time.monotonic() - begin

        entries = model.prepare_script([text], padding_between=1)
        conditions = model.make_condition_attributes([voice], cfg_coef=2.0)
        result = model.generate([entries], [conditions], on_frame=on_frame)
        gen_s = time.monotonic() - begin
        with model.mimi.streaming(1), torch.no_grad():
            pcms = [np.clip(model.mimi.decode(frame[:, 1:, :]).cpu().numpy()[0, 0], -1, 1) for frame in result.frames[model.delay_steps :]]
        samples = np.concatenate(pcms, axis=-1)
        total_s = time.monotonic() - begin
        write_wav(target, samples, int(model.mimi.sample_rate))
        audio_s = len(samples) / model.mimi.sample_rate
        stats = {
            "id": name, "device": device, "gen_s": round(gen_s, 2), "total_s": round(total_s, 2), "audio_s": round(audio_s, 2),
            "rtf": round(total_s / audio_s, 2), "first_frame_s": None if first is None else round(first, 2), "load_s": round(load_s, 1),
        }
        if device.startswith("cuda"):
            stats["vram_peak_mb"] = round(torch.cuda.max_memory_allocated() / 2**20)
        (out / f"{name}.json").write_text(json.dumps(stats), encoding="utf-8")
        lock.unlink()
        print(json.dumps(stats), flush=True)
    return 0


def command_select(args: argparse.Namespace) -> int:
    sys.path.insert(0, str(HERE))
    import audio
    import lab

    out = Path(args.lab) / "out"
    transcribe = lab.Transcriber(True, args.whisper_model)
    rows = []
    for wav in sorted((out / "raw").glob("court-*.wav")):
        name = wav.stem.removeprefix("court-")
        pcm = audio.parse_wav(wav.read_bytes())
        heard = transcribe(wav)
        rows.append({"voice": name, "wer": round(audio.word_error_rate(SHORT, heard), 3), "pitch_hz": audio.measure(pcm).pitch_hz, "heard": heard})
    # Hauteur médiane mesurée (peut se tromper d'une octave) : on sépare en deux moitiés, sans en déduire de genre.
    rows.sort(key=lambda row: row["pitch_hz"])
    half = len(rows) // 2
    low, high = rows[:half], rows[half:]
    pick = lambda group: [row["voice"] for row in sorted(group, key=lambda row: (row["wer"], row["voice"]))[:6]]  # noqa: E731
    selected = pick(low) + pick(high)
    payload = {"selected": selected, "low": pick(low), "high": pick(high), "screening": rows, "pitch_split_hz": rows[half]["pitch_hz"] if rows else None}
    (out / "selection.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({key: payload[key] for key in ("selected", "pitch_split_hz")}, ensure_ascii=False), f"{len(rows)} voix évaluées")
    return 0


def read_stats(raw: Path, name: str) -> dict:
    path = raw / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def command_page(args: argparse.Namespace) -> int:
    sys.path.insert(0, str(HERE))
    import audio
    import lab

    labdir = Path(args.lab) / "out"
    raw = labdir / "raw"
    selection = json.loads((labdir / "selection.json").read_text(encoding="utf-8"))
    by_voice = {row["voice"]: row for row in selection["screening"]}
    out = Path(args.out)
    (out / "wav").mkdir(parents=True, exist_ok=True)
    bench = lab.Bench("http://127.0.0.1:0", out, lab.Transcriber(True, args.whisper_model))
    texts = doc_texts()
    sections = (("Phrase courte", "court", SHORT), ("Récit", "recit", texts["recit"]), ("Documentation", "documentation", texts["documentation"]))
    started = time.monotonic()
    for section, prefix, text in sections:
        for name in selection["selected"]:
            wav = raw / f"{prefix}-{name}.wav"
            if not wav.exists():
                bench.errors.append(f"{prefix}-{name} : audio absent")
                continue
            stats = read_stats(raw, f"{prefix}-{name}")
            label = "estelle (voix Unmute)" if name == "estelle" else f"{name} (CML-TTS, CC BY 4.0)"
            note = f"{stats.get('device', '?')} : facteur temps réel {stats.get('rtf', '?')}, premier son après {stats.get('first_frame_s', '?')} s" + (f", VRAM crête {stats['vram_peak_mb']} Mo" if "vram_peak_mb" in stats else "")
            bench.add(section, f"{prefix}-{name}", f"{label}", text, audio.parse_wav(wav.read_bytes()), stats.get("total_s"), note)
    summary = {
        "Phrase courte": [
            f"Voix retenues parmi {len(selection['screening'])} : les 6 mieux comprises de chaque moitié de hauteur (coupure vers {round(selection['pitch_split_hz'] or 0)} Hz). Aucun genre n'est déduit.",
            "Voix graves : " + ", ".join(selection["low"]),
            "Voix aiguës : " + ", ".join(selection["high"]),
        ],
        "Récit": ["Kyutai TTS 1.6B en_fr, voix précalculées, température 0,6. Les voix CML-TTS sont CC BY 4.0, usage personnel à ce stade."],
    }
    rtfs = [item for item in (read_stats(raw, f"{p}-{n}") for _, p, _ in sections for n in selection["selected"]) if item]
    result = {
        "items": bench.items, "summary": summary, "errors": bench.errors, "elapsed_s": round(time.monotonic() - started, 1), "count": len(bench.items),
        "selected": selection["selected"], "screening": selection["screening"], "generation": [read_stats(raw, path.stem) for path in sorted(raw.glob("*.json"))],
        "rtf_mean": round(sum(item["rtf"] for item in rtfs) / len(rtfs), 2) if rtfs else None,
    }
    (out / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "index.html").write_text(lab.render_page(bench.items, summary, out), encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("errors", "count", "elapsed_s", "rtf_mean")}, ensure_ascii=False))
    return 1 if bench.errors else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lab", default=str(Path.home() / ".llm-voice/voices-lab/kyutai-1.6b"))
    sub = parser.add_subparsers(dest="command", required=True)
    gen = sub.add_parser("gen")
    gen.add_argument("--stage", choices=("screen", "docs", "extra", "extra-docs"), required=True)
    gen.add_argument("--device", default="cpu")
    gen.add_argument("--reverse", action="store_true", help="parcourt les tâches à l'envers (second travailleur)")
    gen.add_argument("--limit", type=int, default=0)
    gen.add_argument("--threads", type=int, default=0)
    sel = sub.add_parser("select")
    sel.add_argument("--whisper-model", default="small")
    page = sub.add_parser("page")
    page.add_argument("--out", type=Path, default=ROOT / "_grimoire-output/evidence/GAO-essais-voix-001/ecoute-kyutai16")
    page.add_argument("--whisper-model", default="small")
    args = parser.parse_args()
    return {"gen": command_gen, "select": command_select, "page": command_page}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
