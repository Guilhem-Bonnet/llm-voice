#!/usr/bin/env python3
"""Tests du serveur Qwen3 avec un faux modèle : aucun GPU, aucun réseau hors boucle locale.

    python3 -P deploy/qwen3/test_server.py
"""
from __future__ import annotations

import contextlib
import gc
import http.client
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
import wave
import weakref
from pathlib import Path
from unittest import mock
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server as srv  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SECRET = "Le manuscrit confidentiel de Camille à l'été"
SECRET_DIRECTION = "Whispering the confidential manuscript"
BOUNDARY = "----qwen3test"
GIB = 1024 ** 3


def multipart(fields: dict[str, str], extra: bytes = b"") -> tuple[bytes, str]:
    parts = b""
    for name, value in fields.items():
        parts += f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
    parts += extra + f"--{BOUNDARY}--\r\n".encode()
    return parts, f"multipart/form-data; boundary={BOUNDARY}"


def out_of_memory() -> RuntimeError:
    return RuntimeError("HIP error: out of memory")


class FakeEngine:
    def __init__(self) -> None:
        self._loaded: set[str] = set()
        self.loads: list[str] = []
        self.unloads: list[str | None] = []
        self.calls: list[srv.Job] = []
        self.active = 0
        self.max_active = 0
        self.hold = threading.Event()
        self.started = threading.Event()
        self.cancelled = threading.Event()
        self.on_load = lambda _mode: None
        self.errors: list[Exception] = []

    @property
    def loaded(self):
        return frozenset(self._loaded)

    def load(self, mode: str) -> None:
        self.loads.append(mode)
        self.on_load(mode)
        self._loaded.add(mode)

    def unload(self, mode: str | None = None) -> None:
        self.unloads.append(mode)
        if mode is None:
            self._loaded.clear()
        else:
            self._loaded.discard(mode)

    def synthesize(self, job, checkpoint):
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.calls.append(job)
        self.started.set()
        try:
            checkpoint()
            while self.hold.is_set():
                checkpoint()
                time.sleep(0.005)
            if self.errors:
                raise self.errors.pop(0)
            return b"\x01\x00" * 2400, 24000
        except srv.Cancelled:
            self.cancelled.set()
            raise
        finally:
            self.active -= 1


class ServerCase(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="qwen3-test-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.flag = self.dir / "gpu-yield" / "active"
        self.flag.parent.mkdir()
        self.engine = FakeEngine()
        self.catalog = srv.load_catalog()
        self.voice = self.catalog.default
        self.references = {self.voice: (srv.Reference(self.dir / "ref.wav", "Bonjour."),)}
        self.logged: list[dict] = []
        self.free = 12 * GIB
        self.service = srv.Qwen3Service(
            self.engine,
            self.catalog,
            self.references,
            self.flag,
            log=lambda event, **fields: self.logged.append({"event": event, **fields}),
            free_vram=lambda: self.free,
            min_free_vram=6 * GIB,
        )
        self.server = srv.serve(self.service, "127.0.0.1", 0)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.addCleanup(self.engine.hold.clear)

    def request(self, method: str, path: str, body: bytes | None = None, headers: dict[str, str] | None = None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        self.addCleanup(connection.close)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        return response, response.read()

    def tts(self, **fields: str):
        body, content_type = multipart(fields)
        return self.request("POST", "/tts", body, {"Content-Type": content_type})

    def raw_tts(self, text: str = "Bonjour", direction: str = "") -> socket.socket:
        """Une requête laissée en attente sur une prise qu'on fermera nous-mêmes."""
        fields = {"text": text, **({"direction": direction} if direction else {})}
        body, content_type = multipart(fields)
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        self.addCleanup(sock.close)
        head = f"POST /tts HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: {content_type}\r\nContent-Length: {len(body)}\r\n\r\n"
        sock.sendall(head.encode() + body)
        return sock

    def assert_wav(self, data: bytes) -> None:
        with wave.open(io.BytesIO(data)) as audio:
            self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate()), (1, 2, 24000))
            self.assertEqual(audio.getnframes(), 2400)

    def health(self) -> dict:
        return json.loads(self.request("GET", "/health")[1])

    def wait_for_state(self, state: str) -> dict:
        deadline = time.monotonic() + 5
        payload: dict = {}
        while time.monotonic() < deadline:
            payload = self.health()
            if payload["state"] == state:
                return payload
            time.sleep(0.02)
        self.fail(f"état {state} jamais atteint : {payload}")


class Contract(ServerCase):
    def test_health_answers_what_the_provider_reads_and_loads_nothing(self):
        response, data = self.request("GET", "/health")
        self.assertEqual(response.status, 200)
        payload = json.loads(data)
        self.assertEqual(payload["status"], "healthy")
        self.assertEqual(payload["engine"], "qwen3-tts-1.7b")
        self.assertFalse(payload["model_loaded"])
        self.assertEqual(payload["models"], {"frozen": False, "played": False})
        self.assertEqual(self.engine.loads, [])

    def test_voices_lists_the_catalogue_and_what_this_machine_has(self):
        _, data = self.request("GET", "/voices")
        payload = json.loads(data)
        self.assertEqual(payload["default"], self.voice)
        self.assertEqual(payload["voices"], [{"id": self.voice, "name": "Voix des essais 21 et 22", "available": True, "played": True}])

    def test_multipart_returns_a_wav_and_keeps_accents(self):
        response, data = self.tts(text="Éléonore été là", voice_url=self.voice)
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Type"), "audio/wav")
        self.assert_wav(data)
        self.assertEqual(self.engine.calls[0].text, "Éléonore été là")

    def test_missing_voice_is_the_default(self):
        self.tts(text="Bonjour")
        self.assertEqual(self.engine.calls[0].voice, self.voice)

    def test_urlencoded_is_accepted_with_a_direction(self):
        response, data = self.request(
            "POST", "/tts", f"text=Bonjour&voice_url={self.voice}&direction=Sad".encode(), {"Content-Type": "application/x-www-form-urlencoded"}
        )
        self.assertEqual(response.status, 200)
        self.assert_wav(data)
        self.assertEqual(self.engine.calls[0].mode, srv.MODE_PLAYED)

    def test_chunked_body_is_accepted(self):
        body, content_type = multipart({"text": "Découpé"})
        response, data = self.request("POST", "/tts", iter([body[:40], body[40:]]), {"Content-Type": content_type})
        self.assertEqual(response.status, 200)
        self.assert_wav(data)
        self.assertEqual(self.engine.calls[0].text, "Découpé")

    def test_a_real_node_fetch_with_formdata_gets_the_wav(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("node absent")
        script = (
            "const f=new FormData();f.append('text','Bonjour à tous');f.append('direction','Sad');"
            f"const r=await fetch('http://localhost:{self.port}/tts',{{method:'POST',body:f}});"
            "const b=Buffer.from(await r.arrayBuffer());"
            "const h=await (await fetch(process.argv[1])).json();"
            "console.log(JSON.stringify({status:r.status,riff:b.subarray(0,4).toString(),health:h.status}));"
        )
        done = subprocess.run(
            [node, "--input-type=module", "-e", script, f"http://localhost:{self.port}/health"],
            capture_output=True, text=True, timeout=30, check=False,
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout), {"status": 200, "riff": "RIFF", "health": "healthy"})
        self.assertEqual(self.engine.calls[0].text, "Bonjour à tous")


