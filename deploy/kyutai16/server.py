#!/usr/bin/env python3
"""Serveur local de Kyutai TTS 1.6B (en_fr) : voix françaises précalculées.

Même contrat HTTP que `pocket-tts serve`, pour que `KyutaiPocketProvider` serve aux deux :

  GET  /health   {"status": "healthy", "state": ..., ...}, jamais de chargement ni de charge GPU
  POST /load     lance le chargement du modèle en tâche de fond, sans synthèse : 202, 200 si déjà fait
  GET  /voices   le catalogue et ce que le cache local contient réellement
  POST /tts      formulaire `text`, `voice_url` : renvoie un WAV entier

Garanties, chacune couverte par test_server.py :
  - aucun texte ne sort de la machine : pas de téléchargement (HF_HUB_OFFLINE=1 forcé), Host et
    Origin vérifiés, et le service ne journalise jamais le texte ;
  - `voice_url` n'accepte que les identifiants du catalogue : jamais de chemin, jamais d'URL ;
  - une synthèse à la fois, les suivantes attendent dans l'ordre d'arrivée ;
  - un client qui se déconnecte annule sa synthèse, ou sa place dans la file ;
  - mode jeu (`$XDG_RUNTIME_DIR/gpu-yield/active`) : 503, sans charge GPU et sans contournement,
    vérifié avant le chargement, à chaque trame et par une boucle qui libère la mémoire du GPU.

Bibliothèque standard seule, plus moshi (et torch, numpy) importés au premier chargement.
Python 3.10 : c'est celui de l'image `deploy-chatterbox`.
"""
from __future__ import annotations

import argparse
import collections
import gc
import io
import json
import os
import select
import signal
import socket
import sys
import threading
import time
import wave
from email.parser import BytesParser
from email.policy import HTTP as HTTP_POLICY
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Optional, Protocol
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
ENGINE_NAME = "kyutai-tts-1.6b"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8020
DEFAULT_VOICE = "cml-577_394"
MAX_TEXT_CHARS = 5000
MAX_BODY_BYTES = 256 * 1024
MAX_PENDING = 8
POLL_S = 0.1
MAINTAIN_S = 2.0
READ_TIMEOUT_S = 30
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "[::1]", "::1")

ESTELLE_FILE = "unmute-prod-website/developpeuse-3.wav.1e68beda@240.safetensors"
CML_DIR = "cml-tts/fr"
CML_SUFFIX = "_enhanced.wav.1e68beda@240.safetensors"

YIELD_MESSAGE = "Mode jeu actif (gpu-yield) : aucune synthèse tant qu'il dure. Réessayez une fois le jeu terminé."


class ServiceError(Exception):
    """Ce que le client peut lire : un état et un message, jamais le texte reçu."""

    status = 500
    message = "Échec de la synthèse. Le journal du serveur indique le type d'erreur."
    # Ce qu'un client décide sans lire la phrase : `gpu_yield` et `gpu_memory` ne se réessaient pas seuls.
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
    message = "Trop de synthèses en attente. Réessayez dans un instant."
    reason = "busy"


class GpuUnavailable(ServiceError):
    status = 503
    message = "GPU indisponible ou mémoire insuffisante : d'autres services l'utilisent peut-être."
    reason = "gpu_memory"


class VoiceUnavailable(ServiceError):
    status = 503
    message = "Cette voix du catalogue est absente du cache local."


class BadRequest(ServiceError):
    status = 400
    message = "Requête invalide."


class TooLarge(BadRequest):
    status = 413
    message = f"Texte trop long : {MAX_TEXT_CHARS} caractères au plus."


class Forbidden(BadRequest):
    status = 403
    message = "Requête refusée : ce serveur ne répond qu'à cette machine."


class Cancelled(Exception):
    """Le client est parti. Personne à qui répondre."""


class Engine(Protocol):
    loaded: bool

    def load(self) -> None: ...

    def unload(self) -> None: ...

    def synthesize(self, text: str, voice_file: Path, checkpoint: Callable[[], None]) -> tuple[bytes, int]:
        """PCM 16 bits mono et sa fréquence. `checkpoint` lève pour interrompre, à appeler souvent."""
        ...


def emit(event: str, **fields: object) -> None:
    """Journal structuré, une ligne JSON. Aucun appelant ne passe le texte : seulement sa longueur."""
    record = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "service": "kyutai16", "event": event, **fields}
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


