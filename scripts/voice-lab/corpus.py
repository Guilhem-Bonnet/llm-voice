"""Lit les textes d'essai de docs/essais-voix (format décrit dans leur README)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

LINE = re.compile(r"^@([\w-]+):\s*(.+)$")
CAST = re.compile(r"^%\s*([\w-]+)\s*=\s*([\w-]+)\s*$")


@dataclass(frozen=True)
class Word:
    word: str
    respelled: str
    sentence: str

    def raw(self) -> str:
        return self.sentence.replace("{x}", self.word)

    def phonetic(self) -> str:
        return self.sentence.replace("{x}", self.respelled)


@dataclass
class Text:
    lines: list[tuple[str, str]] = field(default_factory=list)
    cast: dict[str, str] = field(default_factory=dict)
    words: list[Word] = field(default_factory=list)


def parse(source: str) -> Text:
    text = Text()
    for raw in source.splitlines():
        stripped = raw.strip()
        if (match := LINE.match(stripped)) is not None:
            text.lines.append((match.group(1), match.group(2).strip()))
        elif (match := CAST.match(stripped)) is not None:
            text.cast[match.group(1)] = match.group(2)
        elif stripped.startswith("- ") and stripped.count("::") == 2:
            word, respelled, sentence = (part.strip() for part in stripped[2:].split("::"))
            if "{x}" not in sentence:
                raise ValueError(f"phrase sans {{x}} : {stripped}")
            text.words.append(Word(word, respelled, sentence))
    missing = {name for name, _ in text.lines} - set(text.cast)
    if text.cast and missing:
        raise ValueError(f"personnages sans voix : {sorted(missing)}")
    return text


def load(path: Path) -> Text:
    return parse(path.read_text(encoding="utf-8"))