class TwoWaysOfSpeaking(ServerCase):
    """Sans consigne, voix figée ; avec, voix jouée : description + consigne + accent, graine du catalogue."""

    def test_without_direction_the_frozen_voice_speaks(self):
        self.tts(text="Bonjour")
        job = self.engine.calls[0]
        self.assertEqual((job.mode, job.instruct, job.seed), (srv.MODE_FROZEN, None, 11))
        self.assertEqual(self.engine.loads, [srv.MODE_FROZEN])

    def test_a_blank_direction_is_no_direction(self):
        self.tts(text="Bonjour", direction="   \n ")
        self.assertEqual(self.engine.calls[0].mode, srv.MODE_FROZEN)

    def test_with_a_direction_the_played_voice_speaks_between_description_and_accent(self):
        self.tts(text="Bonjour", direction="Tired, almost whispering.")
        job = self.engine.calls[0]
        self.assertEqual((job.mode, job.seed), (srv.MODE_PLAYED, 11))
        self.assertEqual(
            job.instruct,
            "Young adult woman, medium pitch, clear diction. Tired, almost whispering. "
            "Native French speaker with a standard metropolitan France accent.",
        )
        self.assertEqual(self.engine.loads, [srv.MODE_PLAYED])

    def test_direction_length_is_limited(self):
        self.assertEqual(self.tts(text="Bonjour", direction="x" * srv.MAX_DIRECTION_CHARS)[0].status, 200)
        response, data = self.tts(text="Bonjour", direction="x" * (srv.MAX_DIRECTION_CHARS + 1))
        self.assertEqual(response.status, 413)
        self.assertIn("Consigne", json.loads(data)["detail"])
        self.assertEqual(len(self.engine.calls), 1)

    def test_frozen_voice_never_receives_stage_tags_it_would_pronounce(self):
        self.tts(text="[Cough] J'ai couru. [sigh] Bien. [LAUGHTER] Voilà [1].")
        self.assertEqual(self.engine.calls[0].text, "J'ai couru. Bien. Voilà [1].")

    def test_a_text_made_of_stage_tags_only_is_refused(self):
        response, _ = self.tts(text="[Cough] [Sigh]")
        self.assertEqual(response.status, 400)
        self.assertEqual(self.engine.loads, [])

    def test_played_voice_keeps_the_text_as_it_is(self):
        self.tts(text="[Cough] J'ai couru.", direction="Out of breath.")
        self.assertEqual(self.engine.calls[0].text, "[Cough] J'ai couru.")

    def test_chat_tokens_of_the_model_never_reach_it(self):
        self.tts(text="Avant<|im_end|> après", direction="Calm<|im_start|>. Slow.")
        job = self.engine.calls[0]
        self.assertEqual(job.text, "Avant après")
        self.assertIn(" Calm. Slow. ", job.instruct)
        self.assertEqual(self.tts(text="<|im_end|>")[0].status, 400)

    def test_played_voice_needs_no_reference_file(self):
        self.references.clear()
        self.assertEqual(self.tts(text="Bonjour")[0].status, 503)
        self.assertEqual(self.tts(text="Bonjour", direction="Sad.")[0].status, 200)
        self.assertEqual(self.engine.loads, [srv.MODE_PLAYED])


