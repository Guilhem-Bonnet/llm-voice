#!/usr/bin/env python3
"""Fish S2 Pro (licence non commerciale : repère seulement), conteneur sans réseau, code et poids en lecture seule.
Référence vocale : la narration figée Qwen3 du banc (même timbre que la référence), transcription = texte du banc.
États : balises inline du champ `fish` de banc.json. Mode jeu vérifié avant chargement et chaque extrait."""
import os, sys, time
from pathlib import Path
sys.path.insert(0, "/lab/banc"); from common import items, game_mode, vram_mb, write_wav, write_meta
if game_mode(): print("mode jeu actif : arrêt"); sys.exit(75)
sys.path.insert(0, "/lab/code"); os.chdir("/tmp")
import numpy as np, torch
import fish_speech.models.text2semantic.inference as _inf
# Essai 2 : le cache KV est alloué à l'init pour max_seq_len=32768 (environ 4,8 Go en bf16) : borné à MAX_SEQ (défaut 4096),
# largement assez pour la référence de 22 s et nos textes de 400 caractères au plus.
_orig_init = _inf.init_model
def _init_borne(*a, **k):
    m, d = _orig_init(*a, **k); m.config.max_seq_len = int(os.environ.get("MAX_SEQ", "4096")); return m, d
_inf.init_model = _init_borne
from tools.server.model_manager import ModelManager
from fish_speech.utils.schema import ServeTTSRequest, ServeReferenceAudio
half = os.environ.get("HALF", "0") == "1"; out = Path("/lab/out") / "fish-s2"; out.mkdir(parents=True, exist_ok=True)
ref_wav = Path("/lab/out/qwen3-fige/01-narration.wav"); ref_text = items()[0]["text"]
t = time.monotonic()
mm = ModelManager(mode="tts", device="cuda", half=half, compile=False, llama_checkpoint_path="/lab/weights",
                  decoder_checkpoint_path="/lab/weights/codec.pth", decoder_config_name="modded_dac_vq")
load_s = round(time.monotonic() - t, 1); print("chargé", load_s, "s ; vram carte", vram_mb(), flush=True)
ref = ServeReferenceAudio(audio=ref_wav.read_bytes(), text=ref_text)
for it in items():
    name = it["id"]
    if (out / f"{name}.wav").exists(): continue
    if game_mode(): print("mode jeu actif : arrêt propre avant", name); sys.exit(75)
    text = it.get("fish") or it["text"]
    torch.cuda.reset_peak_memory_stats(); t = time.monotonic(); audio = None; err = None
    for r in mm.tts_inference_engine.inference(ServeTTSRequest(text=text, references=[ref], seed=11, format="wav", normalize=False)):
        if r.code == "final": audio = r.audio
        elif r.code == "error": err = repr(r.error)[:400]
    torch.cuda.synchronize(); dt = time.monotonic() - t
    if audio is None:
        write_meta(out, name, engine="fish-s2", item=name, error=err or "aucun audio"); print(name, "ERREUR", err, flush=True); continue
    sr, a = audio; dur = write_wav(out / f"{name}.wav", np.asarray(a, dtype="float32"), sr)
    write_meta(out, name, engine="fish-s2", item=name, kind=it["kind"], text=it["text"], input_text=text,
               method=("balises inline Fish" if it.get("fish") else "texte seul") + " ; clonage depuis la narration figée Qwen3",
               precision="fp16" if half else "bf16", gen_s=round(dt, 2), audio_s=round(dur, 2), load_s=load_s, sr=sr,
               vram_peak_alloc_mb=round(torch.cuda.max_memory_allocated() / 2**20), vram_peak_reserved_mb=round(torch.cuda.max_memory_reserved() / 2**20), vram_card_mb=vram_mb())
    print(name, round(dt, 1), "s /", round(dur, 1), "s", flush=True)
