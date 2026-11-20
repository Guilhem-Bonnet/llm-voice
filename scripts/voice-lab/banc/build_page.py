#!/usr/bin/env python3
"""Page d'écoute autonome (MP3 base64, mode sombre). Chaque extrait est encodé par ffmpeg puis vérifié par ffprobe
(décodage complet, durée à ±0,3 s du WAV). Usage : build_page.py <out_root> <evidence_dir> <page.html>
Lit dans <evidence_dir> : analysis.json, embeddings.json (facultatif), voix-filter.json (facultatif), page-notes.json."""
import base64, html, json, subprocess, sys, tempfile, wave
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent)); from common import items
root, ev, dst = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
A = json.loads((ev / "analysis.json").read_text())
EMB = json.loads((ev / "embeddings.json").read_text()) if (ev / "embeddings.json").exists() else {}
VF = json.loads((ev / "voix-filter.json").read_text()) if (ev / "voix-filter.json").exists() else {}
NOTES = json.loads((ev / "page-notes.json").read_text())
ENG = NOTES["engines"]  # [{id, label, licence}]
checks = []; n = 0
def mp3(wav):
    with wave.open(str(wav)) as w: d0 = w.getnframes() / w.getframerate()
    with tempfile.NamedTemporaryFile(suffix=".mp3") as t:
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(wav), "-codec:a", "libmp3lame", "-q:a", "4", t.name], check=True)
        d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", t.name], capture_output=True, text=True, check=True).stdout)
        dec = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", t.name, "-f", "null", "-"], capture_output=True, text=True)
        ok = dec.returncode == 0 and not dec.stderr.strip() and abs(d - d0) <= 0.3
        checks.append({"wav": str(wav.relative_to(root)), "wav_s": round(d0, 2), "mp3_s": round(d, 2), "decode_ok": dec.returncode == 0 and not dec.stderr.strip(), "ok": ok})
        return base64.b64encode(Path(t.name).read_bytes()).decode(), d
def e(x): return html.escape(str(x))
def clip(wav, label, key):
    global n; n += 1; b64, d = mp3(wav); a = A.get(key, {})
    m = f"WER {a.get('wer')} · fr {a.get('p_fr')} · en {a.get('p_en')} · {d:.1f} s" + (f" · RTF {a['rtf']}" if a.get("rtf") else "")
    if a.get("tag_words"): m += f" · <b class=warn>mots de balise : {e(', '.join(a['tag_words']))}</b>"
    return (f"<div class=clip><span class=num>{n}</span><div class=body><div class=lab>{label}</div>"
            f"<audio controls preload=none src='data:audio/mpeg;base64,{b64}'></audio><div class=meta>{m}</div>"
            f"<details><summary>transcription Whisper</summary>{e(a.get('transcript',''))}</details></div></div>")
def agg(eid):
    rows = [v for k, v in A.items() if v["engine"] == eid]
    if not rows: return None
    f = lambda k: [r[k] for r in rows if r.get(k) is not None]
    return {"n": len(rows), "wer_moy": round(sum(f("wer")) / len(rows), 3), "wer_max": max(f("wer")), "p_en_max": max(f("p_en")), "p_fr_min": min(f("p_fr")),
            "balises": sum(1 for r in rows if r["tag_words"]), "rtf_moy": round(sum(f("rtf")) / len(f("rtf")), 2) if f("rtf") else None,
            "vram": max(f("vram_peak_reserved_mb") or f("vram_card_peak_mb") or [0]) or None, "pause_max": max(f("max_gap_s") or [0])}
