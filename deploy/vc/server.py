#!/usr/bin/env python3
"""Service local de conversion de voix (Chatterbox VC, MIT) : garde le jeu, rend le timbre.

Une voix clonée qui joue (VoiceDesign de Qwen3) invente un timbre. Ce service reprend la
réplique jouée et la redit avec le timbre d'un extrait de référence : le jeu reste, la voix revient.

  GET  /health    {"status": "healthy", "state": ..., "model_loaded": ...}, jamais de chargement ni de charge GPU
  POST /convert   multipart `source` (WAV joué) et `target` (WAV de référence) : renvoie un WAV entier

Garanties, chacune couverte par test_server.py :
  - aucun contenu ne sort de la machine ni n'entre au journal : pas de téléchargement
    (HF_HUB_OFFLINE=1 forcé), Host et Origin vérifiés, seules des durées et des tailles sont journalisées ;
  - tailles bornées : corps, durée de la réplique, durée de la référence ; WAV PCM seulement ;
  - une conversion à la fois, les suivantes attendent dans l'ordre d'arrivée ;
  - un client qui se déconnecte annule sa conversion, ou sa place dans la file ;
  - mode jeu (`$XDG_RUNTIME_DIR/gpu-yield/active`) : 503, sans charge GPU et sans contournement,
    vérifié avant le chargement, pendant la conversion et par une boucle qui libère la mémoire du GPU ;
  - le modèle se charge au premier besoin.

Chatterbox ajoute à chaque sortie un filigrane inaudible (PerthNet, Resemble AI) : il marque le
son comme produit par un modèle. Ce service ne le retire pas.

Bibliothèque standard seule, plus chatterbox (et torch, numpy, librosa) importés au premier chargement.
Python 3.10 : c'est celui de l'image `deploy-chatterbox`.
"""
from __future__ import annotations

import argparse
import collections
import gc
import io
import json
import os
import re
import select
import signal
import socket
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Collection, Optional, Protocol
from urllib.parse import urlsplit

ENGINE_NAME = "chatterbox-vc"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8022
# Une réplique de 5000 caractères dure environ cinq minutes : 24 kHz, 16 bits, mono, 14 Mo.
MAX_SOURCE_S = 600.0
# Le modèle ne garde que les dix premières secondes de la référence.
MAX_TARGET_S = 60.0
MIN_AUDIO_S = 0.2
MAX_BODY_BYTES = 48 * 1024 * 1024
MAX_PARTS = 4
FIELDS = ("source", "target")
MAX_PENDING = 4
POLL_S = 0.1
MAINTAIN_S = 2.0
READ_TIMEOUT_S = 30
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "[::1]", "::1")
# Ce que `ChatterboxVC.from_local` lit. `prepare-weights.sh` les pose.
WEIGHT_FILES = ("s3gen.safetensors", "conds.pt")
HOST_NAME = re.compile(r"[a-z0-9][a-z0-9.-]{0,62}")

YIELD_MESSAGE = "Mode jeu actif (gpu-yield) : aucune conversion tant qu'il dure. Réessayez une fois le jeu terminé."


class ServiceError(Exception):
    """Ce que le client peut lire : un état et un message, jamais le contenu reçu."""

    status = 500
    message = "Échec de la conversion. Le journal du serveur indique le type d'erreur."
    reason: Optional[str] = None

    def __init__(self, message: Optional[str] = None) -> None:
        super().__init__(message or self.message)
        self.message = message or self.message


class GpuYielded(ServiceError):
    status = 503
    message = YIELD_MESSAGE
    reason = "gpu_yield"


class Busy(ServiceError):
    status = 503
    message = "Trop de conversions en attente. Réessayez dans un instant."
    reason = "busy"


class GpuUnavailable(ServiceError):
    status = 503
    message = "GPU indisponible ou mémoire insuffisante : d'autres services l'utilisent peut-être."
    reason = "gpu_memory"


class WeightsMissing(ServiceError):
    status = 503
    message = "Poids de conversion absents : lancer deploy/vc/prepare-weights.sh."
    reason = "weights_missing"


class BadRequest(ServiceError):
    status = 400
    message = "Requête invalide."


class TooLarge(BadRequest):
    status = 413
    message = f"Corps trop gros : {MAX_BODY_BYTES // (1024 * 1024)} Mio au plus."


