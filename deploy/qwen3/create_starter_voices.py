#!/usr/bin/env python3
"""Crée le jeu de départ : huit voix variées, par POST /voices/create sur le serveur Qwen3 local.

    python3 -P deploy/qwen3/create_starter_voices.py [--url http://127.0.0.1:8021] [--out voix.json]

Reprenable : une voix dont le nom existe déjà (409) est retrouvée dans GET /voices, pas recréée.
Aucun nom de personne réelle. Environ 30 s par voix ; s'arrête au premier refus (503 en mode jeu).
Bibliothèque standard seule, et jamais de proxy : la requête ne quitte pas cette machine.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

STARTER = (
    ("Jeune femme claire", "Young woman in her twenties, bright clear voice, light and lively."),
    ("Femme mûre posée", "Woman in her fifties, warm medium-low voice, composed and measured."),
    ("Femme âgée chaleureuse", "Elderly woman in her seventies, soft slightly husky voice, warm and kind."),
    ("Jeune homme vif", "Young man in his twenties, energetic tenor voice, quick and bright."),
    ("Homme mûr grave", "Middle-aged man, deep low voice, slow and grave."),
    ("Homme âgé rauque", "Old man in his seventies, hoarse raspy voice, low and weathered."),
    ("Voix d'enfant", "Child around ten years old, high light voice, neutral and clear."),
    ("Voix androgyne douce", "Androgynous adult voice, soft gentle mid-range pitch, calm and smooth."),
)

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def existing(url: str, name: str) -> dict:
    with OPENER.open(f"{url}/voices", timeout=10) as response:
        voices = json.load(response)["voices"]
    row = next(voice for voice in voices if voice["name"].casefold() == name.casefold())
    return {"id": row["id"], "name": row["name"], "description": row["description"]}


def create(url: str, name: str, description: str, timeout: float) -> dict:
    data = urllib.parse.urlencode({"name": name, "description": description}).encode("utf-8")
    request = urllib.request.Request(
        f"{url}/voices/create", data=data, method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    started = time.monotonic()
    try:
        with OPENER.open(request, timeout=timeout) as response:
            payload = {**json.load(response), "status": "created"}
    except urllib.error.HTTPError as error:
        if error.code != 409:
            detail = json.loads(error.read() or b"{}").get("detail", "")
            raise SystemExit(f"{name} : {error.code} {detail}") from None
        payload = {**existing(url, name), "status": "existing"}
    payload["duration_s"] = round(time.monotonic() - started, 1)
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:8021")
    parser.add_argument("--timeout", type=float, default=600, help="secondes par voix, chargement du modèle compris")
    parser.add_argument("--out", type=Path, help="écrit aussi le résultat dans ce fichier JSON")
    args = parser.parse_args(argv)
    url = args.url.rstrip("/")
    results = []
    for name, description in STARTER:
        results.append(create(url, name, description, args.timeout))
        print(json.dumps(results[-1], ensure_ascii=False), flush=True)
    if args.out:
        args.out.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
