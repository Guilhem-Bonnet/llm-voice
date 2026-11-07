#!/usr/bin/env python3
"""Serveur local de Qwen3-TTS (1.7B) : voix figée et voix jouée, en français.

Même contrat HTTP que `deploy/kyutai16/server.py`, plus le champ `direction` :

  GET  /health   {"status": "healthy", "state": ..., "models": ...}, jamais de chargement ni de charge GPU
  POST /load     lance le chargement en tâche de fond, sans synthèse : 202, 200 si déjà fait.
                 Voix figée par défaut, `?mode=played` pour la voix jouée
  GET  /voices   le catalogue et ce que cette machine possède réellement : `origin` vaut `catalogue`
                 (voices.json) ou `created` (voix créées ici, hors du dépôt)
  GET  /voices/<id>/sample   le WAV d'extrait d'une voix, pour l'écouter
  POST /voices/create        formulaire `name`, `description` (anglais), `sample_text` facultatif :
                 VoiceDesign produit un extrait, la voix est figée depuis cet extrait. 201
  POST /tts      formulaire `text`, `voice_url`, `direction` facultatif : renvoie un WAV entier

Deux façons de produire :
  - sans `direction`, voix figée : modèle Base, clonage depuis les extraits du catalogue ;
  - avec `direction`, voix jouée : modèle VoiceDesign, consigne de jeu libre, en anglais, placée
    entre la description et l'accent de la voix du catalogue.

Garanties, chacune couverte par test_server.py :
  - aucun texte ne sort de la machine : pas de téléchargement (HF_HUB_OFFLINE=1 forcé), Host et
    Origin vérifiés, et le service ne journalise jamais ni le texte ni la consigne ;
  - `voice_url` n'accepte que les identifiants du catalogue : jamais de chemin, jamais d'URL ;
  - une voix créée reçoit un identifiant tiré par le serveur, vit dans `<refs>/created/<id>/`,
    survit au redémarrage, et sa création passe par la même file que `/tts` ;
  - une synthèse à la fois, les suivantes attendent dans l'ordre d'arrivée ;
  - un client qui se déconnecte annule sa synthèse, ou sa place dans la file ;
  - mode jeu (`$XDG_RUNTIME_DIR/gpu-yield/active`) : 503, sans charge GPU et sans contournement,
    vérifié avant le chargement, à chaque trame et par une boucle qui libère la mémoire du GPU ;
  - chaque modèle se charge au premier besoin. Si la mémoire manque pour le second, le premier
    est déchargé plutôt que de planter.

Bibliothèque standard seule, plus qwen_tts (et torch, numpy) importés au premier chargement.
Python 3.10 : c'est celui de l'image `deploy-chatterbox`.
"""
from __future__ import annotations

import argparse
import collections
import gc
import hashlib
import io
import json
import os
import re
import secrets
import select
import signal
import socket
import sys
import threading
import time
import wave
from dataclasses import dataclass
from email.parser import BytesParser
from email.policy import HTTP as HTTP_POLICY
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Collection, Optional, Protocol, TypeVar
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
T = TypeVar("T")
ENGINE_NAME = "qwen3-tts-1.7b"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8021
MAX_TEXT_CHARS = 5000
MAX_DIRECTION_CHARS = 500
MAX_NAME_CHARS = 40
MAX_DESCRIPTION_CHARS = 300
MAX_SAMPLE_TEXT_CHARS = 300
# L'extrait d'une voix créée : une phrase neutre d'une dizaine de secondes, la durée que le clonage préfère.
DEFAULT_SAMPLE_TEXT = (
    "Bonjour. Je vais vous lire ce texte calmement, en prenant le temps de bien articuler "
    "chaque mot, pour que l'écoute reste agréable du début à la fin."
)
# Placée entre la description et l'accent : un extrait posé fige une voix posée.
CREATE_DIRECTION = "Calm, neutral reading at a steady pace."
ORIGIN_CATALOGUE = "catalogue"
ORIGIN_CREATED = "created"
MAX_BODY_BYTES = 256 * 1024
MAX_PENDING = 8
POLL_S = 0.1
MAINTAIN_S = 2.0
READ_TIMEOUT_S = 30
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "[::1]", "::1")

