#!/usr/bin/env python3
"""Tests du service de conversion avec un faux modèle : aucun GPU, aucun réseau hors boucle locale.

    python3 -P deploy/vc/test_server.py
"""
from __future__ import annotations

import http.client
import io
import json
import re
import shutil
import socket
import sys
import tempfile
import threading
import time
import types
import unittest
import wave
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import server as srv  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BOUNDARY = "----vctest"


def wav(seconds: float = 1.0, rate: int = 24000, fill: bytes = b"\x10\x00") -> bytes:
    return srv.wav_bytes(fill * int(seconds * rate), rate)


def multipart(parts: dict[str, bytes], boundary: str = BOUNDARY) -> tuple[bytes, str]:
    body = b""
    for name, value in parts.items():
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{name}.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
        body += value + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def out_of_memory() -> RuntimeError:
    return RuntimeError("HIP error: out of memory")


class FakeEngine:
    def __init__(self) -> None:
        self._loaded = False
        self.loads = 0
        self.unloads = 0
        self.calls: list[tuple[bytes, bytes]] = []
        self.active = 0
        self.max_active = 0
        self.hold = threading.Event()
        self.started = threading.Event()
        self.cancelled = threading.Event()
        self.errors: list[Exception] = []
        self.on_load = lambda: None

    @property
    def loaded(self) -> bool:
        return self._loaded

    def load(self) -> None:
        self.loads += 1
        self.on_load()
        self._loaded = True

    def unload(self) -> None:
        self.unloads += 1
        self._loaded = False

    def convert(self, source, target, checkpoint):
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.calls.append((source, target))
        self.started.set()
        try:
            checkpoint()
            while self.hold.is_set():
                checkpoint()
                time.sleep(0.005)
            if self.errors:
                raise self.errors.pop(0)
            return b"\x02\x00" * 2400, 24000
        except srv.Cancelled:
            self.cancelled.set()
            raise
        finally:
            self.active -= 1


class ServerCase(unittest.TestCase):
    extra_hosts: tuple[str, ...] = ("vc",)

    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="vc-test-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.flag = self.dir / "gpu-yield" / "active"
        self.flag.parent.mkdir()
        self.engine = FakeEngine()
        self.logged: list[dict] = []
        self.service = srv.VcService(self.engine, self.flag, log=lambda event, **fields: self.logged.append({"event": event, **fields}))
        self.server = srv.serve(self.service, "127.0.0.1", 0, self.extra_hosts)
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

    def convert(self, source: bytes | None = None, target: bytes | None = None, headers: dict[str, str] | None = None):
        body, content_type = multipart({"source": source or wav(2.0), "target": target or wav(5.0, fill=b"\x20\x00")})
        return self.request("POST", "/convert", body, {"Content-Type": content_type, **(headers or {})})

    def open_conversion(self) -> socket.socket:
        body, content_type = multipart({"source": wav(), "target": wav()})
        sock = socket.create_connection(("127.0.0.1", self.port))
        head = f"POST /convert HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: {content_type}\r\nContent-Length: {len(body)}\r\n\r\n"
        sock.sendall(head.encode() + body)
        return sock

    def wait_for(self, predicate, timeout: float = 5.0) -> None:
        deadline = time.monotonic() + timeout
        while not predicate():
            if time.monotonic() > deadline:
                self.fail("délai dépassé")
            time.sleep(0.01)


