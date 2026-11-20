#!/usr/bin/env python3
"""Banc d'écoute : textes de docs/essais-voix joués par le serveur Pocket TTS local.

Écrit une page d'écoute et results.json. Le code de sortie ne juge que la validité de l'audio :
la qualité se juge à l'oreille. Aucune requête ne sort de la machine.
"""
from __future__ import annotations

import argparse
import base64
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import audio
import corpus

ROOT = Path(__file__).resolve().parents[2]
TECH_VOICES = ("estelle", "marius")
TONE_VOICES = ("estelle", "charles")
REGION_VOICES = ("estelle", "marius", "vera")
TEMPERATURES = (0.4, 1.0)
TEMPOS = (0.85, 1.15)


def licensed_voices(root: Path = ROOT) -> set[str]:
    source = (root / "vscode-extension/src/tts/kyutaiVoiceCatalog.ts").read_text(encoding="utf-8")
    return set(re.findall(r'^\s*(?:voice|vctk|voiceZero)\("([a-z_]+)"', source, flags=re.M))


def loopback_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost"):
        raise ValueError(f"serveur local exigé : {url}")
    return url.rstrip("/")


def synthesize(base: str, text: str, voice: str, timeout: int = 180) -> tuple[audio.Pcm, float]:
    boundary = uuid.uuid4().hex
    fields = {"text": text, "voice_url": voice}
    body = "".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n' for key, value in fields.items())
    request = urllib.request.Request(
        f"{base}/tts", data=(body + f"--{boundary}--\r\n").encode(), headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = response.read()
    return audio.parse_wav(data), time.monotonic() - started


class Transcriber:
    def __init__(self, enabled: bool, model: str) -> None:
        self.model = None
        if enabled:
            from faster_whisper import WhisperModel

            self.model = WhisperModel(model, device="cpu", compute_type="int8")

    def __call__(self, path: Path) -> str | None:
        if self.model is None:
            return None
        segments, _ = self.model.transcribe(str(path), language="fr", vad_filter=True, beam_size=1)
        return " ".join(segment.text.strip() for segment in segments)


class Bench:
    def __init__(self, base: str, out: Path, transcribe: Transcriber) -> None:
        self.base, self.out, self.transcribe = base, out, transcribe
        self.items: list[dict] = []
        self.errors: list[str] = []

    def add(self, section: str, item_id: str, title: str, text: str, pcm: audio.Pcm, seconds: float | None, note: str = "", check: str | None = None) -> None:
        wav = self.out / f"{item_id}.wav"
        audio.write_wav(wav, pcm)
        measures = audio.measure(pcm)
        if measures.speech_ratio <= 0:
            self.errors.append(f"{item_id} : audio silencieux")
        heard = self.transcribe(wav)
        item = {"section": section, "id": item_id, "title": title, "text": text, "file": f"{item_id}.ogg", "measures": measures.as_dict(), "note": note}
        if seconds is not None:
            item["synth_s"] = round(seconds, 2)
        if heard is not None:
            item["heard"] = heard
            item["wer"] = round(audio.word_error_rate(check or text, heard), 3)
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(wav), "-c:a", "libopus", "-b:a", "48k", str(self.out / item["file"])], check=True)
        wav.replace(self.out / "wav" / wav.name)
        self.items.append(item)

    def say(self, section: str, item_id: str, title: str, text: str, voice: str, note: str = "", base: str | None = None, check: str | None = None) -> audio.Pcm | None:
        try:
            pcm, seconds = synthesize(base or self.base, text, voice)
        except (OSError, ValueError, urllib.error.URLError) as error:
            self.errors.append(f"{item_id} : {error}")
            return None
        self.add(section, item_id, title, text, pcm, seconds, note, check)
        return pcm


def technical(bench: Bench, text: corpus.Text) -> None:
    for number, word in enumerate(text.words):
        for voice in TECH_VOICES:
            slug = f"mot{number:02d}-{voice}"
            bench.say("Mots techniques", f"{slug}-brut", f"{word.word} · {voice} · tel quel", word.raw(), voice)
            bench.say("Mots techniques", f"{slug}-phon", f"{word.word} · {voice} · phonétique", word.phonetic(), voice, f"écrit : {word.respelled}", check=word.raw())


