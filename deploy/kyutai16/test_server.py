#!/usr/bin/env python3
"""Tests du serveur Kyutai 1.6B avec un faux modèle : aucun GPU, aucun réseau hors boucle locale.

    python3 deploy/kyutai16/test_server.py
"""
from __future__ import annotations

import contextlib
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
from pathlib import Path
from unittest import mock
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server as srv  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SECRET = "Le manuscrit confidentiel de Camille à l'été"
BOUNDARY = "----kyutai16test"


def multipart(fields: dict[str, str], extra: bytes = b"") -> tuple[bytes, str]:
    parts = b""
    for name, value in fields.items():
        parts += f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
    parts += extra + f"--{BOUNDARY}--\r\n".encode()
    return parts, f"multipart/form-data; boundary={BOUNDARY}"


class FakeEngine:
    def __init__(self) -> None:
        self.loaded = False
        self.loads = 0
        self.unloads = 0
        self.calls: list[tuple[str, str]] = []
        self.active = 0
        self.max_active = 0
        self.hold = threading.Event()
        self.started = threading.Event()
        self.cancelled = threading.Event()
        self.on_load = lambda: None
        self.error: Exception | None = None

    def load(self) -> None:
        self.loads += 1
        self.on_load()
        self.loaded = True

    def unload(self) -> None:
        self.unloads += 1
        self.loaded = False

    def synthesize(self, text, voice_file, checkpoint):
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.calls.append((text, str(voice_file)))
        self.started.set()
        try:
            checkpoint()
            while self.hold.is_set():
                checkpoint()
                time.sleep(0.005)
            if self.error is not None:
                raise self.error
            return b"\x01\x00" * 2400, 24000
        except srv.Cancelled:
            self.cancelled.set()
            raise
        finally:
            self.active -= 1


class ServerCase(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="kyutai16-test-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.flag = self.dir / "gpu-yield" / "active"
        self.flag.parent.mkdir()
        self.engine = FakeEngine()
        self.catalog = srv.load_catalog()
        self.files = {voice: self.dir / f"{voice}.safetensors" for voice in self.catalog}
        self.logged: list[dict] = []
        self.service = srv.Kyutai16Service(
            self.engine, self.catalog, self.files, self.flag, log=lambda event, **fields: self.logged.append({"event": event, **fields})
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

    def raw_tts(self, text: str = "Bonjour") -> socket.socket:
        """Une requête laissée en attente sur une prise qu'on fermera nous-mêmes."""
        body, content_type = multipart({"text": text})
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        self.addCleanup(sock.close)
        head = f"POST /tts HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: {content_type}\r\nContent-Length: {len(body)}\r\n\r\n"
        sock.sendall(head.encode() + body)
        return sock

    def assert_wav(self, data: bytes) -> None:
        with wave.open(io.BytesIO(data)) as audio:
            self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate()), (1, 2, 24000))
            self.assertEqual(audio.getnframes(), 2400)