class Contract(ServerCase):
    def test_health_loads_nothing(self):
        response, body = self.request("GET", "/health")
        payload = json.loads(body)
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["status"], "healthy")
        self.assertEqual(payload["state"], "unloaded")
        self.assertFalse(payload["model_loaded"])
        self.assertEqual(self.engine.loads, 0)

    def test_convert_returns_a_wav_and_passes_the_exact_bytes(self):
        source = wav(2.0) + b""
        target = wav(5.0, fill=b"\r\n")  # des octets qui ressemblent à des fins de ligne
        response, body = self.convert(source, target)
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Type"), "audio/wav")
        with wave.open(io.BytesIO(body)) as out:
            self.assertEqual((out.getframerate(), out.getnchannels(), out.getsampwidth()), (24000, 1, 2))
        self.assertEqual(self.engine.calls, [(source, target)])
        self.assertTrue(self.service.health()["model_loaded"])

    def test_the_compose_service_name_is_accepted_as_host(self):
        response, _ = self.convert(headers={"Host": "vc:8022"})
        self.assertEqual(response.status, 200)

    def test_a_real_node_fetch_with_formdata_gets_the_wav(self):
        if shutil.which("node") is None:
            self.skipTest("node absent")
        script = (
            "const a=new Uint8Array(require('fs').readFileSync(process.argv[1]));"
            "const f=new FormData();f.append('source',new Blob([a]),'s.wav');f.append('target',new Blob([a]),'t.wav');"
            "fetch(`http://127.0.0.1:${process.argv[2]}/convert`,{method:'POST',body:f})"
            ".then(async r=>{const b=Buffer.from(await r.arrayBuffer());console.log(r.status,b.subarray(0,4).toString())})"
        )
        path = self.dir / "a.wav"
        path.write_bytes(wav())
        import subprocess

        out = subprocess.run(["node", "-e", script, str(path), str(self.port)], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.stdout.strip(), "200 RIFF", out.stderr)
        self.assertEqual(self.engine.calls[0][0], path.read_bytes())


class Refusals(ServerCase):
    def test_only_local_hosts_without_origin(self):
        for headers in ({"Host": "evil.example"}, {"Origin": "https://evil.example"}, {"Host": "vc.evil.example"}):
            response, _ = self.convert(headers=headers)
            self.assertEqual(response.status, 403, headers)
        response, _ = self.request("GET", "/health", headers={"Host": "attacker"})
        self.assertEqual(response.status, 403)
        self.assertEqual(self.engine.loads, 0)

    def test_missing_unknown_or_duplicate_fields(self):
        cases = [
            multipart({"source": wav()}),
            multipart({"source": wav(), "target": wav(), "path": b"/etc/passwd"}),
        ]
        dup = (
            f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="source"\r\n\r\n'.encode() + wav() + b"\r\n"
            + f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="source"\r\n\r\n'.encode() + wav() + b"\r\n"
            + f"--{BOUNDARY}--\r\n".encode()
        )
        cases.append((dup, f"multipart/form-data; boundary={BOUNDARY}"))
        cases.append((b"source=1", "application/x-www-form-urlencoded"))
        cases.append((b"garbage", f"multipart/form-data; boundary={BOUNDARY}"))
        for body, content_type in cases:
            response, _ = self.request("POST", "/convert", body, {"Content-Type": content_type})
            self.assertEqual(response.status, 400, body[:60])
        self.assertEqual(self.engine.calls, [])

    def test_not_a_wav_or_too_short_or_too_long(self):
        for source, target, status in (
            (b"ID3not a wav", wav(), 400),
            (wav(0.05), wav(), 400),
            (wav(), wav(srv.MAX_TARGET_S + 1, rate=8000), 413),
        ):
            response, _ = self.convert(source, target)
            self.assertEqual(response.status, status)
        with mock.patch.object(srv, "MAX_SOURCE_S", 1.0):
            response, _ = self.convert(wav(2.0), wav())
        self.assertEqual(response.status, 413)
        self.assertEqual(self.engine.calls, [])

    def test_oversized_body_is_refused_before_reading_it(self):
        response, _ = self.request(
            "POST", "/convert", b"x", {"Content-Type": f"multipart/form-data; boundary={BOUNDARY}", "Content-Length": str(srv.MAX_BODY_BYTES + 1)}
        )
        self.assertEqual(response.status, 413)

    def test_unknown_routes(self):
        self.assertEqual(self.request("GET", "/voices")[0].status, 404)
        self.assertEqual(self.request("POST", "/tts", b"", {"Content-Length": "0"})[0].status, 404)


