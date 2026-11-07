#!/usr/bin/env python3
"""Jeu d'acteur avec Kyutai 1.6B : que peut-on obtenir d'autre qu'un texte lu, avec seulement texte + voix ?

Trois temps : `gen` dans le conteneur GPU (`docker cp` de ce fichier, `python jeu.py gen --lab /tmp/jeu`),
`page` avec le Python du banc (mesures, transcription faster-whisper, page autonome).
Les mesures disent ce qui change dans le signal ; seule l'oreille dit si cela « sonne » comme voulu.
Mode jeu : arrêt propre (code 75) avant CHAQUE génération si `$XDG_RUNTIME_DIR/gpu-yield/active` existe.
Le fichier du catalogue ne dépend que de la bibliothèque standard : il tourne tel quel dans le conteneur.
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
VOICES = {"camille": ("Camille", "cml-tts/fr/577_394"), "mae": ("Maé (voix grave, la plus basse des voix mesurées)", "cml-tts/fr/4193_3103")}
REF = "J'ai couru depuis le pont. Le portail était fermé."
CONTEXT = "Il ouvrit le dossier et lut la dernière page. "
DEFAULT = {"bonus": 0.0, "between": 1, "cfg": 2.0, "temp": 0.6, "seed": 0}

GROUPS = {
    "A": ("A. Texte réécrit", "Même phrase de référence, écrite autrement (coupures, hachures, répétitions, pauses SSML). Écoute si le débit, les respirations, les hésitations changent, et si cela sonne essoufflé ou seulement lent."),
    "B": ("B. Sons écrits", "Des sons notés en lettres. Écoute surtout : est-ce un son (toux, rire, souffle) ou des syllabes prononcées ? La transcription dit seulement quels mots le modèle de reconnaissance a cru entendre."),
    "C": ("C. Ponctuation expressive", "Même phrase avec « ! », « ?! », capitales, absence de ponctuation. Écoute l'intensité, l'urgence, la hauteur."),
    "D": ("D. Paramètres du moteur", "Même phrase, une seule valeur de réglage modifiée à la fois (réf. : padding_bonus 0, padding_between 1, cfg_coef 2.0, température 0.6, graine 0). Écoute le rythme, la tension, la stabilité."),
    "E": ("E. Passages très courts", "Mots seuls, puis les mêmes mots précédés d'une phrase de contexte coupée ensuite (coupe approximative, au mot cible). Compare le naturel de l'attaque et de la fin."),
    "F": ("F. Autres graines, même voix", "Même texte, graines différentes. Écoute si les tirages se distinguent par l'état (plus tendu, plus souffle) et pas seulement par des détails."),
}


def p(**kw):
    return {**DEFAULT, **kw}


def catalog() -> list[dict]:
    items: list[dict] = []

    def add(group, key, title, listen, text, ctx="", **params):
        items.append({"group": group, "key": key, "title": title, "listen": listen, "text": text, "ctx": ctx, "params": p(**params)})

    # A. texte réécrit
    add("A", "ref", "Référence, texte simple", "Point de comparaison.", REF)
    add("A", "ellipses-mots", "Points de suspension après chaque mot", "Des pauses entre les mots, un souffle ?", "J'ai… couru… depuis… le pont. Le portail… était… fermé.")
    add("A", "ellipses-fin", "Trois points en fin de groupes", "Fin de phrase suspendue, voix qui retombe ?", "J'ai couru... depuis le pont... Le portail... était fermé...")
    add("A", "hache-repete", "Mots hachés et répétés", "Reprise de mots, hésitation.", "J'ai... j'ai couru. Depuis... depuis le pont. Le portail. Il était. Fermé.")
    add("A", "repetition", "Répétition « couru, couru, couru »", "Insistance, souffle entre les répétitions.", "J'ai couru, couru, couru depuis le pont. Le portail était... fermé.")
    add("A", "un-mot-par-phrase", "Un mot par phrase", "Voix saccadée.", "J'ai. Couru. Depuis. Le pont. Le portail. Était. Fermé.")
    add("A", "begaiement", "Mots bégayés « cou-couru »", "Bégaiement ou syllabes lues.", "J'ai cou-couru depuis le pont. Le por-portail était fer-fermé.")
    add("A", "parenthese-litterale", "« (essoufflé) » écrit devant", "Le moteur retire les parenthèses : le mot « essoufflé » est-il prononcé ?", "(essoufflé) " + REF)
    add("A", "break-ssml", "Pauses SSML <break time>", "Pauses de 0,5 s et 0,8 s demandées explicitement.", "J'ai couru <break time=\"0.5s\"/> depuis le pont. <break time=\"0.8s\"/> Le portail était fermé.")
    add("A", "break-court", "Pauses SSML courtes entre chaque mot", "Souffle, ou simple blanc ?", "J'ai <break time=\"0.3s\"/> couru <break time=\"0.3s\"/> depuis <break time=\"0.3s\"/> le pont. Le portail <break time=\"0.3s\"/> était fermé.")

    # B. sons écrits (seuls, puis dans la réplique)
    sounds = [("kof", "Kof kof", "Kof kof"), ("kof-p", "Kof, kof, kof !", "Kof, kof, kof !"), ("hum", "Hum hum", "Hum hum"), ("hum-p", "Hum, hum.", "Hum, hum."), ("euf", "Euf… euf…", "Euf… euf…"), ("euf-nu", "Euf euf euf", "Euf euf euf"),
              ("ah", "Ah…", "Ah…"), ("ah-nu", "Ah", "Ah"), ("pff", "Pff", "Pff"), ("pff-p", "Pff…", "Pff…"), ("atchoum", "Atchoum !", "Atchoum !"), ("atchoum-nu", "Atchoum", "Atchoum"),
              ("haha", "Ha ha ha", "Ha ha ha"), ("haha-p", "Ha, ha, ha !", "Ha, ha, ha !"), ("tousse", "« Tousse. » en mots", "Tousse."), ("tousse-par", "« (tousse) » (parenthèses retirées)", "(tousse)"),
              ("toux-longue", "Toux étirée « Keuh keuh keuh »", "Keuh… keuh… keuh…"), ("souffle", "Souffle « Hhh… hhh… »", "Hhh… hhh…")]
    for key, title, text in sounds:
        add("B", key, title, "Son ou syllabes ?", text)
    add("B", "ctx-kof", "« Kof kof… » puis la réplique", "La réplique garde-t-elle une voix gênée ?", "Kof kof… " + REF)
    add("B", "ctx-euf", "« Euf… euf… » puis la réplique", "Souffle court avant de parler ?", "Euf… euf… " + REF)
    add("B", "ctx-hum", "« Hum hum. » puis la réplique", "Raclement de gorge puis voix normale ?", "Hum hum. " + REF)
    add("B", "ctx-milieu", "Toux au milieu de la réplique", "Interruption puis reprise.", "J'ai couru depuis le pont. Kof kof. Le portail… kof… était fermé.")

    # C. ponctuation
    add("C", "excl", "Points d'exclamation", "Plus fort, plus pressé ?", "J'ai couru depuis le pont ! Le portail était fermé !")
    add("C", "interrog", "« ?! »", "Incrédulité, hauteur montante.", "J'ai couru depuis le pont ?! Le portail était fermé ?!")
    add("C", "capitales", "Capitales", "Cri ? Ou lecture épelée ?", "J'AI COURU DEPUIS LE PONT. LE PORTAIL ÉTAIT FERMÉ.")
    add("C", "sans-ponct", "Sans aucune ponctuation", "Débit sans respiration ?", "j ai couru depuis le pont le portail était fermé")
    add("C", "chut", "Chuchotement suggéré par le texte", "Voix plus basse, plus soufflée ? Les mots « chut » et « tout bas » sont dits.", "Chut… j'ai couru depuis le pont, tout bas… le portail était fermé…")
    add("C", "psst", "Chuchotement suggéré par « psst »", "Même question.", "Psst… j'ai couru depuis le pont. Le portail était fermé.")

    # D. paramètres
    for b in (-2.0, 2.0, 4.0):
        add("D", f"bonus{b:+.0f}", f"padding_bonus {b:+.0f}", "Plus vif si négatif, plus posé si positif.", REF, bonus=b)
    for n in (0, 2, 3):
        add("D", f"between{n}", f"padding_between {n}", "Mots plus ou moins détachés.", REF, between=n)
    for c in (1.0, 3.0, 4.0):
        add("D", f"cfg{c:.1f}", f"cfg_coef {c}", "Fidélité à la voix et au texte, parfois tension ou artefacts.", REF, cfg=c)
    for t in (0.3, 0.9, 1.2):
        add("D", f"temp{t}", f"température {t}", "Monotonie si basse, instabilité si haute.", REF, temp=t)
    add("D", "haché-combo", "Combiné : between 3 et bonus +2", "Hachure maximale de ce banc.", REF, between=3, bonus=2.0)
    add("D", "vif-combo", "Combiné : bonus −2 et température 0.9", "Débit pressé.", REF, bonus=-2.0, temp=0.9)
    add("D", "kof-cfg4", "« Kof, kof, kof ! » avec cfg_coef 4.0", "Le son change-t-il avec un guidage plus fort ?", "Kof, kof, kof !", cfg=4.0)
    add("D", "kof-temp12", "« Kof, kof, kof ! » avec température 1.2", "Plus de variété dans le son ?", "Kof, kof, kof !", temp=1.2)

    # E. très courts
    for key, text in (("bilan", "Bilan."), ("apart", "(à part)"), ("code", "Un exemple de code."), ("tenez", "Tenez.")):
        add("E", f"{key}-seul", f"« {text} » seul", "Attaque, durée, présence d'un artefact.", text)
        add("E", f"{key}-ctx", f"« {text} » après contexte, coupé", "Plus naturel que seul ?", text, ctx=CONTEXT)

    # F. graines
    for s in (1, 2, 3, 4):
        add("F", f"ref-seed{s}", f"Référence, graine {s}", "Même texte, autre tirage.", REF, seed=s)
    for s in (1, 2, 3):
        add("F", f"kof-seed{s}", f"« Kof, kof, kof ! » graine {s}", "Les tirages se distinguent-ils ?", "Kof, kof, kof !", seed=s)
    return items


def jobs() -> list[tuple[str, str, dict]]:
    out = []
    for item in catalog():
        for vkey in VOICES:
            out.append((f"{item['group']}-{item['key']}-{vkey}", vkey, item))
    return out


def generate(lab: Path) -> int:
    import numpy as np
    import torch
    from moshi.models.loaders import CheckpointInfo
    from moshi.models.tts import DEFAULT_DSM_TTS_REPO, TTSModel

    flag = Path(os.environ.get("XDG_RUNTIME_DIR", ""), "gpu-yield", "active")
    out = lab / "out"
    out.mkdir(parents=True, exist_ok=True)
    hub = Path(os.environ["HF_HOME"]) / "hub/models--kyutai--tts-voices/snapshots"
    voice_files = {k: next(hub.glob(f"*/{v[1]}_*_enhanced.wav.1e68beda@240.safetensors")) for k, v in VOICES.items()}
    if flag.exists():
        print("mode jeu : arrêt avant chargement", file=sys.stderr)
        return 75
    info = CheckpointInfo.from_hf_repo(DEFAULT_DSM_TTS_REPO)
    model = TTSModel.from_checkpoint_info(info, n_q=32, temp=0.6, device="cuda")
    print(json.dumps({"cfg_valides": sorted(model.valid_cfg_conditionings), "frame_rate": model.mimi.frame_rate, "delay_steps": model.delay_steps, "multi_speaker": model.multi_speaker}), flush=True)
    for job_id, vkey, item in jobs():
        target = out / f"{job_id}.wav"
        if target.exists():
            continue
        if flag.exists():
            print("mode jeu : arrêt propre avant " + job_id, file=sys.stderr)
            return 75
        prm = item["params"]
        model.padding_bonus, model.temp = prm["bonus"], prm["temp"]
        torch.manual_seed(prm["seed"])
        begin = time.monotonic()
        full = item["ctx"] + item["text"]
        try:
            entries = model.prepare_script([full], padding_between=prm["between"])
            conditions = model.make_condition_attributes([voice_files[vkey]], cfg_coef=prm["cfg"])
            result = model.generate([entries], [conditions])
        except Exception as error:  # noqa: BLE001 : on consigne et on continue
            (out / f"{job_id}.err").write_text(repr(error), encoding="utf-8")
            print(json.dumps({"id": job_id, "erreur": repr(error)}), flush=True)
            continue
        with model.mimi.streaming(1), torch.no_grad():
            pcms = [np.clip(model.mimi.decode(frame[:, 1:, :]).cpu().numpy()[0, 0], -1, 1) for frame in result.frames[model.delay_steps:]]
        samples = np.concatenate(pcms, axis=-1)
        rate = int(model.mimi.sample_rate)
        words = result.all_transcripts[0]  # (mot, pas) pour chaque mot consommé
        cut_step = None
        if item["ctx"]:
            n_ctx = len(item["ctx"].split())
            cut_step = words[n_ctx][1] if len(words) > n_ctx else None
        meta = {"id": job_id, "voice": vkey, "audio_s_total": round(len(samples) / rate, 2), "steps_mots": words, "cut_step": cut_step, "gen_s": round(time.monotonic() - begin, 1), "end_step": result.end_steps[0]}
        if cut_step is not None:
            start = int(cut_step / model.mimi.frame_rate * rate)
            full_path = out / f"{job_id}-plein.wav"
            _write(full_path, samples, rate)
            samples = samples[start:]
            fade = int(0.02 * rate)
            samples[:fade] = samples[:fade] * np.linspace(0, 1, min(fade, len(samples)))[: len(samples[:fade])]
        _write(target, samples, rate)
        (out / f"{job_id}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({k: meta[k] for k in ("id", "gen_s", "audio_s_total")}), flush=True)
    return 0


def _write(path: Path, samples, rate: int) -> None:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes((samples * 32767).astype("<i2").tobytes())


def extra_measures(samples, rate: int) -> dict:
    """Mesures complémentaires, indicatives : niveau de la parole et part d'énergie au-dessus de 4 kHz (proxy de souffle/sifflement)."""
    import numpy as np

    x = samples.astype(np.float64) / 32768.0
    size = int(rate * 0.03)
    n = len(x) // size
    if n == 0:
        return {}
    frames = x[: n * size].reshape(n, size)
    rms = np.sqrt((frames**2).mean(axis=1))
    voiced = rms > rms.max() * 0.08
    if not voiced.any():
        return {}
    spec = np.abs(np.fft.rfft(frames[voiced] * np.hanning(size), axis=1)) ** 2
    freqs = np.fft.rfftfreq(size, 1 / rate)
    hf = float(spec[:, freqs >= 4000].sum() / max(spec.sum(), 1e-12))
    return {"niveau_dbfs": round(float(20 * np.log10(rms[voiced].mean() + 1e-9)), 1), "part_aigus": round(hf, 3), "crete_dbfs": round(float(20 * np.log10(np.abs(x).max() + 1e-9)), 1)}