MODE_FROZEN = "frozen"
MODE_PLAYED = "played"
MODES = (MODE_FROZEN, MODE_PLAYED)
MODEL_REPOS = {
    MODE_FROZEN: "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    MODE_PLAYED: "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
}
# Silence entre deux extraits de référence, comme au banc (voix_figer.py).
REFERENCE_GAP_S = 0.3
# Mémoire qu'un second modèle doit trouver libre pour que le premier reste chargé. Mesuré sur RX 9070
# à côté de Kyutai : ce second modèle ajoute environ 3200 Mio, le premier ayant déjà réservé ses blocs.
DEFAULT_MIN_FREE_VRAM_MB = 3000
DRM_ROOT = Path("/sys/class/drm")

# La voix figée les prononce comme des mots : relevé au banc, seuls ces trois-là.
FROZEN_STAGE_TAGS = re.compile(r"\[(?:cough|sigh|laughter)\] ?", re.IGNORECASE)
# Les jetons du gabarit de conversation du modèle : un texte lu n'a pas à clore son tour de parole.
CHAT_TOKENS = re.compile(r"<\|[^<>|]*\|>")
# Identifiant d'une voix créée : tiré par le serveur, jamais fourni par le client.
CREATED_ID = re.compile(r"v-[0-9a-f]{10}")
SAMPLE_ROUTE = re.compile(r"/voices/([^/]+)/sample")

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
    message = "Cette voix du catalogue n'a pas son extrait de référence sur cette machine."


class BadRequest(ServiceError):
    status = 400
    message = "Requête invalide."


class TooLarge(BadRequest):
    status = 413
    message = f"Texte trop long : {MAX_TEXT_CHARS} caractères au plus."


class Conflict(BadRequest):
    status = 409
    message = "Ce nom de voix existe déjà."


class NotFound(ServiceError):
    status = 404
    message = "Adresse inconnue."


class Forbidden(BadRequest):
    status = 403
    message = "Requête refusée : ce serveur ne répond qu'à cette machine."


class Cancelled(Exception):
    """Le client est parti. Personne à qui répondre."""


@dataclass(frozen=True)
class Voice:
    id: str
    name: str
    seed: int
    description: str
    accent: str
    # Chemins relatifs à la racine des extraits : aucun audio n'entre dans le dépôt.
    frozen_refs: tuple[dict, ...] = ()
    origin: str = ORIGIN_CATALOGUE


@dataclass(frozen=True)
class Catalog:
    default: str
    language: str
    voices: dict[str, Voice]


@dataclass(frozen=True)
class Reference:
    audio: Path
    text: str


@dataclass(frozen=True)
class Request:
    text: str
    voice: str
    direction: str


@dataclass(frozen=True)
class Creation:
    name: str
    description: str
    sample_text: str


@dataclass(frozen=True)
class Job:
    """Ce que le modèle reçoit. `instruct` n'existe que pour la voix jouée."""

    mode: str
    text: str
    voice: str
    seed: int
    instruct: Optional[str] = None


class Engine(Protocol):
    @property
    def loaded(self) -> Collection[str]: ...

    def load(self, mode: str) -> None: ...

    def unload(self, mode: Optional[str] = None) -> None:
        """`None` : tout, et même sans modèle chargé, un chargement interrompu laisse des blocs réservés."""
        ...

    def synthesize(self, job: Job, checkpoint: Callable[[], None]) -> tuple[bytes, int]:
        """PCM 16 bits mono et sa fréquence. `checkpoint` lève pour interrompre, à appeler souvent."""
        ...


def emit(event: str, **fields: object) -> None:
    """Journal structuré, une ligne JSON. Aucun appelant ne passe le texte : seulement sa longueur."""
    record = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "service": "qwen3", "event": event, **fields}
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


def read_free_vram(root: Path = DRM_ROOT) -> Optional[int]:
    """Octets libres de la plus grande carte, tous processus compris. `None` : on ne sait pas."""
    best: Optional[tuple[int, int]] = None
    try:
        for total_file in root.glob("card*/device/mem_info_vram_total"):
            total = int(total_file.read_text(encoding="ascii"))
            used = int((total_file.parent / "mem_info_vram_used").read_text(encoding="ascii"))
            if best is None or total > best[0]:
                best = (total, used)
    except (OSError, ValueError):
        return None
    return None if best is None else max(best[0] - best[1], 0)