class Memory(ServerCase):
    """Les deux modèles restent ensemble s'il y a la place ; sinon l'autre part, plutôt que planter."""

    def test_each_model_loads_lazily_and_both_stay_when_there_is_room(self):
        self.tts(text="Bonjour")
        self.assertEqual(self.health()["models"], {"frozen": True, "played": False})
        self.tts(text="Bonjour", direction="Sad.")
        self.assertEqual(self.health()["models"], {"frozen": True, "played": True})
        self.tts(text="Bonjour")
        self.assertEqual(self.engine.loads, [srv.MODE_FROZEN, srv.MODE_PLAYED])
        self.assertEqual(self.engine.unloads, [])

    def test_low_memory_unloads_the_other_model_before_loading(self):
        self.tts(text="Bonjour")
        self.free = 5 * GIB
        order: list[tuple] = []
        self.engine.on_load = lambda mode: order.append((mode, tuple(self.engine.unloads)))
        self.assertEqual(self.tts(text="Bonjour", direction="Sad.")[0].status, 200)
        self.assertEqual(order, [(srv.MODE_PLAYED, (srv.MODE_FROZEN,))])
        self.assertEqual(self.health()["models"], {"frozen": False, "played": True})
        self.assertIn({"event": "model_swapped_out", "mode": "frozen", "why": "memory_low"}, self.logged)

    def test_unknown_memory_also_unloads_the_other_model(self):
        self.tts(text="Bonjour")
        self.free = None
        self.assertEqual(self.tts(text="Bonjour", direction="Sad.")[0].status, 200)
        self.assertEqual(self.engine.unloads, [srv.MODE_FROZEN])

    def test_low_memory_with_nothing_to_unload_still_tries(self):
        self.free = 1 * GIB
        self.assertEqual(self.tts(text="Bonjour")[0].status, 200)
        self.assertEqual(self.engine.unloads, [])

    def test_out_of_memory_while_loading_unloads_the_other_and_retries_once(self):
        self.tts(text="Bonjour")
        attempts: list[str] = []

        def fail_once(mode: str) -> None:
            attempts.append(mode)
            if len(attempts) == 1:
                raise out_of_memory()

        self.engine.on_load = fail_once
        self.assertEqual(self.tts(text="Bonjour", direction="Sad.")[0].status, 200)
        self.assertEqual(attempts, [srv.MODE_PLAYED, srv.MODE_PLAYED])
        self.assertEqual(self.engine.unloads, [srv.MODE_FROZEN])
        self.assertEqual(self.health()["models"], {"frozen": False, "played": True})

    def test_out_of_memory_while_loading_twice_says_503_and_frees_everything(self):
        self.tts(text="Bonjour")

        def always(_mode: str) -> None:
            raise out_of_memory()

        self.engine.on_load = always
        response, data = self.tts(text="Bonjour", direction="Sad.")
        self.assertEqual(response.status, 503)
        self.assertEqual(json.loads(data)["reason"], "gpu_memory")
        self.assertEqual(self.engine.unloads, [srv.MODE_FROZEN, None])
        self.assertFalse(self.health()["model_loaded"])

    def test_out_of_memory_during_synthesis_unloads_the_other_and_retries_once(self):
        self.tts(text="Bonjour")
        self.tts(text="Bonjour", direction="Sad.")
        self.engine.calls.clear()
        self.engine.errors = [out_of_memory()]
        self.assertEqual(self.tts(text="Encore", direction="Sad.")[0].status, 200)
        self.assertEqual([job.text for job in self.engine.calls], ["Encore", "Encore"])
        self.assertEqual(self.engine.unloads, [srv.MODE_FROZEN])
        self.assertEqual(self.health()["models"], {"frozen": False, "played": True})

    def test_swapping_back_works(self):
        self.tts(text="Bonjour")
        self.free = 1 * GIB
        self.tts(text="Bonjour", direction="Sad.")
        self.assertEqual(self.tts(text="Bonjour")[0].status, 200)
        self.assertEqual(self.engine.loads, [srv.MODE_FROZEN, srv.MODE_PLAYED, srv.MODE_FROZEN])
        self.assertEqual(self.engine.unloads, [srv.MODE_FROZEN, srv.MODE_PLAYED])

    def test_real_sysfs_reading_takes_the_biggest_card(self):
        root = self.dir / "drm"
        for card, total, used in (("card0", 1000, 900), ("card1", 5000, 1200)):
            device = root / card / "device"
            device.mkdir(parents=True)
            (device / "mem_info_vram_total").write_text(f"{total}\n")
            (device / "mem_info_vram_used").write_text(f"{used}\n")
        self.assertEqual(srv.read_free_vram(root), 3800)
        self.assertIsNone(srv.read_free_vram(self.dir / "absent"))
        (root / "card1" / "device" / "mem_info_vram_used").write_text("illisible")
        self.assertIsNone(srv.read_free_vram(root))


class FirstLoad(ServerCase):
    """Le premier chargement dure 20 à 60 s : /health le dit, et /load le lance sans synthèse."""

    def hold_load(self) -> threading.Event:
        release = threading.Event()
        self.addCleanup(release.set)
        self.engine.on_load = lambda _mode: release.wait(10)
        return release

    def wait_for_unload(self) -> None:
        deadline = time.monotonic() + 5
        while not self.engine.unloads and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertEqual(self.engine.unloads, [None])

    def test_health_says_unloaded_before_any_request(self):
        payload = self.health()
        self.assertEqual(payload["state"], "unloaded")
        self.assertNotIn("loading_since_s", payload)

    def test_health_answers_at_once_during_a_load_and_says_since_when(self):
        release = self.hold_load()
        self.assertEqual(self.request("POST", "/load")[0].status, 202)
        self.wait_for_state("loading")
        started = time.monotonic()
        payload = self.health()
        self.assertLess(time.monotonic() - started, 0.5, "/health ne doit pas attendre le chargement")
        self.assertFalse(payload["model_loaded"])
        self.assertGreaterEqual(payload["loading_since_s"], 0)
        self.assertEqual(payload["loading"], ["frozen"])
        release.set()
        payload = self.wait_for_state("ready")
        self.assertTrue(payload["model_loaded"])
        self.assertNotIn("loading_since_s", payload)
        self.assertEqual(self.engine.calls, [], "/load ne synthétise rien")

    def test_load_can_name_the_played_model(self):
        response, data = self.request("POST", "/load?mode=played")
        self.assertEqual(response.status, 202)
        self.assertEqual(json.loads(data), {"state": "loading", "mode": "played"})
        self.wait_for_state("ready")
        self.assertEqual(self.engine.loads, [srv.MODE_PLAYED])

    def test_load_refuses_an_unknown_mode(self):
        self.assertEqual(self.request("POST", "/load?mode=../../etc")[0].status, 400)
        self.assertEqual(self.engine.loads, [])

    def test_both_models_load_one_after_the_other(self):
        release = self.hold_load()
        self.assertEqual(self.request("POST", "/load")[0].status, 202)
        self.assertEqual(self.request("POST", "/load?mode=played")[0].status, 202)
        self.assertEqual(self.wait_for_state("loading")["loading"], ["frozen", "played"])
        release.set()
        self.wait_for_state("ready")
        self.assertEqual(sorted(self.engine.loads), ["frozen", "played"])

    def test_a_tts_request_loading_the_model_is_also_reported(self):
        release = self.hold_load()
        result: list = []
        thread = threading.Thread(target=lambda: result.append(self.tts(text="Bonjour")[0].status))
        thread.start()
        self.wait_for_state("loading")
        release.set()
        thread.join(5)
        self.assertEqual(result, [200])
        self.assertEqual(self.health()["state"], "ready")

    def test_load_twice_loads_once(self):
        release = self.hold_load()
        self.assertEqual(self.request("POST", "/load")[0].status, 202)
        self.assertEqual(self.request("POST", "/load")[0].status, 202)
        release.set()
        self.wait_for_state("ready")
        self.assertEqual(self.request("POST", "/load")[0].status, 200)
        self.assertEqual(self.engine.loads, [srv.MODE_FROZEN])

    def test_tts_waits_for_a_background_load_without_loading_again(self):
        release = self.hold_load()
        self.request("POST", "/load")
        self.wait_for_state("loading")
        result: list = []
        thread = threading.Thread(target=lambda: result.append(self.tts(text="Bonjour")[0].status))
        thread.start()
        release.set()
        thread.join(5)
        self.assertEqual(result, [200])
        self.assertEqual(self.engine.loads, [srv.MODE_FROZEN])

    def test_load_refused_in_game_mode_without_touching_the_gpu(self):
        self.flag.touch()
        response, data = self.request("POST", "/load")
        self.assertEqual(response.status, 503)
        self.assertEqual(json.loads(data)["reason"], "gpu_yield")
        self.assertEqual(self.engine.loads, [])
        self.assertEqual(self.health()["state"], "yielded")

    def test_game_mode_starting_during_a_background_load_releases_the_model(self):
        release = self.hold_load()
        self.request("POST", "/load")
        self.wait_for_state("loading")
        self.flag.touch()
        self.assertEqual(self.health()["state"], "yielded")
        release.set()
        self.wait_for_unload()
        self.assertFalse(self.engine.loaded)
        self.flag.unlink()
        self.assertFalse(self.wait_for_state("unloaded")["model_loaded"])

    def test_a_failed_background_load_leaves_a_clean_state_and_never_the_exception_text(self):
        def explode(_mode: str) -> None:
            raise RuntimeError(f"CUDA out of memory {SECRET}")

        self.engine.on_load = explode
        self.assertEqual(self.request("POST", "/load")[0].status, 202)
        self.wait_for_unload()
        self.wait_for_state("unloaded")
        self.assertNotIn(SECRET, json.dumps(self.logged, ensure_ascii=False))

    def test_load_obeys_the_same_origin_rules_as_tts(self):
        response, _ = self.request("POST", "/load", headers={"Origin": "https://evil.example"})
        self.assertEqual(response.status, 403)
        self.assertEqual(self.engine.loads, [])

    def test_503_says_why_for_the_client(self):
        self.flag.touch()
        response, data = self.tts(text="Bonjour")
        self.assertEqual(response.status, 503)
        self.assertEqual(json.loads(data)["reason"], "gpu_yield")
        self.flag.unlink()

        def explode(_mode: str) -> None:
            raise out_of_memory()

        self.engine.on_load = explode
        response, data = self.tts(text="Bonjour")
        self.assertEqual(response.status, 503)
        self.assertEqual(json.loads(data)["reason"], "gpu_memory")