def tones(bench: Bench, text: corpus.Text) -> None:
    for voice in TONE_VOICES:
        for style, line in text.lines:
            bench.say("Ton et style", f"ton-{voice}-{style}", f"{style} · {voice}", line, voice)


def tempo(bench: Bench, text: corpus.Text) -> None:
    style, line = text.lines[0]
    pcm = bench.say("Vitesse", f"vitesse-{style}-1", "vitesse ×1", line, "estelle")
    if pcm is None:
        return
    source = bench.out / "wav" / f"vitesse-{style}-1.wav"
    for factor in TEMPOS:
        target = bench.out / f"tmp-{factor}.wav"
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(source), "-filter:a", f"atempo={factor}", str(target)], check=True)
        bench.add("Vitesse", f"vitesse-{str(factor).replace('.', '_')}", f"vitesse ×{factor}", line, audio.parse_wav(target.read_bytes()), None, "accéléré après synthèse, hauteur conservée")
        target.replace(bench.out / "wav" / target.name)


def scene(bench: Bench, text: corpus.Text) -> list[str]:
    parts: list[audio.Pcm] = []
    pitches: dict[str, list[float]] = {}
    started = time.monotonic()
    for index, (who, line) in enumerate(text.lines):
        voice = text.cast[who]
        try:
            pcm, _ = synthesize(bench.base, line, voice)
        except (OSError, ValueError, urllib.error.URLError) as error:
            bench.errors.append(f"scène {index} {who} : {error}")
            continue
        parts.append(pcm)
        pitches.setdefault(f"{who} ({voice})", []).append(audio.measure(pcm).pitch_hz)
    if not parts:
        return []
    bench.add("Personnages", "scene", "Scène à plusieurs voix", " ".join(line for _, line in text.lines), audio.concat(parts), time.monotonic() - started, "chaque réplique est synthétisée à part, puis assemblée")
    return [f"{who} : hauteur {sum(values) / len(values):.0f} Hz" for who, values in pitches.items()]


def documents(bench: Bench, text: corpus.Text) -> None:
    for kind, line in text.lines:
        bench.say("Passages longs", f"doc-{kind}", f"{kind} · estelle", line, "estelle")


def regions(bench: Bench, text: corpus.Text) -> None:
    for region, line in text.lines:
        for voice in REGION_VOICES:
            bench.say("Francophonies", f"region-{region}-{voice}", f"{region} · {voice}", line, voice, "aucune de ces voix n'a d'accent régional documenté")


def temperatures(bench: Bench, text: corpus.Text, command: list[str]) -> None:
    """Seule la commande `generate` expose la température : le serveur n'a pas cette option."""
    line = text.lines[0][1]
    for value in TEMPERATURES:
        label = str(value).replace(".", "_")
        target = bench.out / f"tmp-temp-{label}.wav"
        started = time.monotonic()
        try:
            subprocess.run(
                [*command, "generate", "--language", "french", "--voice", "estelle", "--text", line, "--temperature", str(value), "--output-path", str(target)],
                check=True, capture_output=True, timeout=300,
            )
            pcm = audio.parse_wav(target.read_bytes())
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            bench.errors.append(f"température {value} : {error}")
            continue
        bench.add("Température", f"temp-{label}", f"température {value} · estelle", line, pcm, time.monotonic() - started, "commande generate, temps de chargement du modèle compris ; le serveur n'a pas ce réglage")
        target.replace(bench.out / "wav" / target.name)


STYLE = """
:root{--bg:#fff;--fg:#1f1f1f;--muted:#616161;--line:#d9d9d9;--panel:#f6f6f6;--accent:#005fb8}
@media (prefers-color-scheme:dark){:root{--bg:#1e1e1e;--fg:#e8e8e8;--muted:#a8a8a8;--line:#3c3c3c;--panel:#252526;--accent:#4daafc}}
*{box-sizing:border-box}body{margin:0;padding:24px 16px 64px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:960px;margin:auto}h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px}p{margin:4px 0;color:var(--muted)}
.item{padding:12px;margin:8px 0;background:var(--panel);border:1px solid var(--line);border-radius:4px}.item h3{font-size:15px;margin:0 0 6px}
audio{width:100%;height:34px}.text{color:var(--fg);margin:6px 0}.meta{font-size:13px;color:var(--muted)}
.rate{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;align-items:center}button{flex:0 0 auto;height:26px;padding:0 10px;font:inherit;font-size:13px;white-space:nowrap;cursor:pointer;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:3px}
button[aria-pressed=true]{color:#fff;background:var(--accent);border-color:var(--accent)}input{flex:1 1 200px;min-width:0;height:26px;padding:0 6px;font:inherit;font-size:13px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:3px}
textarea{width:100%;height:120px;margin-top:8px;font:13px monospace;color:var(--fg);background:var(--panel);border:1px solid var(--line)}
.bar{position:sticky;top:0;padding:8px 0;background:var(--bg);border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
"""

