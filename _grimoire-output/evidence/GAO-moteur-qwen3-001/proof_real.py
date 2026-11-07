#!/usr/bin/env python3
"""Preuve réelle du serveur Qwen3, sur le GPU, hors ligne (`--network none`). Rien n'est joué.

    python3 -P _grimoire-output/evidence/GAO-moteur-qwen3-001/proof_real.py

Le client tourne dans le conteneur (`docker exec`) : aucun port n'est publié. Il renvoie le WAV sur
sa sortie, le conteneur n'a donc aucun dossier de l'hôte en écriture.
- Phase A : vrai drapeau de jeu monté, seuil de mémoire à 0 pour mesurer les deux modèles ensemble.
- Phase C : les deux modèles chargés d'affilée, sans synthèse entre les deux : le pire ordre.
- Phase B : drapeau de TEST dans le conteneur (XDG_RUNTIME_DIR=/tmp/xdg-test) et seuil impossible :
  bascule forcée, annulation, 503, libération. Le vrai drapeau n'est jamais posé ; s'il apparaît,
  une sentinelle arrête le conteneur.

La mémoire est lue par processus (`/sys/class/kfd/kfd/proc/<pid>/vram_*`) : le compteur global de la
carte voit aussi Ollama, qui va et vient sur cette machine et que cette preuve ne doit pas confondre
avec le serveur.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
LAB = Path.home() / ".llm-voice" / "voices-lab" / "qwen3"
RUNTIME = os.environ.get("XDG_RUNTIME_DIR", "/run/user/1000")
REAL_FLAG = Path(RUNTIME) / "gpu-yield" / "active"
VRAM = Path("/sys/class/drm/card1/device")
NAME = "qwen3-proof"
IMAGE = "deploy-chatterbox:latest"
GIVEN = "Speaking casually in a real spontaneous conversation, relaxed, natural spoken delivery with varied rhythm, not reading aloud."
PHRASES = [
    "Le train s'est arrêté au milieu de la campagne, sans la moindre annonce.",
    "Les voyageurs ont levé les yeux de leurs livres, puis se sont regardés sans rien dire.",
]
LONG = (
    "Dehors, la pluie commençait à tomber sur les champs, doucement, comme si de rien n'était. "
    "Au bout d'un long moment, le train a repris sa route, et chacun a fait semblant de n'avoir rien remarqué. "
    "Personne n'a jamais su pourquoi il s'était arrêté, et personne n'a osé poser la question au contrôleur."
)
CLIENT = r"""
import http.client, json, sys, time
method, path, body, abort = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
started = time.monotonic()
conn = http.client.HTTPConnection("127.0.0.1", 8021, timeout=abort if abort > 0 else 400)
try:
    headers = {"Content-Type": "application/x-www-form-urlencoded"} if body else {}
    conn.request(method, path, body.encode() if body else None, headers)
    response = conn.getresponse()
    data = response.read()
    meta = {"status": response.status, "retry_after": response.getheader("Retry-After")}
except TimeoutError:
    conn.close()
    data = b""
    meta = {"status": "client_left"}