class Refusals(ServerCase):
    def test_voice_url_never_accepts_a_path_or_an_url(self):
        attempts = ["../../etc/passwd", "/etc/passwd", "http://exemple.org/v.wav", "https://exemple.org/v", "file:///etc/passwd", "out-gao/naturel1-s11.wav", "FR-ESSAIS-21-22", f"{self.voice}/../x"]
        for voice in attempts:
            for extra in ({}, {"direction": "Sad."}):
                with self.subTest(voice=voice, extra=extra):
                    response, data = self.tts(text="Bonjour", voice_url=voice, **extra)
                    self.assertEqual(response.status, 400)
                    self.assertIn("catalogue", json.loads(data)["detail"])
        self.assertEqual(self.engine.loads, [])
        self.assertEqual(self.engine.calls, [])

    def test_uploaded_file_is_refused(self):
        upload = f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="voice_wav"; filename="a.wav"\r\n\r\nRIFF\r\n'.encode()
        body, content_type = multipart({"text": "Bonjour"}, upload)
        response, _ = self.request("POST", "/tts", body, {"Content-Type": content_type})
        self.assertEqual(response.status, 400)
        self.assertEqual(self.engine.loads, [])

    def test_text_limits(self):
        self.assertEqual(self.tts(text="   ")[0].status, 400)
        self.assertEqual(self.tts(voice_url=self.voice)[0].status, 400)
        self.assertEqual(self.tts(text="x" * (srv.MAX_TEXT_CHARS + 1))[0].status, 413)
        self.assertEqual(self.tts(text="x" * srv.MAX_TEXT_CHARS)[0].status, 200)

    def test_oversized_body_is_refused_before_reading_it(self):
        response, _ = self.request("POST", "/tts", b"x" * (srv.MAX_BODY_BYTES + 1), {"Content-Type": "multipart/form-data; boundary=x"})
        self.assertEqual(response.status, 413)

    def test_only_this_machine_may_ask(self):
        body, content_type = multipart({"text": "Bonjour"})
        cases = [{"Host": "exemple.org"}, {"Host": "127.0.0.1.exemple.org:8021"}, {"Host": "localhost", "Origin": "https://exemple.org"}]
        for headers in cases:
            with self.subTest(headers=headers):
                self.assertEqual(self.request("POST", "/tts", body, {"Content-Type": content_type, **headers})[0].status, 403)
                self.assertEqual(self.request("GET", "/health", None, headers)[0].status, 403)
        self.assertEqual(self.engine.calls, [])

    def test_a_voice_without_its_reference_says_so(self):
        self.references.clear()
        response, data = self.tts(text="Bonjour")
        self.assertEqual(response.status, 503)
        self.assertIn("extrait", json.loads(data)["detail"])
        self.assertEqual(self.engine.loads, [])

    def test_unknown_routes(self):
        self.assertEqual(self.request("GET", "/etc/passwd")[0].status, 404)
        self.assertEqual(self.request("POST", "/autre", b"", {"Content-Type": "text/plain"})[0].status, 404)