class Forbidden(BadRequest):
    status = 403
    message = "Requête refusée : ce serveur ne répond qu'aux services locaux."


class Cancelled(Exception):
    """Le client est parti. Personne à qui répondre."""


class Engine(Protocol):
    @property
    def loaded(self) -> bool: ...

    def load(self) -> None: ...

    def unload(self) -> None:
        """Même sans modèle chargé : un chargement interrompu laisse des blocs réservés."""
        ...

    def convert(self, source: bytes, target: bytes, checkpoint: Callable[[], None]) -> tuple[bytes, int]:
        """PCM 16 bits mono et sa fréquence. `checkpoint` lève pour interrompre, à appeler souvent."""
        ...


def emit(event: str, **fields: object) -> None:
    """Journal structuré, une ligne JSON. Aucun appelant ne passe d'audio : des durées et des tailles."""
    record = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "service": "vc", "event": event, **fields}
    print(json.dumps(record, ensure_ascii=False), flush=True)


def force_offline_env() -> None:
    """Avant tout import de huggingface_hub : aucun téléchargement, aucune télémétrie."""
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["DO_NOT_TRACK"] = "1"


def yield_flag_path() -> Path:
    runtime = os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    return Path(runtime) / "gpu-yield" / "active"


def wav_bytes(pcm: bytes, rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm)
    return buffer.getvalue()


def wav_seconds(data: bytes, field: str, max_s: float) -> float:
    """Un WAV PCM lisible, ni vide ni trop long. Le contenu n'est pas décodé ici."""
    try:
        with wave.open(io.BytesIO(data), "rb") as audio:
            frames, rate, channels = audio.getnframes(), audio.getframerate(), audio.getnchannels()
    except (wave.Error, EOFError, ValueError) as error:
        raise BadRequest(f"`{field}` : WAV PCM attendu.") from error
    if rate <= 0 or channels not in (1, 2):
        raise BadRequest(f"`{field}` : WAV PCM mono ou stéréo attendu.")
    seconds = frames / rate
    if seconds < MIN_AUDIO_S:
        raise BadRequest(f"`{field}` : extrait trop court.")
    if seconds > max_s:
        raise TooLarge(f"`{field}` : {int(max_s)} secondes au plus.")
    return seconds


def parse_multipart(content_type: str, body: bytes) -> dict[str, bytes]:
    """Les octets exacts de `source` et `target`. Aucun autre champ, aucun doublon."""
    kind, _, params = content_type.partition(";")
    if kind.strip().lower() != "multipart/form-data":
        raise BadRequest("Formulaire attendu : multipart/form-data avec `source` et `target`.")
    match = re.search(r'boundary="?([^";\s]{1,70})"?', params)
    if match is None:
        raise BadRequest("Formulaire illisible.")
    delimiter = b"\r\n--" + match.group(1).encode("latin-1")
    pieces = (b"\r\n" + body).split(delimiter)
    if len(pieces) < 3 or not pieces[-1].startswith(b"--") or len(pieces) - 2 > MAX_PARTS:
        raise BadRequest("Formulaire illisible.")
    form: dict[str, bytes] = {}
    for piece in pieces[1:-1]:
        head, separator, content = piece.partition(b"\r\n\r\n")
        if not separator:
            raise BadRequest("Formulaire illisible.")
        name: Optional[str] = None
        for line in head.split(b"\r\n"):
            key, _, value = line.decode("latin-1").partition(":")
            if key.strip().lower() == "content-disposition":
                found = re.search(r'(?:^|;)\s*name="([^"]*)"', value)
                name = found.group(1) if found else None
        if name not in FIELDS:
            raise BadRequest("Champs acceptés : `source` et `target`.")
        if name in form:
            raise BadRequest(f"`{name}` en double.")
        form[name] = content
    missing = [field for field in FIELDS if field not in form]
    if missing:
        raise BadRequest(f"Champ manquant : `{missing[0]}`.")
    return form


def is_out_of_memory(error: BaseException) -> bool:
    """Par le type ou par le message HIP ; le message n'est jamais journalisé."""
    return "OutOfMemory" in type(error).__name__ or "out of memory" in str(error).lower()