meta["elapsed_s"] = round(time.monotonic() - started, 2)
sys.stdout.buffer.write(json.dumps(meta).encode() + b"\n" + data)
"""


class Stop(Exception):
    pass


SERVER_PID = {"pid": None}


def vram_used_mb() -> int:
    return int((VRAM / "mem_info_vram_used").read_text()) // 2**20


def kfd_processes() -> dict[str, int]:
    """Mio de VRAM par processus de calcul, nommés : qwen3, kyutai, ollama, ou le numéro du processus."""
    found: dict[str, int] = {}
    for folder in Path("/sys/class/kfd/kfd/proc").iterdir():
        try:
            used = sum(int(item.read_text()) for item in folder.glob("vram_*")) // 2**20
            command = Path(f"/proc/{folder.name}/cmdline").read_bytes().decode(errors="replace")
        except (OSError, ValueError):
            continue
        if folder.name == str(SERVER_PID["pid"]):
            name = "qwen3"
        elif "kyutai16" in command:
            name = "kyutai"
        elif "ollama" in command:
            name = "ollama"
        else:
            name = f"autre-{folder.name}"
        found[name] = found.get(name, 0) + used
    return found


def vram() -> dict[str, object]:
    processes = kfd_processes()
    return {"card_used": vram_used_mb(), "qwen3": processes.get("qwen3", 0), "kyutai": processes.get("kyutai", 0), "ollama": processes.get("ollama", 0)}


def wait_ollama_gone(limit: float = 540) -> dict:
    """Une mesure propre : le voisin n'est pas arrêté, on attend qu'il se retire seul."""
    started = time.monotonic()
    while time.monotonic() - started < limit and kfd_processes().get("ollama", 0) > 0:
        if REAL_FLAG.exists():
            raise Stop("mode jeu")
        time.sleep(5)
    if kfd_processes().get("ollama", 0) > 0:
        raise Stop("Ollama tient encore le GPU : aucune charge ajoutée, preuve à relancer")
    return {"waited_s": round(time.monotonic() - started), **vram()}


class Sampler:
    """Le pic d'occupation entre deux lectures, tous processus confondus."""

    def __init__(self) -> None:
        self.peak = 0
        self.server_peak = 0
        self.ollama_seen = False
        self.alive = True
        self.game = False
        threading.Thread(target=self.run, daemon=True).start()

    def run(self) -> None:
        while self.alive:
            self.peak = max(self.peak, vram_used_mb())
            processes = kfd_processes()
            self.server_peak = max(self.server_peak, processes.get("qwen3", 0))
            self.ollama_seen = self.ollama_seen or processes.get("ollama", 0) > 0
            if REAL_FLAG.exists() and not self.game:
                self.game = True
                print("MODE JEU DÉTECTÉ : arrêt du conteneur", flush=True)
                subprocess.run(["docker", "stop", "-t", "2", NAME], capture_output=True, check=False)
            time.sleep(0.2)

    def take(self) -> dict:
        taken = {"card_peak": self.peak, "qwen3_peak": self.server_peak, "ollama_seen": self.ollama_seen}
        self.peak, self.server_peak, self.ollama_seen = vram_used_mb(), kfd_processes().get("qwen3", 0), False
        return taken


def docker_run(env: dict[str, str], mounts: list[str]) -> None:
    command = [
        "docker", "run", "-d", "--rm", "--name", NAME, "--network", "none", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true", "--device", "/dev/kfd", "--device", "/dev/dri",
        "--group-add", "39", "--group-add", "105", "-u", "1000:1000", "--tmpfs", "/tmp:mode=1777",
        "-v", f"{ROOT}/deploy/qwen3:/srv/qwen3:ro",
        "-v", f"{LAB}/extras:/lab/extras:ro", "-v", f"{LAB}/hf:/lab/hf:ro", "-v", f"{LAB}:/lab/refs:ro",
    ]
    base = {
        "QWEN3_REFS_DIR": "/lab/refs", "ROCBLAS_USE_HIPBLASLT": "0", "TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL": "1",
        "MIOPEN_FIND_MODE": "FAST", "USER": "llm-voice", "LOGNAME": "llm-voice", "HOME": "/tmp",
        "PYTHONPATH": "/lab/extras", "PYTHONDONTWRITEBYTECODE": "1", "HF_HOME": "/lab/hf",
    }
    for key, value in {**base, **env}.items():
        command += ["-e", f"{key}={value}"]
    for mount in mounts:
        command += ["-v", mount]
    command += ["-w", "/srv/qwen3", "--entrypoint", "python", IMAGE, "/srv/qwen3/server.py"]
    subprocess.run(command, check=True, capture_output=True)
    inspected = subprocess.run(["docker", "inspect", "-f", "{{.State.Pid}}", NAME], check=True, capture_output=True, text=True)
    SERVER_PID["pid"] = int(inspected.stdout.strip())