class GameMode(ServerCase):
    def test_active_flag_answers_503_without_touching_the_model(self):
        self.flag.touch()
        for extra in ({}, {"direction": "Sad."}):
            response, data = self.tts(text="Bonjour", **extra)
            self.assertEqual(response.status, 503)
            self.assertIn("Mode jeu", json.loads(data)["detail"])
            self.assertEqual(response.getheader("Retry-After"), "60")
        self.assertEqual((self.engine.loads, self.engine.calls), ([], []))

    def test_health_stays_up_and_tells_it_without_loading(self):
        self.flag.touch()
        response, data = self.request("GET", "/health")
        self.assertEqual(response.status, 200)
        self.assertTrue(json.loads(data)["gpu_yield"])
        self.assertEqual(self.engine.loads, [])

    def test_starting_during_the_load_stops_before_any_synthesis_and_frees_the_model(self):
        self.engine.on_load = lambda _mode: self.flag.touch()
        response, _ = self.tts(text="Bonjour")
        self.assertEqual(response.status, 503)
        self.assertEqual(self.engine.calls, [])
        self.assertEqual(self.engine.unloads, [None])

    def test_starting_during_a_synthesis_stops_it_and_frees_the_model(self):
        self.engine.hold.set()
        result: dict = {}
        thread = threading.Thread(target=lambda: result.update(status=self.tts(text="Bonjour", direction="Sad.")[0].status))
        thread.start()
        self.assertTrue(self.engine.started.wait(5))
        self.flag.touch()
        thread.join(5)
        self.assertEqual(result["status"], 503)
        self.assertEqual((self.engine.active, self.engine.unloads), (0, [None]))

    def test_waiting_in_the_queue_also_yields(self):
        self.engine.hold.set()
        statuses: list[int] = []
        threads = [threading.Thread(target=lambda: statuses.append(self.tts(text="Bonjour")[0].status)) for _ in range(2)]
        threads[0].start()
        self.assertTrue(self.engine.started.wait(5))
        threads[1].start()
        time.sleep(0.2)
        self.flag.touch()
        for thread in threads:
            thread.join(5)
        self.assertEqual(statuses, [503, 503])
        self.assertEqual(len(self.engine.calls), 1)

    def test_maintain_frees_both_idle_models_only_in_game_mode(self):
        self.tts(text="Bonjour")
        self.tts(text="Bonjour", direction="Sad.")
        self.assertEqual(self.engine.loaded, {srv.MODE_FROZEN, srv.MODE_PLAYED})
        self.service.maintain()
        self.assertEqual(self.engine.loaded, {srv.MODE_FROZEN, srv.MODE_PLAYED})
        self.flag.touch()
        self.service.maintain()
        self.assertFalse(self.engine.loaded)
        self.assertEqual(self.engine.unloads, [None])

    def test_back_to_work_after_the_game(self):
        self.flag.touch()
        self.assertEqual(self.tts(text="Bonjour")[0].status, 503)
        self.flag.unlink()
        self.assertEqual(self.tts(text="Bonjour")[0].status, 200)

    def test_flag_path_follows_the_runtime_dir(self):
        with mock.patch.dict(os.environ, {"XDG_RUNTIME_DIR": "/run/user/4242"}):
            self.assertEqual(srv.yield_flag_path(), Path("/run/user/4242/gpu-yield/active"))


class OneAtATime(ServerCase):
    def test_a_disconnected_client_cancels_its_synthesis_and_the_next_one_runs(self):
        self.engine.hold.set()
        sock = self.raw_tts(direction="Sad.")
        self.assertTrue(self.engine.started.wait(5))
        sock.close()
        self.assertTrue(self.engine.cancelled.wait(5))
        self.engine.hold.clear()
        response, data = self.tts(text="Suivante")
        self.assertEqual(response.status, 200)
        self.assert_wav(data)

    def test_a_disconnected_client_leaves_the_queue_without_synthesizing(self):
        self.engine.hold.set()
        result: dict = {}
        first = threading.Thread(target=lambda: result.update(status=self.tts(text="Première")[0].status))
        first.start()
        self.assertTrue(self.engine.started.wait(5))
        waiting = self.raw_tts("Partie")
        time.sleep(0.2)
        waiting.close()
        time.sleep(0.3)
        self.engine.hold.clear()
        first.join(5)
        self.assertEqual(result["status"], 200)
        self.assertEqual([job.text for job in self.engine.calls], ["Première"])

    def test_requests_never_overlap_and_run_in_order_across_both_modes(self):
        self.engine.hold.set()
        statuses: list[int] = []
        threads = []
        for index in range(4):
            extra = {"direction": "Sad."} if index % 2 else {}
            thread = threading.Thread(target=lambda n=index, e=extra: statuses.append(self.tts(text=f"phrase {n}", **e)[0].status))
            thread.start()
            threads.append(thread)
            if index == 0:
                self.assertTrue(self.engine.started.wait(5))
            time.sleep(0.15)
        self.engine.hold.clear()
        for thread in threads:
            thread.join(10)
        self.assertEqual(statuses, [200] * 4)
        self.assertEqual(self.engine.max_active, 1)
        self.assertEqual([job.text for job in self.engine.calls], [f"phrase {n}" for n in range(4)])

    def test_a_full_queue_is_refused_clearly(self):
        self.engine.hold.set()
        sockets = [self.raw_tts() for _ in range(srv.MAX_PENDING + 1)]
        self.assertTrue(self.engine.started.wait(5))
        time.sleep(0.3)
        response, data = self.tts(text="De trop")
        self.assertEqual(response.status, 503)
        self.assertIn("attente", json.loads(data)["detail"])
        for sock in sockets:
            sock.close()


