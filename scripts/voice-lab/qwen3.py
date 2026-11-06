#!/usr/bin/env python3
"""Banc Qwen3-TTS 12Hz 1.7B : six voix créées sur description (VoiceDesign), puis figées.

Trois étapes, car la génération (torch + qwen-tts, conteneur ROCm) et la transcription
(faster-whisper, audio-proof-venv) n'ont pas les mêmes dépendances :

  gen --stage probe    une phrase française courte, description en anglais puis en français
  gen --stage design   6 voix x 3 textes avec VoiceDesign, graine fixe (la voix est réinventée à chaque appel)
  gen --stage frozen   la voix de la phrase courte devient une amorce (modèle Base, create_voice_clone_prompt),
                       réutilisée pour les deux textes longs ; l'amorce est sauvée en .pt pour être servie
  page                 assemble results.json et la page d'écoute autonome (lab.Bench, lab.render_page)

Aucun texte ne sort de la machine : le mode hors ligne de Hugging Face est exigé pour `gen`.
Le mode jeu (`$XDG_RUNTIME_DIR/gpu-yield/active`) est vérifié avant le chargement et avant chaque génération.
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
sys.path.insert(0, str(HERE))
from kyutai16 import DOC_KINDS, SHORT, doc_texts  # noqa: E402

DESIGN_REPO = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
BASE_REPO = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
SEED = 20261106
ACCENT = "Native French speaker with a standard metropolitan France accent (no regional or foreign accent)."
# Descriptions traduites en anglais : la carte ne documente des instructions qu'en chinois et en anglais.
VOICES = {
    "grave-1": "Deep, composed male voice with crisp, clear diction. Neutral and calm assistant tone.",
    "grave-2": "Baritone male voice, warm and precise, measured rhythm, with a slight distinction.",
    "grave-3": "Medium-pitched male voice, sober and professional, like someone reading documentation aloud.",
    "clair-1": "Clear, neutral female voice with crisp diction. Calm assistant tone.",
    "clair-2": "Medium-pitched female voice, warm and composed, without emphasis.",
    "clair-3": "Young, limpid female voice, professional, with a steady, regular rhythm.",
}
FR_PROBE = "Voix masculine grave et posée, élocution nette, ton neutre et calme d'assistant. Locuteur natif du français, accent français standard de France."


def description(name: str) -> str:
    return f"{VOICES[name]} {ACCENT}"


def write_wav(path: Path, samples, rate: int) -> None:
    import numpy as np

    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm.tobytes())


def vram_used_mb() -> int | None:
    for path in sorted(Path("/sys/class/drm").glob("card*/device/mem_info_vram_used")):
        try:
            return round(int(path.read_text()) / 2**20)
        except (OSError, ValueError):
            continue
    return None


def yielded() -> bool:
    runtime = os.environ.get("XDG_RUNTIME_DIR", "")
    return bool(runtime) and Path(runtime, "gpu-yield", "active").exists()


class Runner:
    """Un modèle chargé, des générations mesurées (temps, facteur temps réel, VRAM)."""

    def __init__(self, repo: str, device: str, out: Path) -> None:
        import torch
        from qwen_tts import Qwen3TTSModel

        self.torch, self.device, self.out, self.repo = torch, device, out, repo
        if yielded():
            raise SystemExit(75)
        self.vram_before = vram_used_mb()
        from huggingface_hub import snapshot_download

        # Chemin local du cache : transformers 4.57.3 interroge sinon l'API du Hub (model_info) même hors ligne.
        local = snapshot_download(repo, local_files_only=True)
        self.revision = Path(local).name
        started = time.monotonic()
        self.model = Qwen3TTSModel.from_pretrained(
            local, device_map=device, dtype=torch.bfloat16 if device.startswith("cuda") else torch.float32, attn_implementation="sdpa"
        )
        self.load_s = round(time.monotonic() - started, 1)
        print(f"{repo} chargé en {self.load_s} s sur {device} (torch {torch.__version__}, hip={getattr(torch.version, 'hip', None)})", flush=True)

    def record(self, name: str, wav, rate: int, begin: float, extra: dict) -> dict:
        torch = self.torch
        total_s = time.monotonic() - begin
        write_wav(self.out / f"{name}.wav", wav, rate)
        audio_s = len(wav) / rate
        stats = {
            "id": name, "repo": self.repo, "revision": self.revision, "device": self.device, "total_s": round(total_s, 2), "audio_s": round(audio_s, 2),
            "rtf": round(total_s / audio_s, 2), "first_frame_s": None, "load_s": self.load_s, "seed": SEED, **extra,
        }
        if self.device.startswith("cuda"):
            stats["vram_peak_alloc_mb"] = round(torch.cuda.max_memory_allocated() / 2**20)
            stats["vram_peak_reserved_mb"] = round(torch.cuda.max_memory_reserved() / 2**20)
            stats["vram_used_sysfs_mb"] = vram_used_mb()
        (self.out / f"{name}.json").write_text(json.dumps(stats), encoding="utf-8")
        print(json.dumps(stats), flush=True)
        return stats

    def design(self, name: str, text: str, instruct: str, extra: dict) -> None:
        if (self.out / f"{name}.json").exists():
            return
        if yielded():
            print("qwen3 : mode jeu actif, génération interrompue", file=sys.stderr)
            raise SystemExit(75)
        self.torch.manual_seed(SEED)
        if self.device.startswith("cuda"):
            self.torch.cuda.reset_peak_memory_stats()
        begin = time.monotonic()
        wavs, rate = self.model.generate_voice_design(text=text, language="French", instruct=instruct)
        self.record(name, wavs[0], rate, begin, extra)

    def clone(self, name: str, text: str, prompt, extra: dict) -> None:
        if (self.out / f"{name}.json").exists():
            return
        if yielded():
            print("qwen3 : mode jeu actif, génération interrompue", file=sys.stderr)
            raise SystemExit(75)
        self.torch.manual_seed(SEED)
        if self.device.startswith("cuda"):
            self.torch.cuda.reset_peak_memory_stats()
        begin = time.monotonic()
        wavs, rate = self.model.generate_voice_clone(text=text, language="French", voice_clone_prompt=prompt)
        self.record(name, wavs[0], rate, begin, extra)


def command_gen(args: argparse.Namespace) -> int:
    if os.environ.get("HF_HUB_OFFLINE") != "1":
        print("qwen3 : HF_HUB_OFFLINE=1 exigé (aucun accès réseau pendant la génération)", file=sys.stderr)
        return 2
    out = Path(args.lab) / "out" / "raw"
    out.mkdir(parents=True, exist_ok=True)
    texts = {"court": SHORT, **doc_texts()}
    if args.stage in ("probe", "design"):
        run = Runner(DESIGN_REPO, args.device, out)
        if args.stage == "probe":
            run.design("probe-en", SHORT, description("grave-1"), {"voice": "grave-1", "instruct_lang": "en"})
            run.design("probe-fr", SHORT, FR_PROBE, {"voice": "grave-1", "instruct_lang": "fr"})
        else:
            for kind in ("court", *DOC_KINDS):
                for name in VOICES:
                    run.design(f"design-{kind}-{name}", texts[kind], description(name), {"voice": name, "kind": kind, "mode": "design"})
        return 0
    # frozen : l'amorce vient de la voix de la phrase courte (déjà générée par VoiceDesign) ; le modèle Base la réutilise.
    import soundfile as sf

    run = Runner(BASE_REPO, args.device, out)
    prompts = Path(args.lab) / "out" / "prompts"
    prompts.mkdir(parents=True, exist_ok=True)
    similarity: dict[str, dict] = {}
    for name in VOICES:
        ref, rate = sf.read(out / f"design-court-{name}.wav", dtype="float32")
        started = time.monotonic()
        items = run.model.create_voice_clone_prompt(ref_audio=(ref, rate), ref_text=SHORT)
        prompt_s = round(time.monotonic() - started, 2)
        item = items[0]
        run.torch.save({key: getattr(item, key) for key in ("ref_code", "ref_spk_embedding", "x_vector_only_mode", "icl_mode", "ref_text")}, prompts / f"{name}.pt")
        for kind in DOC_KINDS:
            run.clone(f"frozen-{kind}-{name}", texts[kind], items, {"voice": name, "kind": kind, "mode": "frozen", "prompt_s": prompt_s})
        # Stabilité : empreinte vocale (x-vector du modèle Base) de chaque sortie, comparée à la voix de référence.
        embeddings = {}
        for label, path in [("ref", out / f"design-court-{name}.wav")] + [(f"design-{k}", out / f"design-{k}-{name}.wav") for k in DOC_KINDS] + [(f"frozen-{k}", out / f"frozen-{k}-{name}.wav") for k in DOC_KINDS]:
            if path.exists():
                wav, sr = sf.read(path, dtype="float32")
                embeddings[label] = run.model.create_voice_clone_prompt(ref_audio=(wav, sr), ref_text=None, x_vector_only_mode=True)[0].ref_spk_embedding.float().flatten()
        cos = lambda a, b: round(float(run.torch.nn.functional.cosine_similarity(a, b, dim=0)), 3)  # noqa: E731
        similarity[name] = {label: cos(embeddings["ref"], emb) for label, emb in embeddings.items() if label != "ref"}
        similarity[name]["design-recit_vs_design-documentation"] = cos(embeddings["design-recit"], embeddings["design-documentation"]) if {"design-recit", "design-documentation"} <= set(embeddings) else None
    (Path(args.lab) / "out" / "stability.json").write_text(json.dumps(similarity, indent=1), encoding="utf-8")
    print(json.dumps(similarity), flush=True)
    return 0


def read_stats(raw: Path, name: str) -> dict:
    path = raw / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def note_for(stats: dict) -> str:
    vram = stats.get("vram_peak_alloc_mb")
    return (
        f"{stats.get('device', '?')} : facteur temps réel {stats.get('rtf', '?')}, premier son non mesurable (génération non diffusée), "
        f"chargement {stats.get('load_s', '?')} s" + (f", VRAM crête {vram} Mo alloués ({stats.get('vram_peak_reserved_mb')} Mo réservés)" if vram else "")
    )


def command_page(args: argparse.Namespace) -> int:
    import audio
    import lab

    labdir = Path(args.lab) / "out"
    raw = labdir / "raw"
    out = Path(args.out)
    (out / "wav").mkdir(parents=True, exist_ok=True)
    bench = lab.Bench("http://127.0.0.1:0", out, lab.Transcriber(True, args.whisper_model))
    texts = {"court": SHORT, **doc_texts()}
    sections = [
        ("Phrase courte", "design", "court", "créée"),
        ("Récit, voix recréée à chaque texte", "design", "recit", "créée"),
        ("Récit, voix figée", "frozen", "recit", "figée"),
        ("Documentation, voix recréée à chaque texte", "design", "documentation", "créée"),
        ("Documentation, voix figée", "frozen", "documentation", "figée"),
    ]
    started = time.monotonic()
    for section, mode, kind, label in sections:
        for name in VOICES:
            item_id = f"{mode}-{kind}-{name}"
            wav = raw / f"{item_id}.wav"
            if not wav.exists():
                bench.errors.append(f"{item_id} : audio absent")
                continue
            stats = read_stats(raw, item_id)
            bench.add(section, item_id, f"{name} ({label})", texts[kind], audio.parse_wav(wav.read_bytes()), stats.get("total_s"), note_for(stats))
    for probe in ("probe-en", "probe-fr"):
        if (raw / f"{probe}.wav").exists():
            stats = read_stats(raw, probe)
            lang = "description en anglais" if probe == "probe-en" else "description en français"
            bench.add("Essai de la description", probe, f"grave-1, {lang}", SHORT, audio.parse_wav((raw / f"{probe}.wav").read_bytes()), stats.get("total_s"), note_for(stats))
    summary = {
        "Phrase courte": [
            "Voix créées sur description par Qwen3-TTS 12Hz 1.7B VoiceDesign (Apache-2.0), non clonées d'une personne réelle. Un prénom, s'il y en a un, reste à choisir.",
            "Descriptions traduites en anglais (la carte ne documente que le chinois et l'anglais), avec « accent français standard de France » ; graine fixe.",
            "grave-1 à grave-3 : voix masculines ; clair-1 à clair-3 : voix féminines.",
        ],
        "Récit, voix figée": ["Voix figée : la phrase courte sert d'amorce au modèle Base (create_voice_clone_prompt), réutilisée pour ce texte."],
    }
    gens = [read_stats(raw, path.stem) for path in sorted(raw.glob("*.json"))]
    rtfs = [g["rtf"] for g in gens if "rtf" in g]
    stability = json.loads((labdir / "stability.json").read_text(encoding="utf-8")) if (labdir / "stability.json").exists() else {}
    result = {
        "items": bench.items, "summary": summary, "errors": bench.errors, "elapsed_s": round(time.monotonic() - started, 1), "count": len(bench.items),
        "generation": gens, "stability": stability, "rtf_mean": round(sum(rtfs) / len(rtfs), 2) if rtfs else None,
        "descriptions": {name: description(name) for name in VOICES}, "seed": SEED, "repos": [DESIGN_REPO, BASE_REPO],
    }
    (out / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "index.html").write_text(lab.render_page(bench.items, summary, out), encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("errors", "count", "elapsed_s", "rtf_mean")}, ensure_ascii=False))
    return 1 if bench.errors else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lab", default=str(Path.home() / ".llm-voice/voices-lab/qwen3"))
    sub = parser.add_subparsers(dest="command", required=True)
    gen = sub.add_parser("gen")
    gen.add_argument("--stage", choices=("probe", "design", "frozen"), required=True)
    gen.add_argument("--device", default="cuda")
    page = sub.add_parser("page")
    page.add_argument("--out", type=Path, default=ROOT / "_grimoire-output/evidence/GAO-essais-voix-001/ecoute-qwen3")
    page.add_argument("--whisper-model", default="small")
    args = parser.parse_args()
    return {"gen": command_gen, "page": command_page}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
