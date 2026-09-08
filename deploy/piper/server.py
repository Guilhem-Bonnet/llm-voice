#!/usr/bin/env python3
"""Minimal wrapper exposing Piper as an OpenAI-compatible TTS server.

`openedai-speech` is archived (linux-first-v1.md §3) and other active forks
were not vetted for this project's exact contract, so this is the "wrapper
maison ~100 lignes" recommendation: `/v1/audio/speech`, `/v1/audio/voices`,
`/health`, matching `OpenAICompatibleTtsProvider` (vscode-extension/src/tts).
Pure stdlib (`http.server`), one subprocess call to the `piper` CLI per
request. No model embedded in the image (downloaded on first start into the
`/models` bind mount, see `entrypoint.sh`).
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS_DIR = os.environ.get("PIPER_MODELS_DIR", "/models")
DEFAULT_VOICE = os.environ.get("PIPER_VOICE", "fr_FR-siwis-medium")
PORT = int(os.environ.get("PIPER_PORT", "5000"))


def voice_model_path(voice: str) -> str:
    return os.path.join(MODELS_DIR, f"{voice}.onnx")


def list_voices() -> list[str]:
    if not os.path.isdir(MODELS_DIR):
        return []
    return sorted(name[:-5] for name in os.listdir(MODELS_DIR) if name.endswith(".onnx"))


def synthesize(text: str, voice: str) -> bytes:
    model_path = voice_model_path(voice)
    if not os.path.isfile(model_path):
        raise FileNotFoundError(f"unknown voice or model not downloaded: {voice}")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out_path = tmp.name
    try:
        subprocess.run(
            ["piper", "--model", model_path, "--output_file", out_path],
            input=text.encode("utf-8"),
            check=True,
            timeout=120,
        )
        with open(out_path, "rb") as handle:
            return handle.read()
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    server_version = "llm-voice-piper/0.1"

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        if self.path == "/health":
            self._json(200, {"status": "ok", "voices": list_voices()})
            return
        if self.path == "/v1/audio/voices":
            voices = [{"id": v, "name": v, "language": "fr"} for v in list_voices()]
            self._json(200, {"voices": voices})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/audio/speech":
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON body"})
            return
        text = body.get("input")
        if not text or not isinstance(text, str):
            self._json(400, {"error": "missing 'input'"})
            return
        voice = body.get("voice") or DEFAULT_VOICE
        try:
            wav_bytes = synthesize(text, voice)
        except FileNotFoundError as error:
            self._json(404, {"error": str(error)})
            return
        except subprocess.CalledProcessError as error:
            self._json(500, {"error": f"piper failed: {error}"})
            return
        self.send_response(200)
        self.send_header("content-type", "audio/wav")
        self.send_header("content-length", str(len(wav_bytes)))
        self.end_headers()
        self.wfile.write(wav_bytes)

    def log_message(self, fmt: str, *args) -> None:  # quiet, no request bodies logged
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