SCRIPT = """
const KEY='llm-voice-ecoute';let notes={};try{notes=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(notes))}catch(e){}refresh()}
function refresh(){const out=document.getElementById('out');out.value=Object.entries(notes).filter(([,n])=>n.r||n.c).map(([id,n])=>id+' | '+(n.r||'-')+'/5 | '+(n.c||'')).join('\\n');document.getElementById('count').textContent=out.value?out.value.split('\\n').length+' note(s)':'aucune note'}
document.querySelectorAll('.item').forEach(el=>{const id=el.dataset.id;const n=notes[id]||{};const input=el.querySelector('input');input.value=n.c||'';
el.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-pressed',String(Number(b.textContent)===n.r));b.addEventListener('click',()=>{const m=notes[id]||(notes[id]={});m.r=Number(b.textContent);el.querySelectorAll('button').forEach(o=>o.setAttribute('aria-pressed',String(o===b)));save()})});
input.addEventListener('input',()=>{(notes[id]||(notes[id]={})).c=input.value;save()})});
document.getElementById('copy').addEventListener('click',()=>{const o=document.getElementById('out');o.select();navigator.clipboard&&navigator.clipboard.writeText(o.value)});refresh();
"""


def audio_source(item: dict, audio_dir: Path | None) -> str:
    """Audio dans la page : Firefox en Flatpak ne voit que le fichier ouvert, pas ses voisins."""
    if audio_dir is None:
        return item["file"]
    encoded = base64.b64encode((audio_dir / item["file"]).read_bytes()).decode("ascii")
    return f"data:audio/ogg;base64,{encoded}"


def render_page(items: list[dict], summary: dict, audio_dir: Path | None = None) -> str:
    esc = html.escape
    parts = ["<!doctype html><html lang=fr><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Écoute des voix</title><style>", STYLE, "</style></head><body><main>",
             "<h1>Écoute des voix</h1><p>Note de 1 à 5 et commente, puis copie tes notes et colle-les à Claude. Rien ne se lit tout seul et rien ne sort de cette page.</p><p>Les mesures sont indicatives : la hauteur peut se tromper d'une octave, et la transcription juge mal les mots techniques et les régionalismes.</p>",
             "<div class=bar><button id=copy type=button>Copier mes notes</button><span id=count class=meta></span></div>"]
    section = None
    for item in items:
        if item["section"] != section:
            section = item["section"]
            parts.append(f"<h2>{esc(section)}</h2>")
            for line in summary.get(section, []):
                parts.append(f"<p>{esc(line)}</p>")
        m = item["measures"]
        meta = []
        if m:
            meta.append(f"{m['duration_s']} s, hauteur {m['pitch_hz']} Hz ±{m['pitch_spread_hz']}, {m['pause_count']} pauses")
        if "synth_s" in item:
            meta.append(f"généré en {item['synth_s']} s")
        if "wer" in item:
            meta.append(f"erreurs de transcription {round(item['wer'] * 100)} %")
        parts.append(f"<div class=item data-id='{esc(item['id'], quote=True)}'><h3>{esc(item['title'])}</h3><audio controls preload=\"none\" src='{esc(audio_source(item, audio_dir), quote=True)}'></audio><div class=text>{esc(item['text'])}</div>")
        if item.get("note"):
            parts.append(f"<div class=meta>{esc(item['note'])}</div>")
        if item.get("heard"):
            parts.append(f"<div class=meta>Compris par la transcription : {esc(item['heard'])}</div>")
        parts.append(f"<div class=meta>{esc(' · '.join(meta))}</div><div class=rate>" + "".join(f"<button type=button>{n}</button>" for n in range(1, 6)) + "<input aria-label='Commentaire' placeholder='Commentaire'></div></div>")
    parts.append("<h2>Mes notes</h2><textarea id=out readonly aria-label='Notes à copier'></textarea></main><script>" + SCRIPT + "</script></body></html>")
    return "".join(parts)