def call(method: str, path: str, form: dict | None = None, abort: float = 0) -> tuple[dict, bytes]:
    body = urllib.parse.urlencode(form) if form else ""
    done = subprocess.run(
        ["docker", "exec", NAME, "python", "-c", CLIENT, method, path, body, str(abort)], capture_output=True, check=False
    )
    if done.returncode != 0:
        raise Stop(f"client : {done.stderr[-300:].decode(errors='replace')}")
    head, _, data = done.stdout.partition(b"\n")
    return json.loads(head), data


def in_container(*command: str) -> None:
    subprocess.run(["docker", "exec", NAME, *command], check=True, capture_output=True)


def health() -> dict:
    return json.loads(call("GET", "/health")[1])


def wait_ready(mode: str, sampler: Sampler, limit: float = 240) -> dict:
    started = time.monotonic()
    seen_loading = False
    while time.monotonic() - started < limit:
        if sampler.game:
            raise Stop("mode jeu")
        state = health()
        seen_loading = seen_loading or state["state"] == "loading"
        if state["state"] != "loading" and state["models"][mode]:
            return {"load_s": round(time.monotonic() - started, 1), "health_answered_while_loading": seen_loading, "health": state}
        if state["state"] == "unloaded" and not seen_loading and time.monotonic() - started > 5:
            raise Stop(f"chargement abandonné : {state}")
        time.sleep(0.5)
    raise Stop(f"{mode} : pas chargé en {limit} s")


def wait_listening(limit: float = 60) -> None:
    started = time.monotonic()
    while time.monotonic() - started < limit:
        try:
            health()
            return
        except (Stop, json.JSONDecodeError):
            time.sleep(1)
    raise Stop("le serveur n'écoute pas")


def tts(name: str, text: str, direction: str, results: list, sampler: Sampler) -> dict:
    if sampler.game:
        raise Stop("mode jeu")
    sampler.take()
    form = {"text": text, "voice_url": "fr-naturelle"}
    if direction:
        form["direction"] = direction
    meta, data = call("POST", "/tts", form)
    row = {"name": name, "mode": "played" if direction else "frozen", "text": text, **meta, "vram_peak_mb": sampler.take(), "vram_after_mb": vram()}
    if meta["status"] == 200:
        path = HERE / f"{name}.wav"
        path.write_bytes(data)
        with wave.open(str(path)) as audio:
            row["audio_s"] = round(audio.getnframes() / audio.getframerate(), 2)
            row["rate"] = audio.getframerate()
        row["rtf"] = round(meta["elapsed_s"] / row["audio_s"], 2)
        row["sha256"] = hashlib.sha256(data).hexdigest()[:16]
    else:
        row["detail"] = data.decode(errors="replace")[:300]
    results.append(row)
    print(json.dumps({k: v for k, v in row.items() if k != "text"}, ensure_ascii=False), flush=True)
    return row


def stop_and_log(tag: str) -> str:
    logs = subprocess.run(["docker", "logs", NAME], capture_output=True, text=True, check=False)
    text = logs.stdout + logs.stderr
    (HERE / f"phase{tag}-container.log").write_text(text, encoding="utf-8")
    subprocess.run(["docker", "stop", "-t", "10", NAME], capture_output=True, check=False)
    return text


def leaks(log: str) -> list[str]:
    needles = ["train", "voyageurs", "campagne", "pluie", "contrôleur", "spontaneous", "almost whispering"]
    return [word for word in needles if word in log]


