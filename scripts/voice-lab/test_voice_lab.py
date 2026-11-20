import struct
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import audio  # noqa: E402
import corpus  # noqa: E402
import lab  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def tone(hz: float = 150, seconds: float = 1, rate: int = 24000, level: float = 0.4) -> audio.Pcm:
    time = np.arange(int(seconds * rate)) / rate
    return audio.Pcm(rate, (np.sin(2 * np.pi * hz * time) * level * 32767).astype(np.int16))


def streamed_wav(samples: bytes, rate: int = 24000) -> bytes:
    announced = 2_000_000_000
    fmt = struct.pack("<HHIIHH", 1, 1, rate, rate * 2, 2, 16)
    return b"RIFF" + struct.pack("<I", 36 + announced) + b"WAVEfmt " + struct.pack("<I", 16) + fmt + b"data" + struct.pack("<I", announced) + samples


class CorpusTest(unittest.TestCase):
    def test_reads_lines_cast_and_words(self):
        text = corpus.parse("# titre\n% a = estelle\n@a: Bonjour.\n- API :: A P I :: L'{x} marche.\nignoré\n")
        self.assertEqual(text.lines, [("a", "Bonjour.")])
        self.assertEqual(text.cast, {"a": "estelle"})
        self.assertEqual(text.words[0].raw(), "L'API marche.")
        self.assertEqual(text.words[0].phonetic(), "L'A P I marche.")

    def test_refuses_a_character_without_voice_and_a_word_without_slot(self):
        with self.assertRaises(ValueError):
            corpus.parse("% a = estelle\n@b: Bonjour.")
        with self.assertRaises(ValueError):
            corpus.parse("- API :: A P I :: sans emplacement")

    def test_shipped_texts_parse_and_cast_only_licensed_voices(self):
        folder = ROOT / "docs" / "essais-voix"
        self.assertGreaterEqual(len(corpus.load(folder / "01-mots-techniques.md").words), 15)
        self.assertGreaterEqual(len(corpus.load(folder / "02-ton-et-style.md").lines), 5)
        scene = corpus.load(folder / "03-personnages.md")
        self.assertGreaterEqual(len(set(scene.cast.values())), 3)
        self.assertLessEqual(set(scene.cast.values()), lab.licensed_voices(ROOT))
        self.assertNotIn("cosette", lab.licensed_voices(ROOT))


class AudioTest(unittest.TestCase):
    def test_reads_a_streamed_header_and_drops_a_half_sample(self):
        pcm = audio.parse_wav(streamed_wav(b"\x01\x00\x02\x00\x03"))
        self.assertEqual(pcm.samples.tolist(), [1, 2])

    def test_refuses_what_is_not_mono_pcm16(self):
        with self.assertRaises(ValueError):
            audio.parse_wav(b"not a wav file at all")
        with self.assertRaises(ValueError):
            audio.parse_wav(streamed_wav(b"").replace(struct.pack("<HH", 1, 1), struct.pack("<HH", 1, 2), 1))

    def test_measures_pitch_pauses_and_silence(self):
        silence = np.zeros(12000, dtype=np.int16)
        gapped = audio.concat([tone(200), audio.Pcm(24000, silence), tone(200)], pause_ms=0)
        measures = audio.measure(gapped)
        self.assertAlmostEqual(measures.pitch_hz, 200, delta=5)
        self.assertEqual(measures.pause_count, 1)
        self.assertAlmostEqual(measures.pause_total_s, 0.5, delta=0.1)
        self.assertEqual(audio.measure(audio.Pcm(24000, silence)).speech_ratio, 0)

    def test_two_pitches_are_told_apart(self):
        self.assertGreater(audio.measure(tone(240)).pitch_hz, audio.measure(tone(120)).pitch_hz + 80)

    def test_concat_inserts_the_pause(self):
        joined = audio.concat([tone(seconds=1), tone(seconds=1)], pause_ms=500)
        self.assertEqual(len(joined.samples), 24000 * 2 + 12000)
        with self.assertRaises(ValueError):
            audio.concat([])

    def test_word_error_rate(self):
        self.assertEqual(audio.word_error_rate("Le serveur, répond.", "le serveur répond"), 0)
        self.assertAlmostEqual(audio.word_error_rate("un deux trois quatre", "un deux quatre"), 0.25)

    def test_write_wav_round_trip(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "t.wav"
            audio.write_wav(path, tone(seconds=0.1))
            self.assertEqual(len(audio.parse_wav(path.read_bytes()).samples), 2400)


class SafetyTest(unittest.TestCase):
    def test_only_a_loopback_server_is_accepted(self):
        self.assertEqual(lab.loopback_url("http://127.0.0.1:8000/"), "http://127.0.0.1:8000")
        for url in ("http://example.com:8000", "https://127.0.0.1.evil.test", "file:///etc/passwd"):
            with self.assertRaises(ValueError):
                lab.loopback_url(url)

    def test_the_page_escapes_texts_and_plays_nothing_by_itself(self):
        page = lab.render_page([{"section": "S", "id": "a", "title": "<b>x</b>", "text": "<script>alert(1)</script>", "file": "a.ogg", "measures": {}, "note": ""}], {})
        self.assertNotIn("<script>alert(1)", page)
        self.assertNotIn("autoplay", page)
        self.assertIn('preload="none"', page)

    def test_the_page_carries_its_audio_and_needs_no_neighbour_file(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "a.ogg").write_bytes(b"OggS-test")
            item = {"section": "S", "id": "a", "title": "t", "text": "x", "file": "a.ogg", "measures": {}, "note": ""}
            page = lab.render_page([item], {}, Path(folder))
        self.assertIn("src='data:audio/ogg;base64,T2dnUy10ZXN0'", page)
        self.assertNotIn("src='a.ogg'", page)



if __name__ == "__main__":
    unittest.main()
