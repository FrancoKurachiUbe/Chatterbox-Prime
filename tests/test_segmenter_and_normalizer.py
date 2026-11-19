"""Pruebas unitarias para normalizador fonético en español y segmentador (Etapa 5)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.core.segmenter import (
    parse_paragraphs_from_script,
    parse_scenes_from_script,
    segment_script,
    split_text_for_tts,
)
from backend.core.text_normalizer import normalize_numbers_for_tts, number_to_spanish


class TestSpanishNormalizer(unittest.TestCase):
    def test_numbers_and_hundreds_grammar(self) -> None:
        self.assertEqual(number_to_spanish(0), "cero")
        self.assertEqual(number_to_spanish(100), "cien")
        self.assertEqual(number_to_spanish(104), "ciento cuatro")
        self.assertEqual(number_to_spanish(500), "quinientos")
        self.assertEqual(number_to_spanish(1492), "mil cuatrocientos noventa y dos")
        self.assertEqual(number_to_spanish(1_000_000), "un millón")

    def test_normalize_preserves_other_languages_and_formats_spanish(self) -> None:
        src = "En 1492 viajaron 90 marineros con un 12.5% de probabilidad."
        norm_es = normalize_numbers_for_tts(src, "Spanish")
        self.assertIn("mil cuatrocientos noventa y dos", norm_es)
        self.assertIn("noventa", norm_es)
        self.assertIn("doce punto cinco por ciento", norm_es)

        norm_en = normalize_numbers_for_tts("In 1492 there were 90 ships.", "English")
        self.assertEqual(norm_en, "In 1492 there were 90 ships.")


class TestSegmenter(unittest.TestCase):
    def test_scene_mode_headers_and_order(self) -> None:
        script = (
            "ESCENA 1 — INTRODUCCIÓN\n"
            "Primera oración de apertura. Segunda oración corta.\n\n"
            "ESCENA 2 — DESARROLLO\n"
            "El relato continúa en el año 1914 con hechos documentados.\n\n"
            "ESCENA 3 — CONCLUSIÓN\n"
            "Cierre final."
        )
        scenes = parse_scenes_from_script(script)
        self.assertEqual(len(scenes), 3)
        self.assertEqual(scenes[0]["title"], "INTRODUCCIÓN")
        self.assertEqual(scenes[1]["title"], "DESARROLLO")
        self.assertEqual(scenes[2]["title"], "CONCLUSIÓN")

    def test_paragraph_mode(self) -> None:
        script = "Párrafo uno.\n\nPárrafo dos con más texto.\n\nPárrafo tres."
        paras = parse_paragraphs_from_script(script)
        self.assertEqual(len(paras), 3)
        self.assertEqual([p["number"] for p in paras], [1, 2, 3])

    def test_configurable_max_chars_never_splits_words(self) -> None:
        long_text = (
            "Esta es la primera oración completa del documental histórico. "
            "Esta segunda oración narra los acontecimientos del siglo diecinueve con detalle. "
            "Y esta tercera oración concluye el bloque narrativo sin interrupciones."
        )
        chunks_120 = split_text_for_tts(long_text, max_chars=120)
        chunks_250 = split_text_for_tts(long_text, max_chars=250)
        self.assertGreater(len(chunks_120), len(chunks_250))
        for ch in chunks_120:
            self.assertLessEqual(len(ch), 120)
        rejoined = " ".join(chunks_120)
        self.assertEqual(rejoined, long_text)

    def test_segment_script_aligns_raw_and_normalized_parts(self) -> None:
        script = "ESCENA 1 — PRUEBA\nEn 1492 todo cambió. En 2026 recordamos el viaje."
        sections = segment_script(script, processing_mode="scene", language="Spanish", max_chars=250)
        self.assertEqual(len(sections), 1)
        part = sections[0]["parts"][0]
        self.assertIn("1492", part["text"])
        self.assertIn("mil cuatrocientos noventa y dos", part["normalized_text"])


if __name__ == "__main__":
    unittest.main()