def load_catalog(path: Path = HERE / "voices.json") -> Catalog:
    """La seule liste de voix acceptées. Changer d'extrait : éditer ce fichier et relancer le service."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    voices = {
        voice_id: Voice(
            id=voice_id,
            name=entry["name"],
            seed=int(entry["seed"]),
            description=entry["description"],
            accent=entry["accent"],
            frozen_refs=tuple(entry.get("frozen_refs", ())),
        )
        for voice_id, entry in raw["voices"].items()
    }
    if raw["default"] not in voices:
        raise ValueError("voices.json : la voix par défaut n'est pas au catalogue.")
    return Catalog(default=raw["default"], language=raw["language"], voices=voices)


def reference_of(entry: dict, root: Path) -> Reference:
    """Un extrait et sa transcription : champ `text`, ou sinon le .json posé à côté du fichier audio."""
    audio = (root / entry["audio"]).resolve()
    if not audio.is_relative_to(root.resolve()):
        raise ValueError("extrait hors de la racine des extraits")
    if not audio.is_file():
        raise FileNotFoundError(audio.name)
    text = entry.get("text") or json.loads(audio.with_suffix(".json").read_text(encoding="utf-8"))["text"]
    if not text.strip():
        raise ValueError("transcription vide")
    return Reference(audio=audio, text=text.strip())


def find_references(catalog: Catalog, root: Path, log: Callable[..., None] = emit) -> dict[str, tuple[Reference, ...]]:
    """Les extraits des voix du catalogue présents ici. Aucune entrée du client n'y entre."""
    found: dict[str, tuple[Reference, ...]] = {}
    for voice in catalog.voices.values():
        if not voice.frozen_refs:
            continue
        try:
            found[voice.id] = tuple(reference_of(entry, root) for entry in voice.frozen_refs)
        except (OSError, ValueError, KeyError, TypeError) as error:
            log("voice_reference_missing", voice=voice.id, error=type(error).__name__)
    return found


def played_instruction(voice: Voice, direction: str) -> str:
    return f"{voice.description} {direction} {voice.accent}"


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


def validated_request(form: dict[str, str], catalog: Catalog) -> Request:
    text = CHAT_TOKENS.sub("", form.get("text", "")).strip()
    if not text:
        raise BadRequest("Champ `text` manquant ou vide.")
    if len(text) > MAX_TEXT_CHARS:
        raise TooLarge()
    voice = form.get("voice_url", "").strip() or catalog.default
    if voice not in catalog.voices:
        raise BadRequest("`voice_url` : seuls les identifiants du catalogue sont acceptés (GET /voices).")
    direction = " ".join(CHAT_TOKENS.sub("", form.get("direction", "")).split())
    if len(direction) > MAX_DIRECTION_CHARS:
        raise TooLarge(f"Consigne trop longue : {MAX_DIRECTION_CHARS} caractères au plus.")
    if not direction:
        text = FROZEN_STAGE_TAGS.sub("", text).strip()
        if not text:
            raise BadRequest("Champ `text` manquant ou vide.")
    return Request(text=text, voice=voice, direction=direction)


def one_line(value: str) -> str:
    return " ".join(CHAT_TOKENS.sub("", value).split())


def validated_creation(form: dict[str, str]) -> Creation:
    """Aucun identifiant ni chemin n'est lu : le serveur tire l'identifiant lui-même."""
    name = one_line(form.get("name", ""))
    if not name or len(name) > MAX_NAME_CHARS or not name.isprintable():
        raise BadRequest(f"`name` : de 1 à {MAX_NAME_CHARS} caractères.")
    description = one_line(form.get("description", ""))
    if not description or len(description) > MAX_DESCRIPTION_CHARS:
        raise BadRequest(f"`description` : de 1 à {MAX_DESCRIPTION_CHARS} caractères.")
    if not description.isascii() or not description.isprintable():
        raise BadRequest("`description` : en anglais, sans accent, par exemple « Older man, deep low voice, slow and grave. »")
    sample_text = one_line(form.get("sample_text", ""))
    if len(sample_text) > MAX_SAMPLE_TEXT_CHARS or not sample_text.isprintable():
        raise BadRequest(f"`sample_text` : {MAX_SAMPLE_TEXT_CHARS} caractères au plus.")
    # Il deviendra la transcription de référence de la voix figée : pas de balise qu'elle prononcerait.
    sample_text = FROZEN_STAGE_TAGS.sub("", sample_text).strip() or DEFAULT_SAMPLE_TEXT
    return Creation(name=name, description=description, sample_text=sample_text)