class VcService:
    """Tout ce qui ne dépend pas de HTTP : file, mode jeu, modèle."""

    def __init__(self, engine: Engine, yield_flag: Path, log: Callable[..., None] = emit) -> None:
        self.engine = engine
        self.yield_flag = yield_flag
        self.log = log
        self._condition = threading.Condition()
        self._waiting: collections.deque[object] = collections.deque()
        self._running = False
        self._loading_since: Optional[float] = None

    def yielding(self) -> bool:
        try:
            return self.yield_flag.exists()
        except OSError:
            # Illisible : dans le doute, le GPU reste au jeu.
            return True

    def health(self) -> dict[str, object]:
        """Ne charge rien et ne prend aucun verrou : répond aussi pendant `engine.load()`."""
        yielding = self.yielding()
        loading = self._loading_since
        loaded = bool(self.engine.loaded)
        if yielding:
            state = "yielded"
        elif loading is not None:
            state = "loading"
        else:
            state = "ready" if loaded else "unloaded"
        payload: dict[str, object] = {
            "status": "healthy",
            "engine": ENGINE_NAME,
            "state": state,
            "model_loaded": loaded,
            "gpu_yield": yielding,
        }
        if loading is not None:
            payload["loading_since_s"] = round(time.monotonic() - loading, 1)
        return payload

    def _enter(self, checkpoint: Callable[[], None]) -> None:
        ticket = object()
        with self._condition:
            if len(self._waiting) >= MAX_PENDING:
                raise Busy()
            self._waiting.append(ticket)
            try:
                while self._running or self._waiting[0] is not ticket:
                    checkpoint()
                    self._condition.wait(POLL_S)
                self._running = True
            finally:
                self._waiting.remove(ticket)
                self._condition.notify_all()

    def _leave(self) -> None:
        with self._condition:
            self._running = False
            self._condition.notify_all()

    def _release_model(self) -> None:
        try:
            self.engine.unload()
            self.log("model_unloaded")
        except Exception as error:  # noqa: BLE001 : le nom du type seul
            self.log("model_unload_failed", error=type(error).__name__)

    def _ensure_model(self) -> None:
        if self.engine.loaded:
            return
        started = time.monotonic()
        self._loading_since = started
        try:
            self.engine.load()
            self.log("model_loaded", duration_s=round(time.monotonic() - started, 1))
        finally:
            self._loading_since = None

    def convert(self, source: bytes, target: bytes, disconnected: Callable[[], bool]) -> bytes:
        """Une conversion à la fois, dans l'ordre d'arrivée."""

        def checkpoint() -> None:
            if self.yielding():
                raise GpuYielded()
            if disconnected():
                raise Cancelled()

        checkpoint()
        self._enter(checkpoint)
        try:
            failure: ServiceError
            try:
                checkpoint()
                self._ensure_model()
                # Le chargement ne s'interrompt pas : le mode jeu a pu commencer pendant.
                checkpoint()
                pcm, rate = self.engine.convert(source, target, checkpoint)
                return wav_bytes(pcm, rate)
            except GpuYielded:
                failure = GpuYielded()
            except (Cancelled, ServiceError):
                raise
            except Exception as error:  # noqa: BLE001
                self.log("conversion_failed", error=type(error).__name__)
                if not is_out_of_memory(error):
                    raise ServiceError() from None
                failure = GpuUnavailable()
            # Hors du `except` : tant qu'il dure, la trace de l'exception retient le
            # modèle, et ni `gc.collect` ni `empty_cache` ne libéreraient sa mémoire.
            self._release_model()
            raise failure
        finally:
            self._leave()

    def maintain(self) -> None:
        """Mode jeu commencé pendant que rien ne tourne : le modèle ne garde pas la mémoire du GPU."""
        if not self.yielding() or not self.engine.loaded:
            return
        with self._condition:
            if self._running:
                return  # La conversion en cours s'interrompt elle-même à son prochain point d'arrêt.
            self._running = True
        try:
            self._release_model()
        finally:
            self._leave()


def peer_is_gone(connection: socket.socket) -> bool:
    try:
        readable, _, _ = select.select([connection], [], [], 0)
        if not readable:
            return False
        return connection.recv(1, socket.MSG_PEEK) == b""
    except (OSError, ValueError):
        return True