def page(lab: Path, out_dir: Path) -> int:
    sys.path.insert(0, str(HERE))
    import audio
    import lab as bench_lab

    (out_dir / "wav").mkdir(parents=True, exist_ok=True)
    bench = bench_lab.Bench("http://127.0.0.1:0", out_dir, bench_lab.Transcriber(True, "small"))
    rows = []
    for job_id, vkey, item in jobs():
        wav = lab / "out" / f"{job_id}.wav"
        if not wav.exists():
            bench.errors.append(f"{job_id} absent" + (" : " + (lab / 'out' / f'{job_id}.err').read_text() if (lab / "out" / f"{job_id}.err").exists() else ""))
            continue
        meta = json.loads((lab / "out" / f"{job_id}.json").read_text()) if (lab / "out" / f"{job_id}.json").exists() else {}
        pcm = audio.parse_wav(wav.read_bytes())
        prm = item["params"]
        shown = " · ".join(f"{k} {v}" for k, v in (("padding_bonus", prm["bonus"]), ("padding_between", prm["between"]), ("cfg_coef", prm["cfg"]), ("température", prm["temp"]), ("graine", prm["seed"])))
        section = f"{GROUPS[item['group']][0]} — {VOICES[vkey][0].split(' (')[0]}"
        check = item["text"].replace("<break time=\"0.5s\"/>", "").replace("<break time=\"0.8s\"/>", "").replace("<break time=\"0.3s\"/>", "")
        bench.add(section, job_id, f"{item['title']}", item["text"], pcm, meta.get("gen_s"), f"À écouter : {item['listen']} Réglages : {shown}." + (" Contexte coupé : « " + item["ctx"].strip() + " »." if item["ctx"] else ""), check)
        cur = bench.items[-1]
        cur["extra"] = extra_measures(pcm.samples, pcm.rate)
        cur["measures"]["niveau"] = cur["extra"].get("niveau_dbfs")
        rows.append({"id": job_id, "voice": vkey, "group": item["group"], "key": item["key"], "text": item["text"], "ctx": item["ctx"], "params": prm, "measures": cur["measures"], "extra": cur["extra"], "heard": cur.get("heard"), "wer": cur.get("wer"), "audio_s_total": meta.get("audio_s_total")})
    (out_dir / "results.json").write_text(json.dumps({"rows": rows, "errors": bench.errors}, ensure_ascii=False, indent=1), encoding="utf-8")
    summary = {}
    for item in bench.items:
        group = next(g for g in GROUPS.values() if item["section"].startswith(g[0]))
        summary[item["section"]] = [group[1]]
    html = bench_lab.render_page(bench.items, summary, out_dir)
    html = html.replace("<title>Écoute des voix</title>", "<title>Jeu d'acteur Kyutai</title>").replace("<h1>Écoute des voix</h1>", "<h1>Jeu d'acteur avec Kyutai 1.6B</h1><p>Aucun effet n'est présumé : chaque extrait dit ce qu'il faut écouter. « Compris par la transcription » est ce que faster-whisper a cru entendre, pas ce qui est joué.</p>").replace("'llm-voice-ecoute'", "'llm-voice-ecoute-jeu'")
    (out_dir / "index.html").write_text(html, encoding="utf-8")
    print(f"{len(rows)} extraits, {len(bench.errors)} erreurs")
    return 1 if bench.errors else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("step", choices=("gen", "page"))
    parser.add_argument("--lab", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    sys.exit(generate(args.lab) if args.step == "gen" else page(args.lab, args.out))