def persist_created(root: Path, voice: Voice, sample_text: str, pcm: bytes, rate: int) -> Reference:
    """Écrit dans un dossier provisoire puis le renomme : jamais de voix à moitié écrite au démarrage."""
    root.mkdir(parents=True, exist_ok=True)
    staging = root / f".tmp-{voice.id}"
    staging.mkdir()
    try:
        (staging / "sample.wav").write_bytes(wav_bytes(pcm, rate))
        meta = {
            "id": voice.id,
            "name": voice.name,
            "description": voice.description,
            "accent": voice.accent,
            "seed": voice.seed,
            "sample_text": sample_text,
            "sample_seconds": round(len(pcm) / 2 / rate, 2),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        (staging / "voice.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        staging.rename(root / voice.id)
    except BaseException:
        # Deux fichiers au plus, puis le dossier vide : rien d'autre n'y est jamais écrit.
        for leftover in staging.iterdir():
            leftover.unlink(missing_ok=True)
        staging.rmdir()
        raise
    return Reference(audio=root / voice.id / "sample.wav", text=sample_text)


def load_created(root: Path, log: Callable[..., None] = emit) -> tuple[dict[str, Voice], dict[str, tuple[Reference, ...]]]:
    """Les voix créées ici. Un dossier illisible ne coûte que cette voix ; un nom hors format est ignoré."""
    voices: dict[str, Voice] = {}
    references: dict[str, tuple[Reference, ...]] = {}
    if not root.is_dir():
        return voices, references
    for folder in sorted(root.iterdir()):
        if not CREATED_ID.fullmatch(folder.name):
            continue
        try:
            meta = json.loads((folder / "voice.json").read_text(encoding="utf-8"))
            if meta["id"] != folder.name:
                raise ValueError("identifiant différent du dossier")
            audio = folder / "sample.wav"
            if not audio.is_file():
                raise FileNotFoundError(audio.name)
            text = meta["sample_text"].strip()
            if not text:
                raise ValueError("transcription vide")
            voices[folder.name] = Voice(
                id=folder.name,
                name=str(meta["name"]),
                seed=int(meta["seed"]),
                description=str(meta["description"]),
                accent=str(meta["accent"]),
                origin=ORIGIN_CREATED,
            )
            references[folder.name] = (Reference(audio=audio, text=text),)
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            log("created_voice_unreadable", voice=folder.name, error=type(error).__name__)
    return voices, references


def merge_created(
    catalog: Catalog, references: dict[str, tuple[Reference, ...]], root: Path, log: Callable[..., None] = emit
) -> int:
    """Ajoute au catalogue les voix créées ; une voix dont le nom existe déjà est écartée."""
    voices, found = load_created(root, log)
    added = 0
    for voice_id, voice in voices.items():
        taken = {other.name.casefold() for other in catalog.voices.values()}
        if voice_id in catalog.voices or voice.name.casefold() in taken:
            log("created_voice_skipped", voice=voice_id, why="name_taken")
            continue
        catalog.voices[voice_id] = voice
        references[voice_id] = found[voice_id]
        added += 1
    return added


def sample_wav(references: tuple[Reference, ...]) -> bytes:
    """Les extraits tels que le modèle les entend : bout à bout, séparés par le même silence."""
    frames: list[bytes] = []
    params: Optional[tuple[int, int, int]] = None
    for reference in references:
        with wave.open(str(reference.audio), "rb") as source:
            current = (source.getnchannels(), source.getsampwidth(), source.getframerate())
            if params is None:
                params = current
            elif current != params:
                break
            frames.append(source.readframes(source.getnframes()))
    if params is None:
        raise FileNotFoundError("aucun extrait")
    channels, width, rate = params
    gap = b"\x00" * (int(REFERENCE_GAP_S * rate) * channels * width)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(width)
        out.setframerate(rate)
        out.writeframes(gap.join(frames))
    return buffer.getvalue()


def is_out_of_memory(error: BaseException) -> bool:
    """Par le type ou par le message HIP ; le message n'est jamais journalisé, il peut citer le texte."""
    return "OutOfMemory" in type(error).__name__ or "out of memory" in str(error).lower()


class Qwen3Service:
    """Tout ce qui ne dépend pas de HTTP : file, mode jeu, modèles."""

    def __init__(
        self,
        engine: Engine,
        catalog: Catalog,
        references: dict[str, tuple[Reference, ...]],
        yield_flag: Path,
        log: Callable[..., None] = emit,
        free_vram: Callable[[], Optional[int]] = read_free_vram,
        min_free_vram: int = DEFAULT_MIN_FREE_VRAM_MB * 1024 * 1024,
        created_dir: Optional[Path] = None,
    ) -> None:
        self.engine = engine
        self.created_dir = created_dir
        self._catalog_lock = threading.Lock()
        self.catalog = catalog
        self.references = references
        self.yield_flag = yield_flag
        self.log = log
        self.free_vram = free_vram
        self.min_free_vram = min_free_vram
        self._condition = threading.Condition()
        self._waiting: collections.deque[object] = collections.deque()
        self._running = False
        # Ce qui charge, ou va charger, et depuis quand : horloge monotone.
        self._loading: dict[str, float] = {}

    def yielding(self) -> bool:
        try:
            return self.yield_flag.exists()
        except OSError:
            # Illisible : dans le doute, le GPU reste au jeu.
            return True

    def health(self) -> dict[str, object]:
        """Ne charge rien et ne prend aucun verrou : répond aussi pendant `engine.load()`."""
        yielding = self.yielding()
        loading = dict(self._loading)
        loaded = frozenset(self.engine.loaded)
        if yielding:
            state = "yielded"
        elif loading:
            state = "loading"
        else:
            state = "ready" if loaded else "unloaded"
        payload: dict[str, object] = {
            "status": "healthy",
            "engine": ENGINE_NAME,
            "state": state,
            "model_loaded": bool(loaded),
            "models": {mode: mode in loaded for mode in MODES},
            "gpu_yield": yielding,
            "voices": len(self.references),
        }
        if state == "loading":
            payload["loading_since_s"] = round(time.monotonic() - min(loading.values()), 1)
            payload["loading"] = sorted(loading)
        return payload

    def voices(self) -> dict[str, object]:
        default = self.catalog.default
        rows = [
            {
                "id": voice.id,
                "name": voice.name,
                "available": voice.id in self.references,
                "played": True,
                "description": voice.description,
                "origin": voice.origin,
            }
            for voice in list(self.catalog.voices.values())
        ]
        rows.sort(key=lambda row: (row["id"] != default, str(row["name"])))
        return {"default": default, "voices": rows}

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
        except Exception as error:  # noqa: BLE001 : le nom du type seul, voir `synthesize`
            self.log("model_unload_failed", error=type(error).__name__)

    def _others(self, mode: str) -> list[str]:
        return [other for other in self.engine.loaded if other != mode]

    def _release_others(self, mode: str, why: str) -> None:
        for other in self._others(mode):
            self.engine.unload(other)
            self.log("model_swapped_out", mode=other, why=why)

    def _load_model(self, mode: str) -> None:
        """Appelé par qui détient la file : `/health` lit `_loading` sans l'attendre."""
        started = time.monotonic()
        with self._condition:
            self._loading.setdefault(mode, started)
        try:
            self.engine.load(mode)
            self.log("model_loaded", mode=mode, duration_s=round(time.monotonic() - started, 1))
        finally:
            with self._condition:
                self._loading.pop(mode, None)

    def _ensure_model(self, mode: str) -> None:
        if mode in self.engine.loaded:
            return
        if self._others(mode):
            # D'autres services tiennent le GPU : on ne le remplit pas jusqu'à les faire tomber.
            free = self.free_vram()
            if free is None or free < self.min_free_vram:
                self._release_others(mode, "memory_low" if free is not None else "memory_unknown")
        try:
            self._load_model(mode)
            return
        except Exception as error:  # noqa: BLE001 : le nom du type seul, voir `synthesize`
            if not is_out_of_memory(error) or not self._others(mode):
                raise
            self.log("load_out_of_memory", mode=mode)
        # Hors du `except`, pour la raison dite dans `synthesize`.
        self._release_others(mode, "out_of_memory")
        self._load_model(mode)

    def _run(self, job: Job, checkpoint: Callable[[], None]) -> tuple[bytes, int]:
        try:
            return self.engine.synthesize(job, checkpoint)
        except Exception as error:  # noqa: BLE001 : le nom du type seul, voir `synthesize`
            if not is_out_of_memory(error) or not self._others(job.mode):
                raise
            self.log("synthesis_out_of_memory", mode=job.mode)
        # Hors du `except`, pour la raison dite dans `synthesize`.
        self._release_others(job.mode, "out_of_memory")
        checkpoint()
        return self.engine.synthesize(job, checkpoint)

    def begin_load(self, mode: str = MODE_FROZEN) -> bool:
        """Charge un modèle sans rien synthétiser. Vrai s'il l'est déjà, faux si le chargement suit."""
        if self.yielding():
            raise GpuYielded()
        with self._condition:
            if mode in self.engine.loaded:
                return True
            if mode in self._loading:
                return False
            self._loading[mode] = time.monotonic()
        threading.Thread(target=self._load_in_background, args=(mode,), name="load", daemon=True).start()
        return False

    def _load_in_background(self, mode: str) -> None:
        def checkpoint() -> None:
            if self.yielding():
                raise GpuYielded()

        try:
            self._enter(checkpoint)
        except ServiceError as error:
            self.log("load_abandoned", mode=mode, error=type(error).__name__)
            with self._condition:
                self._loading.pop(mode, None)
            return
        release = False
        try:
            checkpoint()
            self._ensure_model(mode)
            # Le chargement ne s'interrompt pas : le mode jeu a pu commencer pendant.
            checkpoint()
        except GpuYielded:
            release = True
        except Exception as error:  # noqa: BLE001 : le nom du type seul, voir `synthesize`
            self.log("load_failed", mode=mode, error=type(error).__name__)
            release = is_out_of_memory(error)
        with self._condition:
            self._loading.pop(mode, None)
        # Hors du `except`, pour la raison dite dans `synthesize`.
        try:
            if release:
                self._release_model()
        finally:
            self._leave()

    def job_for(self, request: Request) -> Job:
        voice = self.catalog.voices[request.voice]
        if request.direction:
            return Job(MODE_PLAYED, request.text, voice.id, voice.seed, played_instruction(voice, request.direction))
        if voice.id not in self.references:
            raise VoiceUnavailable()
        return Job(MODE_FROZEN, request.text, voice.id, voice.seed)

    def sample(self, voice_id: str) -> bytes:
        """L'identifiant n'est qu'une clé du catalogue : jamais un chemin."""
        if voice_id not in self.catalog.voices:
            raise NotFound("Voix inconnue : seuls les identifiants de GET /voices sont acceptés.")
        references = self.references.get(voice_id)
        if not references:
            raise VoiceUnavailable()
        try:
            return sample_wav(references)
        except (OSError, EOFError, wave.Error) as error:
            self.log("voice_sample_unreadable", voice=voice_id, error=type(error).__name__)
            raise VoiceUnavailable() from None

    def _check_name_free(self, name: str) -> None:
        wanted = name.casefold()
        if any(voice.name.casefold() == wanted for voice in list(self.catalog.voices.values())):
            raise Conflict()

    def _new_id(self, creation: Creation, seed: int, root: Path) -> str:
        while True:
            material = f"{creation.name}\0{creation.description}\0{seed}\0{time.time_ns()}\0{secrets.token_hex(8)}"
            voice_id = "v-" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:10]
            if voice_id not in self.catalog.voices and not (root / voice_id).exists():
                return voice_id

    def create_voice(self, creation: Creation, disconnected: Callable[[], bool]) -> dict[str, object]:
        """VoiceDesign produit l'extrait (graine tirée puis gardée), puis l'extrait devient la référence figée."""
        root = self.created_dir
        if root is None:
            raise VoiceUnavailable("Création de voix indisponible : aucun dossier où les garder.")
        self._check_name_free(creation.name)
        seed = secrets.randbelow(2**31)
        accent = self.catalog.voices[self.catalog.default].accent
        voice = Voice(
            id=self._new_id(creation, seed, root),
            name=creation.name,
            seed=seed,
            description=creation.description,
            accent=accent,
            origin=ORIGIN_CREATED,
        )
        instruct = f"{creation.description} {CREATE_DIRECTION} {accent}"
        job = Job(MODE_PLAYED, creation.sample_text, voice.id, seed, instruct)

        def finish(pcm: bytes, rate: int) -> dict[str, object]:
            # Encore dans la file : aucun chargement du modèle figé ne parcourt les références pendant l'ajout.
            with self._catalog_lock:
                self._check_name_free(voice.name)
                reference = persist_created(root, voice, creation.sample_text, pcm, rate)
                self.catalog.voices[voice.id] = voice
                self.references[voice.id] = (reference,)
            return {
                "id": voice.id,
                "name": voice.name,
                "description": voice.description,
                "seed": seed,
                "sample_seconds": round(len(pcm) / 2 / rate, 2),
            }

        result = self._exclusive(job, disconnected, finish)
        self.log("voice_created", voice=voice.id, seed=seed, sample_seconds=result["sample_seconds"])
        return result

    def synthesize(self, request: Request, disconnected: Callable[[], bool]) -> bytes:
        return self._exclusive(self.job_for(request), disconnected, wav_bytes)

    def _exclusive(self, job: Job, disconnected: Callable[[], bool], finish: Callable[[bytes, int], T]) -> T:
        """Une synthèse à la fois, dans l'ordre d'arrivée ; `finish` s'exécute encore dans la file."""

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
                self._ensure_model(job.mode)
                # Le chargement ne s'interrompt pas : le mode jeu a pu commencer pendant.
                checkpoint()
                pcm, rate = self._run(job, checkpoint)
                return finish(pcm, rate)
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
        """Mode jeu commencé pendant que rien ne tourne : les modèles ne gardent pas la mémoire du GPU."""
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


def load_mode(query: str) -> str:
    mode = parse_qs(query, max_num_fields=4).get("mode", [MODE_FROZEN])[0]
    if mode not in MODES:
        raise BadRequest("`mode` : frozen ou played.")
    return mode


def make_handler(service: Qwen3Service) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "qwen3"
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
                elif (match := SAMPLE_ROUTE.fullmatch(route)) is not None:
                    self._reply(200, service.sample(match.group(1)), "audio/wav")
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
            address = urlsplit(self.path)
            route = address.path
            fields: dict[str, object] = {"route": route if route in ("/tts", "/load", "/voices/create") else "other"}
            status = 500
            try:
                self._check_origin()
                if route == "/load":
                    mode = load_mode(address.query)
                    fields["mode"] = mode
                    status = 200 if service.begin_load(mode) else 202
                    self._json(status, {"state": "ready" if status == 200 else "loading", "mode": mode})
                    return
                if route == "/voices/create":
                    creation = validated_creation(parse_form(self.headers.get("Content-Type") or "", self._read_body()))
                    # Des longueurs seulement : ni le nom, ni la description, ni l'extrait.
                    fields.update(
                        mode=MODE_PLAYED,
                        name_chars=len(creation.name),
                        description_chars=len(creation.description),
                        text_chars=len(creation.sample_text),
                    )
                    created = service.create_voice(creation, lambda: peer_is_gone(self.connection))
                    fields["voice"] = created["id"]
                    status = 201
                    self._json(201, created)
                    return
                if route != "/tts":
                    raise ServiceError("Adresse inconnue.")
                form = parse_form(self.headers.get("Content-Type") or "", self._read_body())
                request = validated_request(form, service.catalog)
                fields.update(
                    voice=request.voice,
                    mode=MODE_PLAYED if request.direction else MODE_FROZEN,
                    text_chars=len(request.text),
                    direction_chars=len(request.direction),
                )
                audio = service.synthesize(request, lambda: peer_is_gone(self.connection))
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


def serve(service: Qwen3Service, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> Server:
    return Server((host, port), make_handler(service))


class QwenEngine:
    """Les modèles réels, mêmes réglages que le banc écouté (~/.llm-voice/voices-lab/qwen3/run-voix/voix_figer.py)."""

    def __init__(self, language: str, references: dict[str, tuple[Reference, ...]], device: str = "cuda") -> None:
        self.language = language
        self.references = references
        self.device = device
        self._models: dict[str, object] = {}
        self._prompts: dict[str, object] = {}

    @property
    def loaded(self) -> Collection[str]:
        return frozenset(self._models)

    def load(self, mode: str) -> None:
        force_offline_env()
        import torch
        from huggingface_hub import snapshot_download
        from qwen_tts import Qwen3TTSModel

        if self.device.startswith("cuda") and not torch.cuda.is_available():
            raise GpuUnavailable()
        path = snapshot_download(MODEL_REPOS[mode], local_files_only=True)
        model = Qwen3TTSModel.from_pretrained(path, device_map=self.device, dtype=torch.bfloat16, attn_implementation="sdpa")
        if mode == MODE_FROZEN:
            # Ici plutôt qu'à la première phrase : le chargement peut être long, pas l'écoute.
            for voice in list(self.references):
                try:
                    self._prompts[voice] = self._clone_prompt(model, voice)
                except (OSError, ValueError, EOFError, wave.Error) as error:
                    # Un extrait illisible ne prive pas les autres voix de leur modèle.
                    emit("voice_prompt_failed", voice=voice, error=type(error).__name__)
        self._models[mode] = model

    def unload(self, mode: Optional[str] = None) -> None:
        for name in MODES if mode is None else (mode,):
            self._models.pop(name, None)
            if name == MODE_FROZEN:
                self._prompts.clear()
        gc.collect()
        if self.device.startswith("cuda"):
            import torch

            torch.cuda.empty_cache()

    def _clone_prompt(self, model: object, voice: str) -> object:
        import numpy as np

        parts = []
        rates = set()
        for reference in self.references[voice]:
            with wave.open(str(reference.audio), "rb") as source:
                rates.add(source.getframerate())
                parts.append(np.frombuffer(source.readframes(source.getnframes()), "<i2").astype("float32") / 32768)
        if len(rates) != 1:
            raise ValueError("extraits de fréquences différentes")
        rate = rates.pop()
        gap = np.zeros(int(REFERENCE_GAP_S * rate), dtype="float32")
        audio = np.concatenate([piece for part in parts for piece in (part, gap)])
        text = " ".join(reference.text for reference in self.references[voice])
        return model.create_voice_clone_prompt(ref_audio=(audio, rate), ref_text=text, x_vector_only_mode=False)

    def synthesize(self, job: Job, checkpoint: Callable[[], None]) -> tuple[bytes, int]:
        import numpy as np
        import torch

        model = self._models[job.mode]
        prompt = self._prompts.get(job.voice)
        if job.mode == MODE_FROZEN and prompt is None:
            # Une voix créée après le chargement : sa référence s'encode à sa première phrase.
            if job.voice not in self.references:
                raise VoiceUnavailable()
            try:
                prompt = self._prompts[job.voice] = self._clone_prompt(model, job.voice)
            except (OSError, ValueError, EOFError, wave.Error) as error:
                emit("voice_prompt_failed", voice=job.voice, error=type(error).__name__)
                raise VoiceUnavailable() from None
        # Une trame de code par passage dans `talker` : une exception ici remonte de `generate`.
        # La bibliothèque n'offre pas de `stopping_criteria` : ses arguments ne vont pas jusqu'à `talker.generate`.
        hook = model.model.talker.register_forward_pre_hook(lambda *_: checkpoint())
        try:
            torch.manual_seed(job.seed)
            if job.mode == MODE_PLAYED:
                wavs, rate = model.generate_voice_design(text=job.text, language=self.language, instruct=job.instruct)
            else:
                wavs, rate = model.generate_voice_clone(text=job.text, language=self.language, voice_clone_prompt=prompt)
        finally:
            hook.remove()
        checkpoint()
        samples = np.clip(np.asarray(wavs[0], dtype="float32").reshape(-1), -1, 1)
        return (samples * 32767).astype("<i2").tobytes(), int(rate)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # 0.0.0.0 n'a de sens que dans le conteneur, où Docker ne publie que 127.0.0.1:8021.
    parser.add_argument("--host", default=os.environ.get("QWEN3_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--device", default=os.environ.get("QWEN3_DEVICE", "cuda"))
    parser.add_argument(
        "--refs-dir",
        type=Path,
        default=Path(os.environ.get("QWEN3_REFS_DIR") or Path.home() / ".llm-voice" / "voices-lab" / "qwen3"),
    )
    parser.add_argument(
        "--created-dir",
        type=Path,
        default=Path(os.environ["QWEN3_CREATED_DIR"]) if os.environ.get("QWEN3_CREATED_DIR") else None,
        help="voix créées ici (défaut : <refs-dir>/created), le seul dossier où le service écrit",
    )
    parser.add_argument(
        "--min-free-vram-mb",
        type=int,
        default=int(os.environ.get("QWEN3_MIN_FREE_VRAM_MB") or DEFAULT_MIN_FREE_VRAM_MB),
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    force_offline_env()
    args = build_parser().parse_args(argv)
    catalog = load_catalog()
    references = find_references(catalog, args.refs_dir)
    created_dir = args.created_dir or args.refs_dir / "created"
    created = merge_created(catalog, references, created_dir)
    service = Qwen3Service(
        QwenEngine(catalog.language, references, args.device),
        catalog,
        references,
        yield_flag_path(),
        min_free_vram=args.min_free_vram_mb * 1024 * 1024,
        created_dir=created_dir,
    )
    server = serve(service, args.host, args.port)

    def maintain_forever() -> None:
        while True:
            time.sleep(MAINTAIN_S)
            service.maintain()

    threading.Thread(target=maintain_forever, name="maintain", daemon=True).start()
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    emit("listening", host=args.host, port=args.port, voices=len(references), catalog=len(catalog.voices), created=created, device=args.device)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