class Contract(ServerCase):
    def test_health_answers_what_the_provider_reads_and_loads_nothing(self):
        response, data = self.request("GET", "/health")
        self.assertEqual(response.status, 200)
        payload = json.loads(data)
        self.assertEqual(payload["status"], "healthy")
        self.assertFalse(payload["model_loaded"])
        self.assertEqual(self.engine.loads, 0)

    def test_voices_lists_the_catalogue_with_camille_first(self):
        _, data = self.request("GET", "/voices")
        payload = json.loads(data)
        self.assertEqual(payload["default"], "cml-577_394")
        self.assertEqual(payload["voices"][0], {"id": "cml-577_394", "name": "Camille", "available": True})
        self.assertEqual(len(payload["voices"]), 36)

    def test_multipart_returns_a_wav_keeps_accents_and_uses_the_named_voice(self):
        response, data = self.tts(text="Éléonore été là", voice_url="estelle")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Type"), "audio/wav")
        self.assert_wav(data)
        self.assertEqual(self.engine.calls, [("Éléonore été là", str(self.files["estelle"]))])

    def test_missing_voice_is_camille(self):
        self.tts(text="Bonjour")
        self.assertEqual(self.engine.calls[0][1], str(self.files["cml-577_394"]))

    def test_urlencoded_is_accepted(self):
        response, data = self.request(
            "POST", "/tts", "text=Bonjour&voice_url=estelle".encode(), {"Content-Type": "application/x-www-form-urlencoded"}
        )
        self.assertEqual(response.status, 200)
        self.assert_wav(data)

    def test_chunked_body_is_accepted(self):
        body, content_type = multipart({"text": "Découpé"})
        response, data = self.request(
            "POST", "/tts", iter([body[:40], body[40:]]), {"Content-Type": content_type}
        )
        self.assertEqual(response.status, 200)
        self.assert_wav(data)
        self.assertEqual(self.engine.calls[0][0], "Découpé")

    def test_a_real_node_fetch_with_formdata_gets_the_wav(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("node absent")
        script = (
            "const f=new FormData();f.append('text','Bonjour à tous');f.append('voice_url','cml-577_394');"
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
        self.assertEqual(self.engine.calls[0][0], "Bonjour à tous")


class Refusals(ServerCase):
    def test_voice_url_never_accepts_a_path_or_an_url(self):
        attempts = ["../../etc/passwd", "/etc/passwd", "http://exemple.org/v.wav", "https://exemple.org/v", "hf://kyutai/tts-voices/x", "file:///etc/passwd", "CAMILLE", "Camille", "cml-577_394/../x"]
        for voice in attempts:
            with self.subTest(voice=voice):
                response, data = self.tts(text="Bonjour", voice_url=voice)
                self.assertEqual(response.status, 400)
                self.assertIn("catalogue", json.loads(data)["detail"])
        self.assertEqual(self.engine.loads, 0)
        self.assertEqual(self.engine.calls, [])

    def test_uploaded_file_is_refused(self):
        upload = f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="voice_wav"; filename="a.wav"\r\n\r\nRIFF\r\n'.encode()
        body, content_type = multipart({"text": "Bonjour"}, upload)
        response, _ = self.request("POST", "/tts", body, {"Content-Type": content_type})
        self.assertEqual(response.status, 400)
        self.assertEqual(self.engine.loads, 0)

    def test_text_limits(self):
        self.assertEqual(self.tts(text="   ")[0].status, 400)
        self.assertEqual(self.tts(voice_url="estelle")[0].status, 400)
        self.assertEqual(self.tts(text="x" * (srv.MAX_TEXT_CHARS + 1))[0].status, 413)
        self.assertEqual(self.tts(text="x" * srv.MAX_TEXT_CHARS)[0].status, 200)

    def test_oversized_body_is_refused_before_reading_it(self):
        response, _ = self.request("POST", "/tts", b"x" * (srv.MAX_BODY_BYTES + 1), {"Content-Type": "multipart/form-data; boundary=x"})
        self.assertEqual(response.status, 413)

    def test_only_this_machine_may_ask(self):
        body, content_type = multipart({"text": "Bonjour"})
        cases = [{"Host": "exemple.org"}, {"Host": "127.0.0.1.exemple.org:8020"}, {"Host": "localhost", "Origin": "https://exemple.org"}]
        for headers in cases:
            with self.subTest(headers=headers):
                self.assertEqual(self.request("POST", "/tts", body, {"Content-Type": content_type, **headers})[0].status, 403)
                self.assertEqual(self.request("GET", "/health", None, headers)[0].status, 403)
        self.assertEqual(self.engine.calls, [])

    def test_unknown_voice_file_says_so(self):
        del self.files["estelle"]
        response, data = self.tts(text="Bonjour", voice_url="estelle")
        self.assertEqual(response.status, 503)
        self.assertIn("cache local", json.loads(data)["detail"])
        self.assertEqual(self.engine.loads, 0)

    def test_unknown_routes(self):
        self.assertEqual(self.request("GET", "/etc/passwd")[0].status, 404)
        self.assertEqual(self.request("POST", "/autre", b"", {"Content-Type": "text/plain"})[0].status, 404)


class GameMode(ServerCase):
    def test_active_flag_answers_503_without_touching_the_model(self):
        self.flag.touch()
        response, data = self.tts(text="Bonjour")
        self.assertEqual(response.status, 503)
        self.assertIn("Mode jeu", json.loads(data)["detail"])
        self.assertEqual(response.getheader("Retry-After"), "60")
        self.assertEqual((self.engine.loads, self.engine.calls), (0, []))

    def test_health_stays_up_and_tells_it_without_loading(self):
        self.flag.touch()
        response, data = self.request("GET", "/health")
        self.assertEqual(response.status, 200)
        self.assertTrue(json.loads(data)["gpu_yield"])
        self.assertEqual(self.engine.loads, 0)

    def test_starting_during_the_load_stops_before_any_synthesis_and_frees_the_model(self):
        self.engine.on_load = self.flag.touch
        response, _ = self.tts(text="Bonjour")
        self.assertEqual(response.status, 503)
        self.assertEqual(self.engine.calls, [])
        self.assertEqual(self.engine.unloads, 1)

    def test_starting_during_a_synthesis_stops_it_and_frees_the_model(self):
        self.engine.hold.set()
        result: dict = {}
        thread = threading.Thread(target=lambda: result.update(status=self.tts(text="Bonjour")[0].status))
        thread.start()
        self.assertTrue(self.engine.started.wait(5))
        self.flag.touch()
        thread.join(5)
        self.assertEqual(result["status"], 503)
        self.assertEqual((self.engine.active, self.engine.unloads), (0, 1))

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

    def test_maintain_frees_an_idle_model_only_in_game_mode(self):
        self.tts(text="Bonjour")
        self.assertTrue(self.engine.loaded)
        self.service.maintain()
        self.assertTrue(self.engine.loaded)
        self.flag.touch()
        self.service.maintain()
        self.assertFalse(self.engine.loaded)
        self.assertEqual(self.engine.unloads, 1)

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
        sock = self.raw_tts()
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
        self.assertEqual([text for text, _ in self.engine.calls], ["Première"])

    def test_requests_never_overlap_and_run_in_order(self):
        self.engine.hold.set()
        statuses: list[int] = []
        threads = []
        for index in range(4):
            thread = threading.Thread(target=lambda n=index: statuses.append(self.tts(text=f"phrase {n}")[0].status))
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
        self.assertEqual([text for text, _ in self.engine.calls], [f"phrase {n}" for n in range(4)])

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
    def test_nothing_ever_logs_the_text(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            ok = self.tts(text=SECRET)
            self.request("POST", f"/tts?text={quote(SECRET)}", b"", {"Content-Type": "multipart/form-data"})
            self.tts(text=SECRET, voice_url=SECRET.replace(" ", "-"))
            self.engine.error = RuntimeError(f"tenseur invalide pour {SECRET}")
            failed = self.tts(text=SECRET)
        self.assertEqual(ok[0].status, 200)
        self.assertEqual(failed[0].status, 500)
        self.assertNotIn("manuscrit", failed[1].decode())
        everything = stdout.getvalue() + stderr.getvalue() + json.dumps(self.logged, ensure_ascii=False)
        self.assertNotIn("manuscrit", everything)
        self.assertIn({"event": "synthesis_failed", "error": "RuntimeError"}, self.logged)
        served = [row for row in self.logged if row["event"] == "request" and row["status"] == 200]
        self.assertEqual(served[0]["text_chars"], len(SECRET))

    def test_real_emit_writes_one_json_line(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            srv.emit("request", status=200)
        record = json.loads(out.getvalue())
        self.assertEqual((record["service"], record["event"], record["status"]), ("kyutai16", "request", 200))

    def test_out_of_memory_says_the_gpu_is_shared_and_frees_the_model(self):
        class OutOfMemoryError(RuntimeError):
            pass

        self.engine.error = OutOfMemoryError("vram")
        response, data = self.tts(text="Bonjour")
        self.assertEqual(response.status, 503)
        self.assertIn("GPU", json.loads(data)["detail"])
        self.assertEqual(self.engine.unloads, 1)

    def test_loading_failure_is_a_clean_500_and_a_later_request_retries(self):
        def broken() -> None:
            raise OSError(f"introuvable {SECRET}")

        self.engine.on_load = broken
        response, data = self.tts(text="Bonjour")
        self.assertEqual(response.status, 500)
        self.assertNotIn("manuscrit", data.decode())
        self.engine.on_load = lambda: None
        self.assertEqual(self.tts(text="Bonjour")[0].status, 200)


class Setup(unittest.TestCase):
    def test_defaults_are_loopback_and_port_8020(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("KYUTAI16_HOST", None)
            args = srv.build_parser().parse_args([])
        self.assertEqual((args.host, args.port), ("127.0.0.1", 8020))
        self.assertEqual(srv.DEFAULT_VOICE, "cml-577_394")

    def test_really_binds_loopback_only(self):
        service = srv.Kyutai16Service(FakeEngine(), {}, {}, Path("/nonexistent/active"))
        server = srv.serve(service, port=0)
        self.addCleanup(server.server_close)
        self.assertEqual(server.server_address[0], "127.0.0.1")

    def test_catalogue_has_the_36_named_voices_of_the_bench(self):
        catalog = srv.load_catalog()
        self.assertEqual(len(catalog), 36)
        self.assertEqual(catalog["cml-577_394"], "Camille")
        self.assertEqual(catalog["estelle"], "Estelle")
        bench = ROOT / "scripts" / "voice-lab" / "voice-names.json"
        if bench.exists():
            self.assertEqual(catalog, json.loads(bench.read_text(encoding="utf-8")))

    def test_voice_files_come_from_the_cache_and_only_for_the_catalogue(self):
        with tempfile.TemporaryDirectory() as tmp:
            hub = Path(tmp)
            snapshot = hub / "models--kyutai--tts-voices" / "snapshots" / "abc"
            (snapshot / "cml-tts" / "fr").mkdir(parents=True)
            (snapshot / "unmute-prod-website").mkdir()
            (snapshot / srv.ESTELLE_FILE).touch()
            camille = snapshot / "cml-tts" / "fr" / f"577_394_000001-0001{srv.CML_SUFFIX}"
            camille.touch()
            (snapshot / "cml-tts" / "fr" / f"999_999_000001-0001{srv.CML_SUFFIX}").touch()
            found = srv.find_voice_files(hub, srv.load_catalog())
            self.assertEqual(found, {"cml-577_394": camille, "estelle": snapshot / srv.ESTELLE_FILE})
            self.assertEqual(srv.find_voice_files(hub / "absent", srv.load_catalog()), {})

    def test_compose_service_is_opt_in_loopback_and_never_restarts(self):
        compose = (ROOT / "deploy" / "docker-compose.tts.yml").read_text(encoding="utf-8")
        block = compose.split("\n  kyutai16:\n", 1)[1]
        block = re.split(r"\n  [a-z0-9_-]+:\n", block, maxsplit=1)[0]
        self.assertIn('profiles: ["kyutai16"]', block)
        self.assertIn('"127.0.0.1:8020:8020"', block)
        self.assertIn('restart: "no"', block)
        self.assertIn("pull_policy: never", block)
        self.assertIn("HF_HUB_OFFLINE=1", block)
        self.assertNotIn("HSA_OVERRIDE_GFX_VERSION=", block)
        self.assertNotIn("build:", block)
        for volume in re.findall(r"^\s+- \$\{HOME\}.*$", block, flags=re.M):
            self.assertTrue(volume.endswith(":ro"), volume)


class RealAdapter(unittest.TestCase):
    """`MoshiEngine` contre de faux torch et moshi : la forme des appels et l'interruption, pas la voix."""

    def stubs(self, numpy):
        import contextlib as ctx

        calls = types.SimpleNamespace(repo=None, kwargs=None, emptied=0, frames=0, voices=None)

        class Decoded:
            def cpu(self):
                return self

            def numpy(self):
                return numpy.full((1, 1, 4), 2.0)

        class Mimi:
            sample_rate = 24000

            @ctx.contextmanager
            def streaming(self, _size):
                yield

            def decode(self, _frame):
                return Decoded()

        class Frame:
            def __getitem__(self, _key):
                return self

        class Model:
            delay_steps = 1
            mimi = Mimi()

            def prepare_script(self, script, padding_between):
                return list(script)

            def make_condition_attributes(self, voices, cfg_coef):
                calls.voices = (voices, cfg_coef)
                return "conditions"

            def generate(self, entries, conditions, on_frame):
                for _ in range(3):
                    calls.frames += 1
                    on_frame(Frame())
                return types.SimpleNamespace(frames=[Frame(), Frame(), Frame()])

        class TTSModel:
            @staticmethod
            def from_checkpoint_info(info, **kwargs):
                calls.kwargs = kwargs
                calls.info = info
                return Model()

        class CheckpointInfo:
            @staticmethod
            def from_hf_repo(repo):
                calls.repo = repo
                return "info"

        @ctx.contextmanager
        def no_grad():
            yield

        def empty() -> None:
            calls.emptied += 1

        modules = {
            "torch": types.SimpleNamespace(no_grad=no_grad, cuda=types.SimpleNamespace(is_available=lambda: True, empty_cache=empty)),
            "moshi": types.SimpleNamespace(),
            "moshi.models": types.SimpleNamespace(),
            "moshi.models.loaders": types.SimpleNamespace(CheckpointInfo=CheckpointInfo),
            "moshi.models.tts": types.SimpleNamespace(DEFAULT_DSM_TTS_REPO="kyutai/tts-1.6b-en_fr", TTSModel=TTSModel),
        }
        return calls, modules

    def test_same_settings_as_the_bench_offline_and_interruptible(self):
        try:
            import numpy
        except ImportError:
            self.skipTest("numpy absent")
        calls, modules = self.stubs(numpy)
        with mock.patch.dict(sys.modules, modules), mock.patch.dict(os.environ, {"HF_HUB_OFFLINE": "0"}):
            engine = srv.MoshiEngine("cuda")
            self.assertFalse(engine.loaded)
            engine.load()
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
            self.assertTrue(engine.loaded)
            self.assertEqual(calls.repo, "kyutai/tts-1.6b-en_fr")
            self.assertEqual(calls.kwargs, {"n_q": 32, "temp": 0.6, "device": "cuda"})

            pcm, rate = engine.synthesize("Bonjour", Path("v.safetensors"), lambda: None)
            self.assertEqual(rate, 24000)
            self.assertEqual(calls.voices, ([Path("v.safetensors")], 2.0))
            self.assertEqual(len(pcm), 2 * 4 * 2)  # 2 trames après delay_steps, 4 échantillons, 16 bits
            self.assertEqual(pcm[:2], (32767).to_bytes(2, "little"))  # écrêté à 1,0

            def stop() -> None:
                raise srv.Cancelled()

            calls.frames = 0
            with self.assertRaises(srv.Cancelled):
                engine.synthesize("Bonjour", Path("v.safetensors"), stop)
            self.assertEqual(calls.frames, 1)

            engine.unload()
            self.assertFalse(engine.loaded)
            self.assertEqual(calls.emptied, 1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
