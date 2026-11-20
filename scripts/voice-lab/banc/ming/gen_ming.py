#!/usr/bin/env python3
"""Ming-3.0-tts-tiny (MoE 7,9B, MIT) : tentative unique, conteneur sans réseau, code/poids en lecture seule.
Tâche freeform (consigne anglaise libre) avec la narration figée Qwen3 comme référence de locuteur (speaker_only) ;
les balises paralinguistiques ne sont documentées qu'en chinois/anglais, donc non utilisées."""
import os, sys, time, traceback
from pathlib import Path
sys.path.insert(0, "/lab/banc"); from common import items, game_mode, vram_mb, write_wav, write_meta
if game_mode(): print("mode jeu actif : arrêt"); sys.exit(75)
sys.path.insert(0, "/lab/code"); os.chdir("/tmp")
import torch
out = Path("/lab/out") / "ming-tiny"; out.mkdir(parents=True, exist_ok=True)
ref = "/lab/out/qwen3-fige/01-narration.wav"
t = time.monotonic()
try:
    from ming_tiny import MingTinyTTS
    tts = MingTinyTTS.from_pretrained("/lab/weights", device="cuda:0", text_normalization=False)
except Exception as e:
    (out / "load-error.txt").write_text(traceback.format_exc()[-3000:] + f"\nvram carte {vram_mb()} Mio ; pointe torch {round(torch.cuda.max_memory_allocated()/2**20)} Mio\n")
    print("ÉCHEC CHARGEMENT", repr(e)[:400], flush=True); sys.exit(1)
load_s = round(time.monotonic() - t, 1); print("chargé", load_s, "s ; vram", vram_mb(), flush=True)
for it in items():
    name = it["id"]
    if (out / f"{name}.wav").exists(): continue
    if game_mode(): print("mode jeu actif : arrêt propre avant", name); sys.exit(75)
    torch.cuda.reset_peak_memory_stats(); t = time.monotonic()
    try:
        o = tts.generate(task="freeform", text=it["text"], instruction=it.get("direction"), prompt_wav=ref, seed=1234)
    except Exception as e:
        write_meta(out, name, engine="ming-tiny", item=name, error=repr(e)[:400]); print(name, "ERREUR", repr(e)[:300], flush=True); continue
    torch.cuda.synchronize(); dt = time.monotonic() - t
    dur = write_wav(out / f"{name}.wav", o.waveform.float().cpu().numpy(), tts.sample_rate)
    write_meta(out, name, engine="ming-tiny", item=name, kind=it["kind"], text=it["text"], input_text=it["text"],
               method="tâche freeform (consigne anglaise) + référence de locuteur (narration figée Qwen3)", direction=it.get("direction"),
               gen_s=round(dt, 2), audio_s=round(dur, 2), load_s=load_s, sr=tts.sample_rate,
               vram_peak_alloc_mb=round(torch.cuda.max_memory_allocated() / 2**20), vram_peak_reserved_mb=round(torch.cuda.max_memory_reserved() / 2**20), vram_card_mb=vram_mb())
    print(name, round(dt, 1), "s /", round(dur, 1), "s", flush=True)