def kyutai_probe(tag: str) -> dict:
    """Le voisin tient-il encore ? Une phrase, écrite nulle part que dans la mémoire de ce script."""
    body = urllib.parse.urlencode({"text": "Une phrase de contrôle.", "voice_url": "cml-577_394"}).encode()
    started = time.monotonic()
    request = urllib.request.Request("http://127.0.0.1:8020/tts", data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            size = len(response.read())
            return {"when": tag, "status": response.status, "bytes": size, "elapsed_s": round(time.monotonic() - started, 2)}
    except OSError as error:
        return {"when": tag, "error": type(error).__name__, "detail": str(error)[:200]}


def phase_a(report: dict, sampler: Sampler) -> None:
    out: dict = {"vram_mb": {"before": vram()}, "tts": []}
    report["phase_a"] = out
    docker_run(
        {"XDG_RUNTIME_DIR": "/run/user/1000", "QWEN3_MIN_FREE_VRAM_MB": "0"},
        [f"{RUNTIME}/gpu-yield:/run/user/1000/gpu-yield:ro"],
    )
    wait_listening()
    out["health_at_start"] = health()
    out["voices"] = json.loads(call("GET", "/voices")[1])
    network = subprocess.run(["docker", "exec", NAME, "python", "-c", "import os;print(sorted(os.listdir('/sys/class/net')))"], capture_output=True, text=True, check=False)
    out["interfaces"] = network.stdout.strip()
    out["vram_mb"]["server_idle"] = vram()

    sampler.take()
    out["load_frozen_http"] = call("POST", "/load")[0]
    out["load_frozen"] = wait_ready("frozen", sampler)
    out["vram_mb"]["load_frozen_peak"] = sampler.take()
    out["vram_mb"]["frozen_loaded"] = vram()
    for index, phrase in enumerate(PHRASES, 1):
        tts(f"figee-{index}", phrase, "", out["tts"], sampler)
    out["vram_mb"]["frozen_after_synthesis"] = vram()

    sampler.take()
    out["load_played_http"] = call("POST", "/load?mode=played")[0]
    out["load_played"] = wait_ready("played", sampler)
    out["vram_mb"]["load_played_peak"] = sampler.take()
    out["vram_mb"]["both_loaded"] = vram()
    out["health_both"] = health()
    for index, phrase in enumerate(PHRASES, 1):
        tts(f"jouee-{index}", phrase, GIVEN, out["tts"], sampler)
    out["vram_mb"]["both_after_played_synthesis"] = vram()
    tts("figee-1-bis", PHRASES[0], "", out["tts"], sampler)
    out["vram_mb"]["both_after_frozen_synthesis"] = vram()
    out["health_end"] = health()
    out["kyutai_next_door"] = kyutai_probe("les deux modèles Qwen3 chargés")
    out["vram_mb"]["after_kyutai_probe"] = vram()
    log = stop_and_log("A")
    out["log_leaks"] = leaks(log)
    time.sleep(3)
    out["vram_mb"]["container_stopped"] = vram()


def phase_c(report: dict, sampler: Sampler) -> None:
    """Sans synthèse entre les deux, le premier modèle n'a pas encore réservé de blocs à prêter au second."""
    out: dict = {"vram_mb": {"before": vram()}, "tts": []}
    report["phase_c"] = out
    docker_run(
        {"XDG_RUNTIME_DIR": "/run/user/1000", "QWEN3_MIN_FREE_VRAM_MB": "0"},
        [f"{RUNTIME}/gpu-yield:/run/user/1000/gpu-yield:ro"],
    )
    wait_listening()
    call("POST", "/load")
    out["load_frozen"] = wait_ready("frozen", sampler)["load_s"]
    out["vram_mb"]["frozen_loaded"] = vram()
    call("POST", "/load?mode=played")
    wait = wait_ready("played", sampler)
    out["load_played"] = wait["load_s"]
    out["models_after_second_load"] = wait["health"]["models"]
    out["vram_mb"]["after_second_load"] = vram()
    out["vram_mb"]["peak_loading"] = sampler.take()
    tts("ordre2-jouee", PHRASES[0], GIVEN, out["tts"], sampler)
    tts("ordre2-figee", PHRASES[1], "", out["tts"], sampler)
    out["vram_mb"]["after_both_syntheses"] = vram()
    out["health_end"] = health()
    log = stop_and_log("C")
    out["log_leaks"] = leaks(log)
    out["log_events"] = [line for line in log.splitlines() if "out_of_memory" in line or "swapped" in line]
    time.sleep(3)
    out["vram_mb"]["container_stopped"] = vram()


def phase_b(report: dict, sampler: Sampler) -> None:
    out: dict = {"vram_mb": {"before": vram()}, "tts": []}
    report["phase_b"] = out
    docker_run({"XDG_RUNTIME_DIR": "/tmp/xdg-test", "QWEN3_MIN_FREE_VRAM_MB": "999999"}, [])
    wait_listening()
    in_container("mkdir", "-p", "/tmp/xdg-test/gpu-yield")

    # Bascule forcée : le seuil est inatteignable, la voix figée doit céder la place.
    call("POST", "/load")
    wait_ready("frozen", sampler)
    out["vram_mb"]["frozen_loaded"] = vram()
    call("POST", "/load?mode=played")
    out["load_played_swap"] = wait_ready("played", sampler)
    out["vram_mb"]["played_after_swap"] = vram()
    out["health_after_swap"] = health()

    # Un client qui part : le serveur doit s'arrêter, et la suivante passer.
    out["client_left"] = call("POST", "/tts", {"text": LONG, "direction": GIVEN}, abort=4)[0]
    time.sleep(1)
    next_one = tts("apres-annulation", PHRASES[0], GIVEN, out["tts"], sampler)
    out["next_after_cancel_ok"] = next_one["status"] == 200

    # Le mode jeu commence pendant une synthèse.
    result: dict = {}

    def speak() -> None:
        result["meta"] = call("POST", "/tts", {"text": LONG, "direction": GIVEN})[0]

    thread = threading.Thread(target=speak)
    thread.start()
    time.sleep(5)
    in_container("touch", "/tmp/xdg-test/gpu-yield/active")
    flagged = time.monotonic()
    thread.join(60)
    out["flag_during_synthesis"] = {**result.get("meta", {}), "seconds_after_flag": round(time.monotonic() - flagged, 2)}
    time.sleep(3)
    out["vram_mb"]["released_by_game_mode"] = vram()
    out["health_in_game"] = health()

    # Pendant le jeu : 503 partout, aucune charge.
    before = vram()
    frozen = call("POST", "/tts", {"text": PHRASES[0]})
    played = call("POST", "/tts", {"text": PHRASES[0], "direction": GIVEN})
    load = call("POST", "/load")
    out["during_game"] = {
        "tts_frozen": {**frozen[0], "body": frozen[1].decode()},
        "tts_played": {**played[0], "body": played[1].decode()},
        "load": {**load[0], "body": load[1].decode()},
        "vram_before_mb": before,
        "vram_after_mb": vram(),
    }

    # Une fois le jeu fini : la voix revient.
    in_container("mv", "/tmp/xdg-test/gpu-yield/active", "/tmp/xdg-test/gpu-yield/fini")
    if sampler.game or REAL_FLAG.exists():
        raise Stop("mode jeu réel")
    tts("apres-jeu", PHRASES[1], "", out["tts"], sampler)
    out["health_after_game"] = health()
    log = stop_and_log("B")
    out["log_leaks"] = leaks(log)
    out["log_events"] = [
        line for line in log.splitlines()
        if any(word in line for word in ('"model_swapped_out"', '"model_unloaded"', '"out_of_memory"', '"status": 499', '"status": 503'))
    ]
    time.sleep(3)
    out["vram_mb"]["container_stopped"] = vram()


def main() -> int:
    if REAL_FLAG.exists():
        print("mode jeu actif : arrêt", flush=True)
        return 75
    sampler = Sampler()
    report: dict = {"date": time.strftime("%Y-%m-%dT%H:%M:%S"), "vram_total_mb": int((VRAM / "mem_info_vram_total").read_text()) // 2**20}
    report["kyutai_health"] = json.loads(urllib.request.urlopen("http://127.0.0.1:8020/health", timeout=5).read())
    code = 0
    try:
        for tag, phase in (("A", phase_a), ("C", phase_c), ("B", phase_b)):
            report[f"before_{tag}"] = wait_ollama_gone()
            print(f"--- phase {tag}", report[f"before_{tag}"], flush=True)
            phase(report, sampler)
            time.sleep(2)
    except (Stop, subprocess.CalledProcessError) as error:
        report["stopped"] = str(error)[:500]
        print("ARRÊT :", report["stopped"], flush=True)
        if SERVER_PID["pid"] is not None:
            stop_and_log("X")
        code = 1
    finally:
        sampler.alive = False
        report["game_mode_seen"] = sampler.game
        (HERE / "proof-real.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return code


if __name__ == "__main__":
    sys.exit(main())
