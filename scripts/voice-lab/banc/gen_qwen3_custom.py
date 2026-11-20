#!/usr/bin/env python3
"""Qwen3-TTS 1.7B CustomVoice (Apache-2.0) dans un conteneur sans réseau. Timbres intégrés + `instruct` anglais pour l'état.
Variables : SPEAKERS (défaut 'serena,ryan'), SEED (défaut 11). Mode jeu vérifié avant chargement et chaque extrait."""
import os, sys, time
from pathlib import Path
sys.path.insert(0, "/lab/banc"); from common import items, game_mode, vram_mb, write_wav, write_meta
if game_mode(): print("mode jeu actif : arrêt"); sys.exit(75)
import torch
from qwen_tts import Qwen3TTSModel
seed = int(os.environ.get("SEED", "11")); speakers = os.environ.get("SPEAKERS", "serena,ryan").split(",")
t = time.monotonic(); m = Qwen3TTSModel.from_pretrained("/lab/weights", device_map="cuda", dtype=torch.bfloat16, attn_implementation="sdpa"); load_s = round(time.monotonic() - t, 1)
print("chargé", load_s, "s ; timbres :", m.get_supported_speakers(), flush=True)
for spk in speakers:
    out = Path("/lab/out") / f"qwen3custom-{spk}"; out.mkdir(parents=True, exist_ok=True)
    for it in items():
        name = it["id"]
        if (out / f"{name}.wav").exists(): continue
        if game_mode(): print("mode jeu actif : arrêt propre avant", spk, name); sys.exit(75)
        ins = it.get("direction") if it["kind"] == "etat" else None
        torch.manual_seed(seed); torch.cuda.reset_peak_memory_stats(); t = time.monotonic()
        try:
            wavs, sr = m.generate_custom_voice(text=it["text"], speaker=spk, language="French", instruct=ins)
        except Exception as e:
            write_meta(out, name, engine=f"qwen3custom-{spk}", item=name, error=repr(e)[:400]); print(name, "ERREUR", repr(e)[:300], flush=True); continue
        torch.cuda.synchronize(); dt = time.monotonic() - t
        dur = write_wav(out / f"{name}.wav", wavs[0], sr)
        write_meta(out, name, engine=f"qwen3custom-{spk}", item=name, kind=it["kind"], text=it["text"], input_text=it["text"],
                   method=("consigne instruct (anglais)" if ins else "timbre intégré, sans consigne"), direction=ins, voice=spk, seed=seed,
                   gen_s=round(dt, 2), audio_s=round(dur, 2), load_s=load_s, sr=sr,
                   vram_peak_alloc_mb=round(torch.cuda.max_memory_allocated() / 2**20), vram_peak_reserved_mb=round(torch.cuda.max_memory_reserved() / 2**20), vram_card_mb=vram_mb())
        print(spk, name, round(dt, 1), "s /", round(dur, 1), "s", flush=True)