class GameMode(ServerCase):
    def test_active_flag_answers_503_without_touching_the_model(self):
        self.flag.touch()
        response, body = self.convert()
        self.assertEqual(response.status, 503)
        self.assertEqual(json.loads(body)["reason"], "gpu_yield")
        self.assertEqual(response.getheader("Retry-After"), "60")
        self.assertEqual((self.engine.loads, self.engine.calls), (0, []))
        self.assertEqual(self.service.health()["state"], "yielded")

    def test_starting_during_a_conversion_stops_it_and_frees_the_model(self):
        self.engine.hold.set()
        result: dict = {}
        thread = threading.Thread(target=lambda: result.update(r=self.convert()))
        thread.start()
        self.assertTrue(self.engine.started.wait(5))
        self.flag.touch()
        thread.join(5)
        self.assertEqual(result["r"][0].status, 503)
        self.assertFalse(self.engine.loaded)
        self.assertGreaterEqual(self.engine.unloads, 1)

    def test_starting_during_the_load_frees_the_model_before_any_conversion(self):
        self.engine.on_load = self.flag.touch
        response, _ = self.convert()
        self.assertEqual(response.status, 503)
        self.assertEqual(self.engine.calls, [])
        self.assertFalse(self.engine.loaded)

    def test_maintain_frees_the_idle_model_only_in_game_mode(self):
        self.convert()
        self.service.maintain()
        self.assertTrue(self.engine.loaded)
        self.flag.touch()
        self.service.maintain()
        self.assertFalse(self.engine.loaded)
        self.flag.unlink()
        self.assertEqual(self.convert()[0].status, 200)

    def test_an_unreadable_flag_leaves_the_gpu_to_the_game(self):
        class Unreadable:
            def exists(self) -> bool:
                raise PermissionError

        self.service.yield_flag = Unreadable()
        self.assertTrue(self.service.yielding())

    def test_flag_path_follows_the_runtime_dir(self):
        with mock.patch.dict("os.environ", {"XDG_RUNTIME_DIR": str(self.dir)}):
            self.assertEqual(srv.yield_flag_path(), self.dir / "gpu-yield" / "active")