def load_catalog(path: Path = HERE / "voices.json") -> dict[str, str]:
    """Identifiant -> prénom. La seule liste de voix acceptées."""
    return json.loads(path.read_text(encoding="utf-8"))


def find_voice_files(hub: Path, catalog: dict[str, str]) -> dict[str, Path]:
    """Le fichier de chaque voix du catalogue présente dans le cache. Aucune entrée du client n'y entre."""
    found: dict[str, Path] = {}
    snapshots = hub / "models--kyutai--tts-voices" / "snapshots"
    if not snapshots.is_dir():
        return found
    for snapshot in sorted(snapshots.iterdir()):
        estelle = snapshot / ESTELLE_FILE
        if estelle.exists():
            found["estelle"] = estelle
        for path in sorted((snapshot / CML_DIR).glob(f"*{CML_SUFFIX}")):
            found["cml-" + "_".join(path.name.split("_")[:2])] = path
    return {voice: path for voice, path in found.items() if voice in catalog}


def wav_bytes(pcm: bytes, rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm)
    return buffer.getvalue()


def parse_form(content_type: str, body: bytes) -> dict[str, str]:
    """`multipart/form-data` ou urlencodé. Un fichier joint est refusé : ce serveur n'en lit aucun."""
    kind = content_type.split(";", 1)[0].strip().lower()
    try:
        if kind == "application/x-www-form-urlencoded":
            parsed = parse_qs(body.decode("utf-8"), keep_blank_values=True, max_num_fields=8)
            return {name: values[0] for name, values in parsed.items()}
        if kind != "multipart/form-data":
            raise BadRequest("Formulaire attendu : multipart/form-data ou urlencodé.")
        head = b"Content-Type: " + content_type.encode("latin-1") + b"\r\nMIME-Version: 1.0\r\n\r\n"
        message = BytesParser(policy=HTTP_POLICY).parsebytes(head + body)
        if not message.is_multipart():
            raise BadRequest("Formulaire illisible.")
        form: dict[str, str] = {}
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if part.get_filename() is not None or name == "voice_wav":
                raise BadRequest("Aucun fichier accepté : choisissez une voix du catalogue.")
            if isinstance(name, str):
                payload = part.get_payload(decode=True) or b""
                form[name] = payload.decode("utf-8")
        return form
    except (UnicodeError, ValueError) as error:
        raise BadRequest("Formulaire illisible.") from error


def validated_request(form: dict[str, str], catalog: dict[str, str]) -> tuple[str, str]:
    text = form.get("text", "").strip()
    if not text:
        raise BadRequest("Champ `text` manquant ou vide.")
    if len(text) > MAX_TEXT_CHARS:
        raise TooLarge()
    voice = form.get("voice_url", "").strip() or DEFAULT_VOICE
    if voice not in catalog:
        raise BadRequest("`voice_url` : seuls les identifiants du catalogue sont acceptés (GET /voices).")
    return text, voice


def is_out_of_memory(error: BaseException) -> bool:
    """Par le type ou par le message HIP ; le message n'est jamais journalisé, il peut citer le texte."""
    return "OutOfMemory" in type(error).__name__ or "out of memory" in str(error).lower()