class Privacy(ServerCase):
    def test_nothing_ever_logs_the_text_or_the_direction(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            ok = self.tts(text=SECRET, direction=SECRET_DIRECTION)
            self.request("POST", f"/tts?text={quote(SECRET)}&direction={quote(SECRET_DIRECTION)}", b"", {"Content-Type": "multipart/form-data"})
            self.tts(text=SECRET, voice_url=SECRET.replace(" ", "-"), direction=SECRET_DIRECTION)
            self.engine.errors = [RuntimeError(f"tenseur invalide pour {SECRET} {SECRET_DIRECTION}")]
            failed = self.tts(text=SECRET, direction=SECRET_DIRECTION)
        self.assertEqual(ok[0].status, 200)
        self.assertEqual(failed[0].status, 500)
        self.assertNotIn("manuscrit", failed[1].decode())
        everything = stdout.getvalue() + stderr.getvalue() + json.dumps(self.logged, ensure_ascii=False)
        self.assertNotIn("manuscrit", everything)
        self.assertNotIn("manuscript", everything)
        self.assertIn({"event": "synthesis_failed", "error": "RuntimeError"}, self.logged)
        served = [row for row in self.logged if row["event"] == "request" and row["status"] == 200]
        self.assertEqual(served[0]["text_chars"], len(SECRET))
        self.assertEqual(served[0]["direction_chars"], len(SECRET_DIRECTION))
        self.assertEqual(served[0]["mode"], "played")

    def test_real_emit_writes_one_json_line(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            srv.emit("request", status=200)
        record = json.loads(out.getvalue())
        self.assertEqual((record["service"], record["event"], record["status"]), ("qwen3", "request", 200))

    def test_out_of_memory_says_the_gpu_is_shared_and_frees_the_model(self):
        class OutOfMemoryError(RuntimeError):
            pass

        self.engine.errors = [OutOfMemoryError("vram")]
        response, data = self.tts(text="Bonjour")
        self.assertEqual(response.status, 503)
        self.assertIn("GPU", json.loads(data)["detail"])
        self.assertEqual(self.engine.unloads, [None])

    def test_loading_failure_is_a_clean_500_and_a_later_request_retries(self):
        def broken(_mode: str) -> None:
            raise OSError(f"introuvable {SECRET}")

        self.engine.on_load = broken
        response, data = self.tts(text="Bonjour")
        self.assertEqual(response.status, 500)
        self.assertNotIn("manuscrit", data.decode())
        self.engine.on_load = lambda _mode: None
        self.assertEqual(self.tts(text="Bonjour")[0].status, 200)


class Catalogue(unittest.TestCase):
    """L'extrait de référence se change dans voices.json, sans toucher au code."""

    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="qwen3-catalog-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.root = self.dir / "refs"
        self.root.mkdir()
        self.logged: list[dict] = []

    def write(self, refs: list[dict]) -> srv.Catalog:
        path = self.dir / "voices.json"
        voice = {"name": "Essai", "seed": 7, "description": "D.", "accent": "A.", "frozen_refs": refs}
        path.write_text(json.dumps({"default": "essai", "language": "French", "voices": {"essai": voice}}), encoding="utf-8")
        return srv.load_catalog(path)

    def find(self, catalog: srv.Catalog) -> dict:
        return srv.find_references(catalog, self.root, log=lambda event, **fields: self.logged.append({"event": event, **fields}))

    def test_the_shipped_catalogue_names_no_absolute_path_and_only_the_chosen_voice(self):
        catalog = srv.load_catalog()
        self.assertEqual(catalog.default, "fr-essais-21-22")
        self.assertEqual(catalog.language, "French")
        voice = catalog.voices["fr-essais-21-22"]
        self.assertEqual(voice.seed, 11)
        self.assertEqual([ref["audio"] for ref in voice.frozen_refs], ["out-gao/rire-en-s11.wav", "out-gao/chuchote-en-s11.wav"])
        self.assertFalse(list((ROOT / "deploy" / "qwen3").glob("*.wav")), "aucun extrait audio dans le dépôt")

    def test_text_comes_from_the_neighbour_json_or_from_the_catalogue(self):
        (self.root / "a.wav").touch()
        (self.root / "a.json").write_text(json.dumps({"text": "Texte voisin."}), encoding="utf-8")
        (self.root / "b.wav").touch()
        found = self.find(self.write([{"audio": "a.wav"}, {"audio": "b.wav", "text": "Texte du catalogue."}]))
        self.assertEqual([ref.text for ref in found["essai"]], ["Texte voisin.", "Texte du catalogue."])
        self.assertEqual(found["essai"][0].audio, (self.root / "a.wav").resolve())

    def test_replacing_the_reference_needs_no_code(self):
        for name in ("a", "b"):
            (self.root / f"{name}.wav").touch()
            (self.root / f"{name}.json").write_text(json.dumps({"text": name}), encoding="utf-8")
        self.assertEqual(self.find(self.write([{"audio": "a.wav"}]))["essai"][0].text, "a")
        self.assertEqual(self.find(self.write([{"audio": "b.wav"}]))["essai"][0].text, "b")

    def test_a_reference_outside_the_root_is_refused(self):
        outside = self.dir / "dehors.wav"
        outside.touch()
        (self.root / "lien.wav").symlink_to(outside)
        for audio in ("../dehors.wav", str(outside), "lien.wav"):
            with self.subTest(audio=audio):
                self.assertEqual(self.find(self.write([{"audio": audio, "text": "T"}])), {})
        self.assertEqual(self.logged[0]["event"], "voice_reference_missing")

    def test_a_missing_file_or_text_makes_the_voice_unavailable_not_the_server(self):
        self.assertEqual(self.find(self.write([{"audio": "absent.wav", "text": "T"}])), {})
        (self.root / "seul.wav").touch()
        self.assertEqual(self.find(self.write([{"audio": "seul.wav"}])), {})
        (self.root / "vide.wav").touch()
        self.assertEqual(self.find(self.write([{"audio": "vide.wav", "text": "  "}])), {})

    def test_a_default_outside_the_catalogue_stops_the_start(self):
        path = self.dir / "voices.json"
        path.write_text(json.dumps({"default": "x", "language": "French", "voices": {}}), encoding="utf-8")
        with self.assertRaises(ValueError):
            srv.load_catalog(path)


class Setup(unittest.TestCase):
    def test_defaults_are_loopback_and_port_8021(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("QWEN3_HOST", None)
            args = srv.build_parser().parse_args([])
        self.assertEqual((args.host, args.port), ("127.0.0.1", 8021))

    def test_really_binds_loopback_only(self):
        catalog = srv.load_catalog()
        service = srv.Qwen3Service(FakeEngine(), catalog, {}, Path("/nonexistent/active"))
        server = srv.serve(service, port=0)
        self.addCleanup(server.server_close)
        self.assertEqual(server.server_address[0], "127.0.0.1")

    def test_force_offline_overrides_the_environment(self):
        with mock.patch.dict(os.environ, {"HF_HUB_OFFLINE": "0", "TRANSFORMERS_OFFLINE": "0"}):
            srv.force_offline_env()
            self.assertEqual((os.environ["HF_HUB_OFFLINE"], os.environ["TRANSFORMERS_OFFLINE"]), ("1", "1"))

    def test_main_forces_offline_before_anything(self):
        with mock.patch.dict(os.environ, {"HF_HUB_OFFLINE": "0"}), mock.patch.object(srv, "serve", side_effect=KeyError("stop")):
            with self.assertRaises(KeyError):
                srv.main(["--port", "0"])
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")

    def test_compose_service_is_opt_in_loopback_and_never_restarts(self):
        compose = (ROOT / "deploy" / "docker-compose.tts.yml").read_text(encoding="utf-8")
        block = compose.split("\n  qwen3:\n", 1)[1]
        block = re.split(r"\n  [a-z0-9_-]+:\n", block, maxsplit=1)[0]
        self.assertIn('profiles: ["qwen3"]', block)
        self.assertIn('"127.0.0.1:8021:8021"', block)
        self.assertIn('restart: "no"', block)
        self.assertIn("pull_policy: never", block)
        self.assertIn("image: deploy-chatterbox:latest", block)
        self.assertIn('user: "${LLM_VOICE_UID:-1000}:${LLM_VOICE_GID:-1000}"', block)
        self.assertIn("HF_HUB_OFFLINE=1", block)
        self.assertIn("create_host_path: false", block)
        self.assertNotIn("HSA_OVERRIDE_GFX_VERSION=", block)
        self.assertNotIn("build:", block)
        volumes = re.findall(r"^\s+- \$\{HOME\}.*$", block, flags=re.M)
        self.assertTrue(volumes)
        for volume in volumes:
            self.assertTrue(volume.endswith(":ro"), volume)


class RealAdapter(unittest.TestCase):
    """`QwenEngine` contre de faux torch et qwen_tts : la forme des appels et l'interruption, pas la voix."""

    def setUp(self) -> None:
        try:
            import numpy
        except ImportError:
            self.skipTest("numpy absent")
        self.numpy = numpy
        self.dir = Path(tempfile.mkdtemp(prefix="qwen3-adapter-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        for name, frames in (("a", 240), ("b", 480)):
            with wave.open(str(self.dir / f"{name}.wav"), "wb") as out:
                out.setnchannels(1)
                out.setsampwidth(2)
                out.setframerate(24000)
                out.writeframes(b"\x00\x40" * frames)
        self.references = {
            "v": (srv.Reference(self.dir / "a.wav", "Un."), srv.Reference(self.dir / "b.wav", "Deux.")),
        }

    def stubs(self):
        numpy = self.numpy
        calls = types.SimpleNamespace(paths=[], kwargs=[], emptied=0, seeds=[], clone=[], design=[], prompt=[], frames=0, hooks=0, offline=[])

        class Talker:
            def __init__(self) -> None:
                self.hook = None

            def register_forward_pre_hook(self, function):
                self.hook = function
                calls.hooks += 1
                talker = self

                class Handle:
                    def remove(self) -> None:
                        talker.hook = None

                return Handle()

            def step(self) -> None:
                calls.frames += 1
                self.hook(self, ())

        class Model:
            def __init__(self) -> None:
                self.model = types.SimpleNamespace(talker=Talker())

            def _generate(self):
                for _ in range(3):
                    self.model.talker.step()
                return [numpy.array([2.0, 0.5, -3.0], dtype="float32")], 24000

            def create_voice_clone_prompt(self, ref_audio, ref_text, x_vector_only_mode):
                calls.prompt.append((ref_audio, ref_text, x_vector_only_mode))
                return "prompt"

            def generate_voice_clone(self, text, language, voice_clone_prompt):
                calls.clone.append((text, language, voice_clone_prompt))
                return self._generate()

            def generate_voice_design(self, text, language, instruct):
                calls.design.append((text, language, instruct))
                return self._generate()

        class Qwen3TTSModel:
            @staticmethod
            def from_pretrained(path, **kwargs):
                calls.paths.append(path)
                calls.kwargs.append(kwargs)
                return Model()

        def snapshot_download(repo, local_files_only):
            calls.offline.append((repo, local_files_only, os.environ["HF_HUB_OFFLINE"]))
            return f"/snapshots/{repo}"

        def empty() -> None:
            calls.emptied += 1

        torch = types.SimpleNamespace(
            bfloat16="bfloat16",
            manual_seed=calls.seeds.append,
            cuda=types.SimpleNamespace(is_available=lambda: True, empty_cache=empty),
        )
        modules = {
            "torch": torch,
            "huggingface_hub": types.SimpleNamespace(snapshot_download=snapshot_download),
            "qwen_tts": types.SimpleNamespace(Qwen3TTSModel=Qwen3TTSModel),
        }
        return calls, modules

    def test_same_settings_as_the_bench_offline_and_interruptible(self):
        calls, modules = self.stubs()
        with mock.patch.dict(sys.modules, modules), mock.patch.dict(os.environ, {"HF_HUB_OFFLINE": "0"}):
            engine = srv.QwenEngine("French", self.references, "cuda")
            self.assertFalse(engine.loaded)

            engine.load(srv.MODE_FROZEN)
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
            self.assertEqual(engine.loaded, {srv.MODE_FROZEN})
            self.assertEqual(calls.offline, [("Qwen/Qwen3-TTS-12Hz-1.7B-Base", True, "1")])
            self.assertEqual(calls.kwargs[0], {"device_map": "cuda", "dtype": "bfloat16", "attn_implementation": "sdpa"})

            # Les deux extraits, chacun suivi de 0,3 s de silence, et leurs textes bout à bout.
            (audio, rate), text, xvec = calls.prompt[0]
            self.assertEqual((rate, text, xvec), (24000, "Un. Deux.", False))
            self.assertEqual(audio.size, 240 + 7200 + 480 + 7200)
            self.assertAlmostEqual(float(audio[0]), 0.5)

            job = srv.Job(srv.MODE_FROZEN, "Bonjour", "v", 11)
            pcm, rate = engine.synthesize(job, lambda: None)
            self.assertEqual(rate, 24000)
            self.assertEqual(calls.seeds, [11])
            self.assertEqual(calls.clone, [("Bonjour", "French", "prompt")])
            self.assertEqual(len(calls.prompt), 1, "la référence n'est encodée qu'une fois")
            self.assertEqual(pcm[:2], (32767).to_bytes(2, "little"))  # écrêté à 1,0
            self.assertEqual(pcm[4:6], (-32767).to_bytes(2, "little", signed=True))
            self.assertEqual(len(pcm), 3 * 2)

            with self.assertRaises(srv.VoiceUnavailable):
                engine.synthesize(srv.Job(srv.MODE_FROZEN, "Bonjour", "inconnue", 11), lambda: None)

            engine.load(srv.MODE_PLAYED)
            self.assertEqual(engine.loaded, {srv.MODE_FROZEN, srv.MODE_PLAYED})
            self.assertEqual(calls.offline[1], ("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", True, "1"))
            played = srv.Job(srv.MODE_PLAYED, "Bonjour", "v", 22, "Consigne")
            engine.synthesize(played, lambda: None)
            self.assertEqual(calls.seeds, [11, 22])
            self.assertEqual(calls.design, [("Bonjour", "French", "Consigne")])

            def stop() -> None:
                raise srv.Cancelled()

            calls.frames = 0
            with self.assertRaises(srv.Cancelled):
                engine.synthesize(played, stop)
            self.assertEqual(calls.frames, 1, "arrêt dès la première trame")
            self.assertIsNone(engine._models[srv.MODE_PLAYED].model.talker.hook, "le crochet ne survit pas")

            engine.unload(srv.MODE_PLAYED)
            self.assertEqual(engine.loaded, {srv.MODE_FROZEN})
            self.assertEqual(calls.emptied, 1)
            self.assertEqual(engine._prompts, {"v": "prompt"}, "décharger l'autre modèle garde la référence")

            engine.unload()
            self.assertFalse(engine.loaded)
            self.assertEqual(engine._prompts, {})
            self.assertEqual(calls.emptied, 2)

    def test_an_unreadable_reference_only_costs_that_voice(self):
        calls, modules = self.stubs()
        (self.dir / "abime.wav").write_bytes(b"pas un wav")
        references = {**self.references, "abimee": (srv.Reference(self.dir / "abime.wav", "T."),)}
        out = io.StringIO()
        with mock.patch.dict(sys.modules, modules), contextlib.redirect_stdout(out):
            engine = srv.QwenEngine("French", references, "cuda")
            engine.load(srv.MODE_FROZEN)
            engine.synthesize(srv.Job(srv.MODE_FROZEN, "Bonjour", "v", 11), lambda: None)
            with self.assertRaises(srv.VoiceUnavailable):
                engine.synthesize(srv.Job(srv.MODE_FROZEN, "Bonjour", "abimee", 11), lambda: None)
        self.assertIn('"voice_prompt_failed"', out.getvalue())

    def test_no_gpu_says_so(self):
        calls, modules = self.stubs()
        modules["torch"].cuda.is_available = lambda: False
        with mock.patch.dict(sys.modules, modules):
            with self.assertRaises(srv.GpuUnavailable):
                srv.QwenEngine("French", self.references, "cuda").load(srv.MODE_PLAYED)
        self.assertEqual(calls.paths, [])


class Weights:
    """Remplace les poids : un `weakref` dit si plus rien ne les retient."""


class HoldingEngine:
    """Comme `QwenEngine` : `synthesize` garde le modèle dans une variable locale."""

    def __init__(self, on_synthesize=None, on_load=None) -> None:
        self.models: dict[str, Weights] = {}
        self.on_synthesize = on_synthesize
        self.on_load = on_load
        self.freed_at_unload: list[bool] = []
        self.references: dict[str, object] = {}

    @property
    def loaded(self):
        return frozenset(self.models)

    def load(self, mode: str) -> None:
        if self.on_load is not None:
            self.on_load(mode)
        self.models[mode] = Weights()
        self.references[mode] = weakref.ref(self.models[mode])

    def unload(self, mode: str | None = None) -> None:
        names = list(self.models) if mode is None else [mode]
        watched = [self.references[name] for name in names if name in self.references]
        for name in names:
            self.models.pop(name, None)
        gc.collect()
        self.freed_at_unload.append(all(reference() is None for reference in watched))

    def synthesize(self, job, checkpoint):
        model = self.models[job.mode]
        self.on_synthesize(checkpoint)
        return (repr(model).encode(), 24000)


class ReleaseTest(unittest.TestCase):
    """La mémoire ne se libère que si plus rien ne retient le modèle au moment de `unload`."""

    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="qwen3-release-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.flag = self.dir / "active"
        self.free = 12 * GIB

    def service(self, engine) -> srv.Qwen3Service:
        catalog = srv.load_catalog()
        references = {catalog.default: (srv.Reference(self.dir / "ref.wav", "T."),)}
        return srv.Qwen3Service(engine, catalog, references, self.flag, log=lambda *_a, **_k: None, free_vram=lambda: self.free, min_free_vram=6 * GIB)

    def request(self, direction: str = "") -> srv.Request:
        return srv.Request("texte", "fr-essais-21-22", direction)

    def test_game_mode_during_synthesis_really_frees_the_model(self):
        def start_game(checkpoint) -> None:
            self.flag.touch()
            checkpoint()

        engine = HoldingEngine(start_game)
        with self.assertRaises(srv.GpuYielded):
            self.service(engine).synthesize(self.request(), lambda: False)
        self.assertEqual(engine.freed_at_unload, [True])

    def test_out_of_memory_during_synthesis_really_frees_the_model(self):
        class OutOfMemoryError(Exception):
            pass

        def explode(_checkpoint) -> None:
            raise OutOfMemoryError("le texte secret")

        engine = HoldingEngine(explode)
        with self.assertRaises(srv.GpuUnavailable):
            self.service(engine).synthesize(self.request(), lambda: False)
        self.assertEqual(engine.freed_at_unload, [True])

    def test_out_of_memory_during_the_load_still_empties_the_cache(self):
        def explode(_mode) -> None:
            raise out_of_memory()

        engine = HoldingEngine(on_load=explode)
        with self.assertRaises(srv.GpuUnavailable):
            self.service(engine).synthesize(self.request(), lambda: False)
        self.assertEqual(engine.freed_at_unload, [True])

    def test_swapping_out_on_out_of_memory_really_frees_the_other_model(self):
        state = {"fail": True}

        def fail_once(checkpoint) -> None:
            if state["fail"]:
                state["fail"] = False
                raise out_of_memory()

        engine = HoldingEngine(lambda _checkpoint: None)
        service = self.service(engine)
        service.synthesize(self.request(), lambda: False)
        service.synthesize(self.request("Sad."), lambda: False)
        engine.on_synthesize = fail_once
        service.synthesize(self.request("Sad."), lambda: False)
        self.assertEqual(engine.freed_at_unload, [True])
        self.assertEqual(engine.loaded, {srv.MODE_PLAYED})

    def test_an_unreadable_flag_leaves_the_gpu_to_the_game(self):
        class Unreadable:
            def exists(self) -> bool:
                raise PermissionError

        service = self.service(HoldingEngine())
        service.yield_flag = Unreadable()
        self.assertTrue(service.yielding())


if __name__ == "__main__":
    unittest.main(verbosity=1)