def is_allowed_host_header(value: Optional[str], extra_hosts: Collection[str] = ()) -> bool:
    """La boucle locale, plus les noms de service du réseau compose interne (par exemple `vc`)."""
    if not value:
        return False
    host = value.strip().lower()
    if host.startswith("["):
        host = host.split("]", 1)[0] + "]"
    else:
        host = host.rsplit(":", 1)[0]
    return host in LOOPBACK_HOSTS or host in extra_hosts


def parse_allowed_hosts(value: str) -> frozenset[str]:
    names = {name.strip().lower() for name in value.split(",") if name.strip()}
    for name in names:
        if not HOST_NAME.fullmatch(name):
            raise ValueError("VC_ALLOWED_HOSTS : des noms de service seulement, séparés par des virgules.")
    return frozenset(names)


def make_handler(service: VcService, extra_hosts: Collection[str] = ()) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "vc"
        sys_version = ""
        timeout = READ_TIMEOUT_S

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            """Jamais la ligne de requête : `emit` dit ce qui compte."""

        def _reply(self, status: int, body: bytes, content_type: str, extra: Optional[dict[str, str]] = None) -> None:
            self.close_connection = True
            self.send_response_only(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for name, value in (extra or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: dict[str, object], extra: Optional[dict[str, str]] = None) -> None:
            self._reply(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", extra)

        def _error(self, status: int, error: ServiceError, extra: Optional[dict[str, str]] = None) -> None:
            payload: dict[str, object] = {"detail": error.message}
            if error.reason is not None:
                payload["reason"] = error.reason
            self._json(status, payload, extra)

        def _check_origin(self) -> None:
            # Une page web ouverte dans un navigateur ne doit ni charger le GPU ni joindre ce serveur.
            if not is_allowed_host_header(self.headers.get("Host"), extra_hosts) or self.headers.get("Origin") is not None:
                raise Forbidden()

        def _read_chunked(self) -> bytes:
            chunks = bytearray()
            while True:
                size = int(self.rfile.readline(32).split(b";", 1)[0].strip() or b"x", 16)
                if size == 0:
                    while self.rfile.readline(1024).strip():
                        pass
                    return bytes(chunks)
                if len(chunks) + size > MAX_BODY_BYTES:
                    raise TooLarge()
                chunks += self.rfile.read(size)
                self.rfile.readline(4)

        def _read_body(self) -> bytes:
            try:
                encoding = (self.headers.get("Transfer-Encoding") or "").strip().lower()
                if encoding == "chunked":
                    return self._read_chunked()
                if encoding:
                    raise BadRequest("Transfer-Encoding non pris en charge.")
                length = int(self.headers.get("Content-Length") or "-1")
                if length < 0:
                    raise BadRequest("Content-Length manquant.")
                if length > MAX_BODY_BYTES:
                    raise TooLarge()
                body = self.rfile.read(length)
                if len(body) != length:
                    raise BadRequest("Corps de requête incomplet.")
                return body
            except ValueError as error:
                raise BadRequest("Corps de requête illisible.") from error

        def do_GET(self) -> None:  # noqa: N802
            try:
                self._check_origin()
                if urlsplit(self.path).path == "/health":
                    self._json(200, service.health())
                else:
                    self._json(404, {"detail": "Adresse inconnue."})
            except ServiceError as error:
                self._error(error.status, error)

        def do_POST(self) -> None:  # noqa: N802
            started = time.monotonic()
            route = urlsplit(self.path).path
            fields: dict[str, object] = {"route": route if route == "/convert" else "other"}
            status = 500
            try:
                self._check_origin()
                if route != "/convert":
                    status = 404
                    self._json(404, {"detail": "Adresse inconnue."})
                    return
                form = parse_multipart(self.headers.get("Content-Type") or "", self._read_body())
                fields.update(
                    source_s=round(wav_seconds(form["source"], "source", MAX_SOURCE_S), 2),
                    target_s=round(wav_seconds(form["target"], "target", MAX_TARGET_S), 2),
                )
                audio = service.convert(form["source"], form["target"], lambda: peer_is_gone(self.connection))
                status = 200
                self._reply(200, audio, "audio/wav")
            except Cancelled:
                status = 499
                self.close_connection = True
            except ServiceError as error:
                status = error.status
                extra = {"Retry-After": "60"} if isinstance(error, GpuYielded) else None
                self._error(status, error, extra)
            except (BrokenPipeError, ConnectionResetError):
                status = 499
                self.close_connection = True
            except TimeoutError:
                status = 408
                self.close_connection = True
            finally:
                service.log("request", status=status, duration_s=round(time.monotonic() - started, 2), **fields)

    return Handler


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request: object, client_address: object) -> None:
        """Le traitement par défaut écrit une trace complète."""
        emit("connection_error", error=sys.exc_info()[0].__name__ if sys.exc_info()[0] else "inconnue")


def serve(service: VcService, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, extra_hosts: Collection[str] = ()) -> Server:
    return Server((host, port), make_handler(service, frozenset(extra_hosts)))


class ChatterboxVcEngine:
    """Le modèle réel, mêmes réglages que l'essai écouté (Chatterbox VC, `from_local`)."""

    def __init__(self, weights_dir: Path, device: str = "cuda") -> None:
        self.weights_dir = weights_dir
        self.device = device
        self._vc: Optional[object] = None

    @property
    def loaded(self) -> bool:
        return self._vc is not None

    def load(self) -> None:
        force_offline_env()
        if not all((self.weights_dir / name).is_file() for name in WEIGHT_FILES):
            raise WeightsMissing()
        import torch
        from chatterbox.vc import ChatterboxVC

        if self.device.startswith("cuda") and not torch.cuda.is_available():
            raise GpuUnavailable()
        self._vc = ChatterboxVC.from_local(self.weights_dir, self.device)

    def unload(self) -> None:
        self._vc = None
        gc.collect()
        if self.device.startswith("cuda"):
            import torch

            torch.cuda.empty_cache()

    @staticmethod
    def _stops(vc: object) -> list[object]:
        """Les modules que chaque conversion traverse : jeton, flux (à chaque pas), vocodeur."""
        s3gen = getattr(vc, "s3gen", None)
        flow = getattr(s3gen, "flow", None)
        estimator = getattr(getattr(flow, "decoder", None), "estimator", None)
        found = [getattr(s3gen, "tokenizer", None), flow, estimator, getattr(s3gen, "mel2wav", None)]
        return [module for module in found if hasattr(module, "register_forward_pre_hook")]

    def convert(self, source: bytes, target: bytes, checkpoint: Callable[[], None]) -> tuple[bytes, int]:
        import numpy as np

        vc = self._vc
        if vc is None:
            raise ServiceError()
        hooks = [module.register_forward_pre_hook(lambda *_: checkpoint()) for module in self._stops(vc)]
        try:
            # librosa lit les fichiers en mémoire : rien n'est écrit sur disque.
            wav = vc.generate(io.BytesIO(source), target_voice_path=io.BytesIO(target))
        finally:
            for hook in hooks:
                hook.remove()
        checkpoint()
        samples = np.clip(wav.detach().cpu().float().numpy().reshape(-1), -1, 1)
        return (samples * 32767).astype("<i2").tobytes(), int(vc.sr)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # 0.0.0.0 n'a de sens que dans le conteneur, sur le réseau compose interne sans port publié.
    parser.add_argument("--host", default=os.environ.get("VC_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--device", default=os.environ.get("VC_DEVICE", "cuda"))
    parser.add_argument(
        "--weights-dir",
        type=Path,
        default=Path(os.environ.get("VC_WEIGHTS_DIR") or Path.home() / ".llm-voice" / "models" / "chatterbox-vc"),
    )
    parser.add_argument("--allowed-hosts", default=os.environ.get("VC_ALLOWED_HOSTS", ""), help="noms de service admis dans Host, en plus de la boucle locale")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    force_offline_env()
    args = build_parser().parse_args(argv)
    extra_hosts = parse_allowed_hosts(args.allowed_hosts)
    service = VcService(ChatterboxVcEngine(args.weights_dir, args.device), yield_flag_path())
    server = serve(service, args.host, args.port, extra_hosts)

    def maintain_forever() -> None:
        while True:
            time.sleep(MAINTAIN_S)
            service.maintain()

    threading.Thread(target=maintain_forever, name="maintain", daemon=True).start()
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    emit("listening", host=args.host, port=args.port, device=args.device, allowed_hosts=sorted(extra_hosts))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