class Kyutai16Service:
    """Tout ce qui ne dépend pas de HTTP : file, mode jeu, modèle."""

    def __init__(
        self,
        engine: Engine,
        catalog: dict[str, str],
        voice_files: dict[str, Path],
        yield_flag: Path,
        log: Callable[..., None] = emit,
    ) -> None:
        self.engine = engine
        self.catalog = catalog
        self.voice_files = voice_files
        self.yield_flag = yield_flag
        self.log = log
        self._condition = threading.Condition()
        self._waiting: collections.deque[object] = collections.deque()
        self._running = False
        # Depuis quand le modèle charge, ou va charger : horloge monotone, `None` hors chargement.
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
        loading_since = self._loading_since
        loaded = self.engine.loaded
        if yielding:
            state = "yielded"
        elif loading_since is not None:
            state = "loading"
        else:
            state = "ready" if loaded else "unloaded"
        payload: dict[str, object] = {
            "status": "healthy",
            "engine": ENGINE_NAME,
            "state": state,
            "model_loaded": loaded,
            "gpu_yield": yielding,
            "voices": len(self.voice_files),
        }
        if state == "loading" and loading_since is not None:
            payload["loading_since_s"] = round(time.monotonic() - loading_since, 1)
        return payload

    def voices(self) -> dict[str, object]:
        rows = [{"id": voice, "name": name, "available": voice in self.voice_files} for voice, name in self.catalog.items()]
        rows.sort(key=lambda row: (row["id"] != DEFAULT_VOICE, str(row["name"])))
        return {"default": DEFAULT_VOICE, "voices": rows}

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
        # Même sans modèle chargé : un chargement interrompu laisse des blocs réservés.
        try:
            self.engine.unload()
            self.log("model_unloaded")
        except Exception as error:  # noqa: BLE001 : le nom du type seul, voir `synthesize`
            self.log("model_unload_failed", error=type(error).__name__)

    def _load_model(self) -> None:
        """Appelé par qui détient la file : `/health` lit `_loading_since` sans l'attendre."""
        started = time.monotonic()
        with self._condition:
            if self._loading_since is None:
                self._loading_since = started
        try:
            self.engine.load()
            self.log("model_loaded", duration_s=round(time.monotonic() - started, 1))
        finally:
            with self._condition:
                self._loading_since = None

    def begin_load(self) -> bool:
        """Charge le modèle sans rien synthétiser. Vrai s'il l'est déjà, faux si le chargement suit."""
        if self.yielding():
            raise GpuYielded()
        with self._condition:
            if self.engine.loaded:
                return True
            if self._loading_since is not None:
                return False
            self._loading_since = time.monotonic()
        threading.Thread(target=self._load_in_background, name="load", daemon=True).start()
        return False

    def _load_in_background(self) -> None:
        def checkpoint() -> None:
            if self.yielding():
                raise GpuYielded()

        try:
            self._enter(checkpoint)
        except ServiceError as error:
            self.log("load_abandoned", error=type(error).__name__)
            with self._condition:
                self._loading_since = None
            return
        release = False
        try:
            checkpoint()
            if not self.engine.loaded:
                self._load_model()
                # Le chargement ne s'interrompt pas : le mode jeu a pu commencer pendant.
                checkpoint()
        except GpuYielded:
            release = True
        except Exception as error:  # noqa: BLE001 : le nom du type seul, voir `synthesize`
            self.log("load_failed", error=type(error).__name__)
            release = is_out_of_memory(error)
        with self._condition:
            self._loading_since = None
        # Hors du `except`, pour la raison dite dans `synthesize`.
        try:
            if release:
                self._release_model()
        finally:
            self._leave()

    def synthesize(self, text: str, voice: str, disconnected: Callable[[], bool]) -> bytes:
        voice_file = self.voice_files.get(voice)
        if voice_file is None:
            raise VoiceUnavailable()

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
                if not self.engine.loaded:
                    self._load_model()
                    # Le chargement ne s'interrompt pas : le mode jeu a pu commencer pendant.
                    checkpoint()
                pcm, rate = self.engine.synthesize(text, voice_file, checkpoint)
                return wav_bytes(pcm, rate)
            except GpuYielded:
                failure = GpuYielded()
            except (Cancelled, ServiceError):
                raise
            except Exception as error:  # noqa: BLE001
                # Le type seul : un message d'exception peut citer le texte.
                name = type(error).__name__
                self.log("synthesis_failed", error=name)
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
                return  # La synthèse en cours s'interrompt elle-même à sa prochaine trame.
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


def is_local_host_header(value: Optional[str]) -> bool:
    if not value:
        return False
    host = value.strip().lower()
    if host.startswith("["):
        host = host.split("]", 1)[0] + "]"
    else:
        host = host.rsplit(":", 1)[0]
    return host in LOOPBACK_HOSTS


