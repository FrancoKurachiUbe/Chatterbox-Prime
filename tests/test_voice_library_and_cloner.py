"""
Pruebas unitarias para VoiceLibrary y VoiceCloner (Etapa 4).
Utiliza un archivo WAV PCM real generado en memoria y un modelo doble controlado
para verificar create_voice_clone_prompt, caché persistente y generate_voice_clone.
"""

from __future__ import annotations

import io
import shutil
import sys
import tempfile
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.core.voice_library import VoiceLibrary
from backend.engine import voice_cloner


def _make_wav_bytes(duration_sec: float = 1.0, sample_rate: int = 24000) -> bytes:
    buf = io.BytesIO()
    n_frames = int(duration_sec * sample_rate)
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x01" * n_frames)
    return buf.getvalue()


class FakeQwen3TTSModel:
    """Doble de pruebas que registra cuántas veces se extrae el prompt y cuántas se sintetiza."""

    def __init__(self) -> None:
        self.prompt_calls = 0
        self.synth_calls = 0

    def create_voice_clone_prompt(self, ref_audio: str, ref_text: str | None, x_vector_only_mode: bool = False):
        self.prompt_calls += 1
        return {
            "ref_audio": ref_audio,
            "ref_text": ref_text,
            "x_vector_only_mode": x_vector_only_mode,
        }

    def generate_voice_clone(self, text: str, language: str, voice_clone_prompt, **kwargs):
        self.synth_calls += 1
        return [[0.0, 0.1, -0.1, 0.0]], 24000


class TestVoiceLibraryAndCloner(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="qwen3_test_voices_"))
        self.voices_dir = self.tmp_dir / "voices"
        self.cache_dir = self.tmp_dir / "prompt_cache"
        self.manifest = self.voices_dir / "voices_manifest.json"

        self.orig_cache_dir = voice_cloner.PROMPT_CACHE_DIR
        voice_cloner.PROMPT_CACHE_DIR = self.cache_dir
        voice_cloner._PROMPT_MEMORY_CACHE.clear()

        self.lib = VoiceLibrary(voices_dir=self.voices_dir, manifest_file=self.manifest)

    def tearDown(self) -> None:
        voice_cloner._PROMPT_MEMORY_CACHE.clear()
        voice_cloner.PROMPT_CACHE_DIR = self.orig_cache_dir
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_import_preserves_original_wav_and_tracks_status(self) -> None:
        raw = _make_wav_bytes(1.5, 24000)
        rec = self.lib.import_voice_bytes(
            raw_bytes=raw,
            voice_name="Brian Warm Clonacion Voz",
            ref_text="",
        )
        self.assertTrue(rec["is_default"])
        self.assertTrue(rec["exists_on_disk"])
        self.assertEqual(rec["sample_rate"], 24000)
        self.assertEqual(rec["prompt_status"], "needs_transcript")
        self.assertEqual((self.voices_dir / "Brian Warm Clonacion Voz.wav").read_bytes(), raw)

        updated = self.lib.update_voice_meta(
            "Brian Warm Clonacion Voz",
            ref_text="Esta es una grabación de prueba para clonación.",
        )
        self.assertEqual(updated["prompt_status"], "not_prepared")

    def test_prompt_caching_reused_across_segments_and_invalidated_on_edit(self) -> None:
        raw = _make_wav_bytes(1.0, 24000)
        self.lib.import_voice_bytes(
            raw_bytes=raw,
            voice_name="Brian Warm Clonacion Voz",
            ref_text="Texto de referencia exacto.",
        )
        fake_model = FakeQwen3TTSModel()
        model_id = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"

        prep1 = self.lib.prepare_voice_prompt(
            "Brian Warm Clonacion Voz",
            model_id=model_id,
            model_override=fake_model,
        )
        self.assertFalse(prep1["from_cache"])
        self.assertEqual(prep1["voice"]["prompt_status"], "ready")
        self.assertEqual(fake_model.prompt_calls, 1)

        # Simular 3 segmentos reutilizando el mismo prompt sin recalcular características
        rec = self.lib.get_voice("Brian Warm Clonacion Voz", active_model_id=model_id)
        wav_path = self.lib.get_voice_wav_path("Brian Warm Clonacion Voz")
        for idx in range(3):
            audio, sr = voice_cloner.synthesize_with_voice_clone(
                text=f"Segmento número {idx + 1}.",
                language="Spanish",
                voice_name=rec["name"],
                wav_path=wav_path,
                wav_sha256=rec["wav_sha256"],
                ref_text=rec["ref_text"],
                x_vector_only_mode=rec["x_vector_only_mode"],
                settings={"model_id": model_id, "do_sample": True, "temperature": 0.75, "seed": 737219296},
                model_override=fake_model,
            )
            self.assertEqual(sr, 24000)
            self.assertEqual(len(audio), 4)

        self.assertEqual(fake_model.prompt_calls, 1, "No debe recalcular el prompt en cada segmento")
        self.assertEqual(fake_model.synth_calls, 3)

        # Cambiar transcripción invalida el prompt anterior
        after_edit = self.lib.update_voice_meta(
            "Brian Warm Clonacion Voz",
            ref_text="Texto de referencia modificado.",
            active_model_id=model_id,
        )
        self.assertEqual(after_edit["prompt_status"], "not_prepared")


if __name__ == "__main__":
    unittest.main()