class OneAtATime(ServerCase):
    def test_a_disconnected_client_cancels_its_conversion_and_the_next_one_runs(self):
        self.engine.hold.set()
        sock = self.open_conversion()
        self.assertTrue(self.engine.started.wait(5))
        sock.close()
        self.assertTrue(self.engine.cancelled.wait(5))
        self.engine.hold.clear()
        self.assertEqual(self.convert()[0].status, 200)
        self.wait_for(lambda: any(r.get("status") == 499 for r in self.logged))

    def test_a_disconnected_client_leaves_the_queue_without_converting(self):
        self.engine.hold.set()
        first = self.open_conversion()
        self.addCleanup(first.close)
        self.assertTrue(self.engine.started.wait(5))
        second = self.open_conversion()
        time.sleep(0.3)
        second.close()
        self.wait_for(lambda: any(r.get("status") == 499 for r in self.logged))
        self.engine.hold.clear()
        self.wait_for(lambda: self.engine.active == 0)
        self.assertEqual(len(self.engine.calls), 1)

    def test_conversions_never_overlap(self):
        threads = [threading.Thread(target=self.convert) for _ in range(3)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        self.assertEqual(len(self.engine.calls), 3)
        self.assertEqual(self.engine.max_active, 1)

    def test_a_full_queue_is_refused_clearly(self):
        self.engine.hold.set()
        sockets = [self.open_conversion()]
        self.assertTrue(self.engine.started.wait(5))
        sockets += [self.open_conversion() for _ in range(srv.MAX_PENDING)]
        for sock in sockets:
            self.addCleanup(sock.close)
        self.wait_for(lambda: len(self.service._waiting) == srv.MAX_PENDING)
        response, body = self.convert()
        self.assertEqual(response.status, 503)
        self.assertEqual(json.loads(body)["reason"], "busy")


class Privacy(ServerCase):
    def test_nothing_ever_logs_content_nor_the_request_line(self):
        secret = b"SECRET-AUDIO-MARKER"
        self.convert(wav(1.0, fill=b"\x41\x42") + secret, wav())
        self.engine.errors.append(RuntimeError("le message cite SECRET-AUDIO-MARKER"))
        response, body = self.convert(wav(1.0) + secret, wav())
        self.assertEqual(response.status, 500)
        self.assertNotIn(b"SECRET", body)
        dump = json.dumps(self.logged)
        self.assertNotIn("SECRET", dump)
        self.assertIn('"source_s": 1.0', dump)
        self.assertTrue(any(r["event"] == "conversion_failed" and r["error"] == "RuntimeError" for r in self.logged))

    def test_out_of_memory_says_the_gpu_is_shared_and_frees_the_model(self):
        self.engine.errors.append(out_of_memory())
        response, body = self.convert()
        self.assertEqual(response.status, 503)
        self.assertEqual(json.loads(body)["reason"], "gpu_memory")
        self.assertFalse(self.engine.loaded)

    def test_real_emit_writes_one_json_line(self):
        out = io.StringIO()
        with mock.patch("sys.stdout", out):
            srv.emit("request", status=200)
        record = json.loads(out.getvalue())
        self.assertEqual((record["service"], record["event"]), ("vc", "request"))


class Setup(unittest.TestCase):
    def test_defaults_are_loopback_and_port_8022(self):
        args = srv.build_parser().parse_args([])
        self.assertEqual((args.host, args.port), ("127.0.0.1", 8022))

    def test_allowed_hosts_are_names_only(self):
        self.assertEqual(srv.parse_allowed_hosts(" vc , other "), frozenset({"vc", "other"}))
        for bad in ("vc:8022", "http://vc", "a b", "*"):
            with self.assertRaises(ValueError):
                srv.parse_allowed_hosts(bad)
        self.assertFalse(srv.is_allowed_host_header("vc:8022"))
        self.assertTrue(srv.is_allowed_host_header("vc:8022", {"vc"}))
        self.assertTrue(srv.is_allowed_host_header("[::1]:8022"))

    def test_force_offline_overrides_the_environment(self):
        with mock.patch.dict("os.environ", {"HF_HUB_OFFLINE": "0"}):
            srv.force_offline_env()
            import os

            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")

    def test_compose_service_is_internal_read_only_and_never_restarts(self):
        compose = (ROOT / "deploy" / "docker-compose.tts.yml").read_text(encoding="utf-8")
        block = compose.split("\n  vc:\n", 1)[1]
        block = re.split(r"\n  [a-z0-9_-]+:\n|\nnetworks:\n", block, maxsplit=1)[0]
        self.assertIn('profiles: ["qwen3", "vc"]', block)
        self.assertIn("image: deploy-chatterbox:latest", block)
        self.assertIn("pull_policy: never", block)
        self.assertIn('restart: "no"', block)
        self.assertIn('user: "${LLM_VOICE_UID:-1000}:${LLM_VOICE_GID:-1000}"', block)
        self.assertIn("- ALL", block)
        self.assertIn("HF_HUB_OFFLINE=1", block)
        self.assertIn("VC_ALLOWED_HOSTS=vc", block)
        self.assertIn("create_host_path: false", block)
        self.assertNotIn("ports:", block)
        self.assertNotIn("build:", block)
        volumes = re.findall(r"^\s+- (?:\./|\$\{HOME\}).*$", block, flags=re.M)
        self.assertTrue(volumes)
        self.assertTrue(all(volume.endswith(":ro") for volume in volumes), volumes)
        self.assertIn("- tts-internal", block)
        tail = compose.split("\nnetworks:\n", 1)[1]
        self.assertIn("internal: true", tail)


class RealAdapter(unittest.TestCase):
    """L'adaptateur réel, avec un faux chatterbox : mêmes appels que l'essai écouté."""

    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="vc-real-"))
        self.addCleanup(shutil.rmtree, self.dir, True)

    def test_missing_weights_say_how_to_prepare_them(self):
        with self.assertRaises(srv.WeightsMissing):
            srv.ChatterboxVcEngine(self.dir, "cpu").load()

    def test_from_local_in_memory_files_and_interruptible(self):
        for name in srv.WEIGHT_FILES:
            (self.dir / name).touch()
        seen: dict = {}
        hooks: list = []

        class Module:
            def register_forward_pre_hook(self, hook):
                hooks.append(hook)
                return types.SimpleNamespace(remove=lambda: hooks.remove(hook))

        class Tensor:
            def __init__(self, values):
                self.values = values

            def detach(self):
                return self

            def cpu(self):
                return self

            def float(self):
                return self

            def numpy(self):
                import numpy

                return numpy.asarray(self.values, dtype="float32")

        class FakeVC:
            sr = 24000

            def __init__(self):
                self.s3gen = types.SimpleNamespace(tokenizer=Module(), flow=types.SimpleNamespace(decoder=types.SimpleNamespace(estimator=Module())), mel2wav=Module())

            @classmethod
            def from_local(cls, path, device):
                seen["from_local"] = (path, device)
                return cls()

            def generate(self, audio, target_voice_path=None):
                seen["audio"] = audio.read()
                seen["target"] = target_voice_path.read()
                seen["hooks"] = len(hooks)
                for hook in list(hooks):
                    hook(None, None)
                return Tensor([0.5, -2.0])

        try:
            import numpy  # noqa: F401
        except ImportError:
            self.skipTest("numpy absent")
        fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True, empty_cache=lambda: None))
        modules = {"torch": fake_torch, "chatterbox": types.ModuleType("chatterbox"), "chatterbox.vc": types.SimpleNamespace(ChatterboxVC=FakeVC)}
        with mock.patch.dict(sys.modules, modules), mock.patch.dict("os.environ", {"HF_HUB_OFFLINE": "0"}):
            engine = srv.ChatterboxVcEngine(self.dir, "cuda")
            engine.load()
            import os

            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
            calls = []
            pcm, rate = engine.convert(b"S", b"T", lambda: calls.append(1))
            self.assertEqual(seen["from_local"], (self.dir, "cuda"))
            self.assertEqual((seen["audio"], seen["target"], seen["hooks"]), (b"S", b"T", 3))
            self.assertEqual(hooks, [], "les points d'arrêt sont retirés")
            self.assertEqual(len(calls), 4)
            self.assertEqual((pcm, rate), ((16383).to_bytes(2, "little", signed=True) + (-32767).to_bytes(2, "little", signed=True), 24000))

            def stop():
                raise srv.Cancelled()

            with self.assertRaises(srv.Cancelled):
                engine.convert(b"S", b"T", stop)
            self.assertEqual(hooks, [])
            engine.unload()
            self.assertFalse(engine.loaded)

    def test_no_gpu_says_so(self):
        for name in srv.WEIGHT_FILES:
            (self.dir / name).touch()
        fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False))
        modules = {"torch": fake_torch, "chatterbox": types.ModuleType("chatterbox"), "chatterbox.vc": types.SimpleNamespace(ChatterboxVC=None)}
        with mock.patch.dict(sys.modules, modules), self.assertRaises(srv.GpuUnavailable):
            srv.ChatterboxVcEngine(self.dir, "cuda").load()


if __name__ == "__main__":
    unittest.main(verbosity=1)