def make_handler(service: Kyutai16Service) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "kyutai16"
        sys_version = ""
        timeout = READ_TIMEOUT_S

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            """Jamais la ligne de requête : elle peut porter n'importe quoi. `emit` dit ce qui compte."""

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

        def _check_origin(self) -> None:
            # Une page web ouverte dans un navigateur ne doit ni charger le GPU ni joindre ce serveur.
            if not is_local_host_header(self.headers.get("Host")) or self.headers.get("Origin") is not None:
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
            route = urlsplit(self.path).path
            try:
                self._check_origin()
                if route == "/health":
                    self._json(200, service.health())
                elif route == "/voices":
                    self._json(200, service.voices())
                else:
                    self._json(404, {"detail": "Adresse inconnue."})
            except ServiceError as error:
                self._error(error.status, error)

        def _error(self, status: int, error: ServiceError, extra: Optional[dict[str, str]] = None) -> None:
            payload: dict[str, object] = {"detail": error.message}
            if error.reason is not None:
                payload["reason"] = error.reason
            self._json(status, payload, extra)

        def do_POST(self) -> None:  # noqa: N802
            started = time.monotonic()
            route = urlsplit(self.path).path
            fields: dict[str, object] = {"route": route if route in ("/tts", "/load") else "other"}
            status = 500
            try:
                self._check_origin()
                if route == "/load":
                    status = 200 if service.begin_load() else 202
                    self._json(status, {"state": "ready" if status == 200 else "loading"})
                    return
                if route != "/tts":
                    raise ServiceError("Adresse inconnue.")
                form = parse_form(self.headers.get("Content-Type") or "", self._read_body())
                text, voice = validated_request(form, service.catalog)
                fields.update(voice=voice, text_chars=len(text))
                audio = service.synthesize(text, voice, lambda: peer_is_gone(self.connection))
                status = 200
                self._reply(200, audio, "audio/wav")
            except Cancelled:
                status = 499
                self.close_connection = True
            except ServiceError as error:
                status = 404 if fields["route"] == "other" and not isinstance(error, BadRequest) else error.status
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
        """Le traitement par défaut écrit une trace complète, qui pourrait citer le texte."""
        emit("connection_error", error=sys.exc_info()[0].__name__ if sys.exc_info()[0] else "inconnue")


def serve(service: Kyutai16Service, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> Server:
    return Server((host, port), make_handler(service))


class MoshiEngine:
    """Le modèle réel, mêmes réglages que le banc prouvé (scripts/voice-lab/kyutai16.py)."""

    def __init__(self, device: str = "cuda") -> None:
        self.device = device
        self._model = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        force_offline_env()
        import torch
        from moshi.models.loaders import CheckpointInfo
        from moshi.models.tts import DEFAULT_DSM_TTS_REPO, TTSModel

        if self.device.startswith("cuda") and not torch.cuda.is_available():
            raise GpuUnavailable()
        info = CheckpointInfo.from_hf_repo(DEFAULT_DSM_TTS_REPO)
        self._model = TTSModel.from_checkpoint_info(info, n_q=32, temp=0.6, device=self.device)

    def unload(self) -> None:
        self._model = None
        gc.collect()
        if self.device.startswith("cuda"):
            import torch

            torch.cuda.empty_cache()

    def synthesize(self, text: str, voice_file: Path, checkpoint: Callable[[], None]) -> tuple[bytes, int]:
        import numpy as np
        import torch

        model = self._model

        def on_frame(_frame: object) -> None:
            # Une exception ici remonte de `model.generate`, et son `with streaming` remet l'état à zéro.
            checkpoint()

        entries = model.prepare_script([text], padding_between=1)
        conditions = model.make_condition_attributes([voice_file], cfg_coef=2.0)
        result = model.generate([entries], [conditions], on_frame=on_frame)
        pcms = []
        with model.mimi.streaming(1), torch.no_grad():
            for frame in result.frames[model.delay_steps :]:
                checkpoint()
                pcms.append(np.clip(model.mimi.decode(frame[:, 1:, :]).cpu().numpy()[0, 0], -1, 1))
        samples = np.concatenate(pcms, axis=-1)
        return (samples * 32767).astype("<i2").tobytes(), int(model.mimi.sample_rate)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # 0.0.0.0 n'a de sens que dans le conteneur, où Docker ne publie que 127.0.0.1:8020.
    parser.add_argument("--host", default=os.environ.get("KYUTAI16_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--device", default=os.environ.get("KYUTAI16_DEVICE", "cuda"))
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    force_offline_env()
    args = build_parser().parse_args(argv)
    hf_home = Path(os.environ.get("HF_HOME") or Path.home() / ".cache" / "huggingface")
    catalog = load_catalog()
    voice_files = find_voice_files(hf_home / "hub", catalog)
    service = Kyutai16Service(MoshiEngine(args.device), catalog, voice_files, yield_flag_path())
    server = serve(service, args.host, args.port)

    def maintain_forever() -> None:
        while True:
            time.sleep(MAINTAIN_S)
            service.maintain()

    threading.Thread(target=maintain_forever, name="maintain", daemon=True).start()
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    emit("listening", host=args.host, port=args.port, voices=len(voice_files), catalog=len(catalog), device=args.device)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
