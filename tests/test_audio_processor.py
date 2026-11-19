"""Pruebas unitarias para procesador WAV, recorte de silencios y concatenación con pausas (Etapa 5)."""

from __future__ import annotations

import math
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.engine.audio_processor import (
    concatenate_wav_files,
    get_wav_duration,
    load_wav_mono,
    prepare_clean_reference_wav,
    save_wav,
    trim_leading_echo_artifact,
    trim_trailing_silence,
)


class TestAudioProcessor(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="qwen3_test_audio_"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_trim_trailing_silence_keeps_speech_and_trims_long_tail(self) -> None:
        sr = 24000
        speech = [0.4 * math.sin(2 * math.pi * 220 * i / sr) for i in range(sr)]  # 1.0s de voz
        long_silence = [0.0] * (sr * 6)  # 6.0s de silencio muerto artificial
        trimmed = trim_trailing_silence(speech + long_silence, sr, threshold_db=-42.0, tail_pad_ms=150)
        dur = len(trimmed) / float(sr)
        self.assertGreaterEqual(dur, 1.0)
        self.assertLess(dur, 1.35)

    def test_trim_leading_echo_artifact_removes_aba_burst_and_preserves_continuous_speech(self) -> None:
        sr = 24000
        # Caso 1: micro-sílaba inicial ("aba", ~0.18s) + silencio (~0.24s) + narración principal (~1.0s)
        artifact = [0.35 * math.sin(2 * math.pi * 300 * i / sr) for i in range(int(sr * 0.18))]
        gap = [0.0] * int(sr * 0.24)
        main_speech = [0.4 * math.sin(2 * math.pi * 200 * i / sr) for i in range(sr)]
        cleaned = trim_leading_echo_artifact(artifact + gap + main_speech, sr)
        dur = len(cleaned) / float(sr)
        # Debe conservar la locución principal (~1.0s + pequeño lead_pad <= 0.05s) sin la ráfaga inicial
        self.assertGreaterEqual(dur, 0.98)
        self.assertLess(dur, 1.15)

        # Caso 2: artefacto bisílabo tipo "saba" (~0.70s con caída consonántica interna de 50ms) + pausa con ruido tenue (-34dB)
        lead_sil = [0.0] * int(sr * 0.12)
        sa = [0.22 * math.sin(2 * math.pi * 440 * i / sr) for i in range(int(sr * 0.25))]
        b_dip = [0.002] * int(sr * 0.05)  # cierre /b/ de 50ms
        ba = [0.32 * math.sin(2 * math.pi * 260 * i / sr) for i in range(int(sr * 0.38))]
        pause_with_hum = [0.018 * math.sin(2 * math.pi * 60 * i / sr) for i in range(int(sr * 0.22))]
        narration = [0.35 * math.sin(2 * math.pi * 210 * i / sr) for i in range(int(sr * 1.2))]
        cleaned_saba = trim_leading_echo_artifact(
            lead_sil + sa + b_dip + ba + pause_with_hum + narration, sr
        )
        dur_saba = len(cleaned_saba) / float(sr)
        self.assertGreaterEqual(dur_saba, 1.18)
        self.assertLess(dur_saba, 1.32)

        # Caso 3: habla continua desde el inicio sin hueco -> no debe recortar nada
        continuous = [0.4 * math.sin(2 * math.pi * 220 * i / sr) for i in range(int(sr * 1.4))]
        kept = trim_leading_echo_artifact(continuous, sr)
        self.assertEqual(len(kept), len(continuous))

    def test_prepare_clean_reference_wav_keeps_original_intact_and_adds_clean_padding(self) -> None:
        sr = 24000
        src = self.tmp_dir / "original_voice.wav"
        dst = self.tmp_dir / "clean_voice.wav"
        dirty_pad = [0.002] * int(sr * 0.1)
        voice = [0.35 * math.sin(2 * math.pi * 190 * i / sr) for i in range(int(sr * 1.0))]
        save_wav(dirty_pad + voice + dirty_pad, sr, src)
        orig_bytes = src.read_bytes()

        prepare_clean_reference_wav(src, dst)
        self.assertTrue(dst.exists())
        self.assertEqual(src.read_bytes(), orig_bytes)  # Original intacto
        clean_samples, clean_sr = load_wav_mono(dst)
        self.assertEqual(clean_sr, sr)
        # Últimos 200ms deben ser silencio limpio exacto (0.0)
        tail = clean_samples[-int(sr * 0.2):]
        self.assertTrue(all(abs(x) < 1e-5 for x in tail))

    def test_save_and_concatenate_preserves_sample_rate_and_pauses(self) -> None:
        sr = 24000
        p1 = self.tmp_dir / "p1.wav"
        p2 = self.tmp_dir / "p2.wav"
        out = self.tmp_dir / "joined.wav"

        tone1 = [0.25 * math.sin(2 * math.pi * 200 * i / sr) for i in range(int(sr * 0.5))]
        tone2 = [0.25 * math.sin(2 * math.pi * 300 * i / sr) for i in range(int(sr * 0.5))]
        save_wav(tone1, sr, p1)
        save_wav(tone2, sr, p2)

        _, joined_dur = concatenate_wav_files([(p1, 500), (p2, 0)], out)
        self.assertTrue(out.exists())
        samples, out_sr = load_wav_mono(out)
        self.assertEqual(out_sr, sr)
        self.assertAlmostEqual(joined_dur, 1.5, places=2)
        self.assertAlmostEqual(get_wav_duration(out), 1.5, places=2)
        self.assertEqual(len(samples), int(sr * 1.5))


if __name__ == "__main__":
    unittest.main()