def spread(values: list[float]) -> float:
    return round(max(values) - min(values), 2) if values else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default="http://127.0.0.1:8000")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--whisper-model", default="small")
    parser.add_argument("--no-transcribe", action="store_true")
    parser.add_argument("--no-temperature", action="store_true")
    parser.add_argument("--pocket-tts", default=shutil.which("pocket-tts") or "pocket-tts")
    parser.add_argument("--only-temperature", action="store_true", help="ajoute la température aux résultats existants")
    args = parser.parse_args()
    runtime = os.environ.get("XDG_RUNTIME_DIR", "")
    if runtime and Path(runtime, "gpu-yield", "active").exists():
        print("voice-lab : mode jeu actif, banc différé", file=sys.stderr)
        return 75
    base = loopback_url(args.server)
    urllib.request.urlopen(f"{base}/health", timeout=5).read()
    allowed = licensed_voices()
    folder = ROOT / "docs" / "essais-voix"
    texts = {name: corpus.load(folder / f"{name}.md") for name in ("01-mots-techniques", "02-ton-et-style", "03-personnages", "04-documents", "05-francophonies")}
    used = set(TECH_VOICES) | set(TONE_VOICES) | set(REGION_VOICES) | set(texts["03-personnages"].cast.values())
    if not used <= allowed:
        print(f"voix hors catalogue : {sorted(used - allowed)}", file=sys.stderr)
        return 2
    (args.out / "wav").mkdir(parents=True, exist_ok=True)
    bench = Bench(base, args.out, Transcriber(not args.no_transcribe, args.whisper_model))
    started = time.monotonic()
    if args.only_temperature:
        previous = json.loads((args.out / "results.json").read_text(encoding="utf-8"))
        temperatures(bench, texts["02-ton-et-style"], [args.pocket_tts])
        previous["items"] = [item for item in previous["items"] if item["section"] != "Température"] + bench.items
        previous["errors"] = [error for error in previous["errors"] if not error.startswith("température")] + bench.errors
        previous["count"] = len(previous["items"])
        (args.out / "results.json").write_text(json.dumps(previous, ensure_ascii=False, indent=1), encoding="utf-8")
        (args.out / "index.html").write_text(render_page(previous["items"], previous["summary"], args.out), encoding="utf-8")
        print(json.dumps({"errors": previous["errors"], "added": bench.items}, ensure_ascii=False)[:1500])
        return 1 if previous["errors"] else 0
    tones(bench, texts["02-ton-et-style"])
    tempo(bench, texts["02-ton-et-style"])
    cast = scene(bench, texts["03-personnages"])
    technical(bench, texts["01-mots-techniques"])
    documents(bench, texts["04-documents"])
    regions(bench, texts["05-francophonies"])
    if not args.no_temperature:
        temperatures(bench, texts["02-ton-et-style"], [args.pocket_tts])
    summary: dict[str, list[str]] = {"Personnages": cast}
    by_voice: dict[str, list[dict]] = {}
    for item in bench.items:
        if item["section"] == "Ton et style":
            by_voice.setdefault(item["id"].split("-")[1], []).append(item["measures"])
    tone_lines = [
        f"{voice} : écart entre styles de {spread([m['duration_s'] for m in rows])} s, {spread([m['pitch_hz'] for m in rows])} Hz de hauteur, {spread([m['pitch_spread_hz'] for m in rows])} Hz de variation, {spread([m['pause_count'] for m in rows])} pauses"
        for voice, rows in by_voice.items()
    ]
    summary["Ton et style"] = tone_lines
    technical_rows = [item for item in bench.items if item["section"] == "Mots techniques" and "wer" in item]
    result = {"items": bench.items, "summary": summary, "errors": bench.errors, "elapsed_s": round(time.monotonic() - started, 1), "count": len(bench.items)}
    if technical_rows:
        for kind in ("brut", "phon"):
            rows = [item["wer"] for item in technical_rows if item["id"].endswith(kind)]
            if rows:
                result[f"wer_mots_{kind}"] = round(sum(rows) / len(rows), 3)
    (args.out / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    (args.out / "index.html").write_text(render_page(bench.items, summary, args.out), encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key != "items"}, ensure_ascii=False, indent=1))
    return 1 if bench.errors else 0


if __name__ == "__main__":
    sys.exit(main())