P = ["<!doctype html><html lang=fr><meta charset=utf-8><title>Banc d'écoute des moteurs — LLM Voice</title><style>",
     "body{background:#14161a;color:#e3e3e3;font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:auto;padding:1.5em}h1,h2,h3{color:#fff}",
     "table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #333;padding:4px 6px;text-align:left}th{background:#22252b}",
     ".clip{display:flex;gap:.8em;background:#1c1f24;border-radius:8px;padding:.6em;margin:.5em 0}.num{font-weight:700;color:#8ab4f8;min-width:2.2em}",
     ".body{flex:1}.lab{font-weight:600}.meta{font-size:12px;color:#aaa}.warn{color:#f28b82}audio{width:100%;height:36px}.txt{color:#ccc;font-style:italic}",
     "details{font-size:12px;color:#aaa}.box{background:#1c1f24;border-left:4px solid #8ab4f8;padding:.6em 1em;margin:1em 0}</style>",
     "<h1>Banc d'écoute des moteurs de voix — LLM Voice</h1>", f"<p>{NOTES['intro']}</p>",
     "<h2>Recommandation</h2>", f"<div class=box>{NOTES['recommendation']}</div>",
     "<h2>Récapitulatif des mesures</h2><table><tr><th>Moteur</th><th>Licence</th><th>Extraits</th><th>WER moyen</th><th>WER max</th><th>p(en) max</th><th>p(fr) min</th><th>Extraits avec mots de balise</th><th>RTF moyen</th><th>VRAM pointe (Mio)</th><th>Stabilité voix (cos moyen, sans états)</th><th>Plus longue pause (s)</th></tr>"]
for g in ENG:
    s = agg(g["id"]); st = EMB.get("stability", {}).get(g["id"], {})
    if s: P.append(f"<tr><td>{e(g['label'])}</td><td>{e(g['licence'])}</td><td>{s['n']}</td><td>{s['wer_moy']}</td><td>{s['wer_max']}</td><td>{s['p_en_max']}</td><td>{s['p_fr_min']}</td><td>{s['balises']}</td><td>{s['rtf_moy']}</td><td>{s['vram'] or '—'}</td><td>{st.get('cos_mean_sans_etats','—')}</td><td>{s['pause_max']}</td></tr>")
P.append("</table><p class=meta>" + NOTES.get("table_note", "") + "</p>")
if NOTES.get("not_run"):
    P.append("<h3>Moteurs non essayés ou en échec</h3><ul>" + "".join(f"<li><b>{e(x['label'])}</b> : {e(x['why'])}</li>" for x in NOTES["not_run"]) + "</ul>")
P.append("<h2>Comparaison à texte égal</h2>")
for it in items():
    P.append(f"<h3>{e(it['id'])} — {e(it.get('etat') or it['kind'])}</h3><p class=txt>« {e(it['text'])} »</p>")
    for g in ENG:
        w = root / g["id"] / f"{it['id']}.wav"
        if w.exists():
            meta = json.loads(w.with_suffix(".json").read_text())
            P.append(clip(w, f"{e(g['label'])} <span class=meta>— {e(meta.get('method',''))}</span>", f"{g['id']}/{it['id']}"))
if VF:
    P.append("<h2>Voix Qwen3 créées pour ce banc</h2>" + f"<p>{NOTES.get('voices_intro','')}</p>")
    ear = NOTES.get("ear_rejected", {})
    groups = (("Voix gardées (mesure et oreille)", [v for v in VF.get("kept", []) if v["id"] not in ear]),
              ("Gardées par la mesure, rejetées à l'oreille par l'utilisateur (archivées, remplacées par des variantes écoutées à part)", [dict(v, reason="rejetée à l'oreille ; " + v.get("reason", "")) for v in VF.get("kept", []) if v["id"] in ear]),
              ("Voix rejetées par le filtre (déplacées dans created-archive)", VF.get("rejected", [])))
    for title, group in groups:
        P.append(f"<h3>{title}</h3>")
        for v in group:
            P.append(f"<p><b>{e(v['name'])}</b> <span class=meta>({e(v['id'])}) — {e(v['description'])} — {e(v.get('reason',''))}</span></p>")
            for tid in VF.get("tests", []):
                w = root / "voix-candidates" / f"{v['id']}-{tid}.wav"
                if w.exists(): P.append(clip(w, f"{e(v['name'])} — {e(tid)}", f"voix-candidates/{v['id']}-{tid}"))
P.append(f"<p class=meta>{n} extraits, tous vérifiés par ffprobe à la construction.</p></html>")
dst.write_text("".join(P)); (ev / "page-check.json").write_text(json.dumps({"page": str(dst), "clips": n, "all_ok": all(c["ok"] for c in checks), "checks": checks}, ensure_ascii=False, indent=1))
print(dst, n, "extraits, tous OK" if all(c["ok"] for c in checks) else "ÉCHEC ffprobe : voir page-check.json")
