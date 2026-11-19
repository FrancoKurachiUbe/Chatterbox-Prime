import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

STUDIO_ROOT = Path(__file__).resolve().parent.parent
if str(STUDIO_ROOT) not in sys.path:
    sys.path.insert(0, str(STUDIO_ROOT))

from backend.config import DEFAULT_GENERATION_SETTINGS
from backend.core.hashing import build_or_sync_project_sections
from backend.core.production_runner import (
    execute_production_job,
    join_master_audio,
    join_section_audio,
    request_cancel_production,
    select_target_parts,
)
from backend.core.voice_library import VoiceLibrary
from backend.engine.audio_processor import get_wav_duration


def _make_dummy_wav_bytes(sr: int = 16000, duration_s: float = 0.25) -> bytes:
    import struct
    import wave
    import io

    buf = io.BytesIO()
    n = int(sr * duration_s)
    frames = bytearray()
    for i in range(n):
        v = int(8000 * math.sin(2 * math.pi * 220 * i / sr))
        frames.extend(struct.pack("<h", v))
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(bytes(frames))
    return buf.getvalue()


def _synthetic_tts_ok(duration_s: float = 0.2, sr: int = 16000):
    n = int(sr * duration_s)
    tone = [0.25 * math.sin(2 * math.pi * 330 * i / sr) for i in range(n)]

    def _synth(**kwargs):
        return list(tone), sr

    return _synth


class TestHashingRecoveryAndRunner(unittest.TestCase):
    def _setup_workspace(self, tmp_dir: Path):
        voices_dir = tmp_dir / "voices"
        manifest_file = voices_dir / "voices_manifest.json"
        vlib = VoiceLibrary(voices_dir=voices_dir, manifest_file=manifest_file)
        vlib.import_voice_bytes(
            raw_bytes=_make_dummy_wav_bytes(),
            voice_name="Brian Warm Clonacion Voz",
            ref_text="Prueba de voz principal.",
        )

        proj_dir = tmp_dir / "projects" / "proj_test"
        proj_dir.mkdir(parents=True, exist_ok=True)
        return vlib, proj_dir

    def test_hash_invalidation_detects_stale_audio_when_text_or_settings_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            vlib, proj_dir = self._setup_workspace(Path(tmp))
            settings = dict(DEFAULT_GENERATION_SETTINGS)
            settings["voice_name"] = "Brian Warm Clonacion Voz"
            settings["max_chars"] = 120
            voice_meta = vlib.get_voice("Brian Warm Clonacion Voz", active_model_id=settings["model_id"])

            script_v1 = (
                "ESCENA 1 — INTRODUCCIÓN\n"
                "En 1914 comenzó una guerra sin precedentes.\n\n"
                "ESCENA 2 — DESARROLLO\n"
                "Las alianzas europeas cambiaron el destino del continente."
            )
            sync1 = build_or_sync_project_sections(
                project_id="proj_test",
                script_text=script_v1,
                processing_mode="scene",
                settings=settings,
                project_dir=proj_dir,
                voice_meta=voice_meta,
            )
            project_data = {
                "id": "proj_test",
                "name": "Test",
                "script_text": script_v1,
                "processing_mode": "scene",
                "settings": settings,
                "sections": sync1["sections"],
                "updated_at": 0,
            }

            saved_snapshots = []

            def _save(data):
                saved_snapshots.append(json.loads(json.dumps(data)))

            targets = select_target_parts(project_data, mode="pending_only")
            self.assertEqual(targets, [(1, 1), (2, 1)])

            res = execute_production_job(
                project_dir=proj_dir,
                project_data=project_data,
                voice_library=vlib,
                targets=targets,
                save_project_fn=_save,
                synthesizer_fn=_synthetic_tts_ok(0.2),
            )
            self.assertEqual(res["completed"], 2)
            self.assertGreaterEqual(len(saved_snapshots), 2)  # Guardado incremental + auto-ensamblado completo
            self.assertTrue(project_data["sections"][0]["has_joined"])
            self.assertTrue((proj_dir / "final" / project_data["sections"][0]["joined_filename"]).exists())

            # Reconciliación sin cambios -> ambas siguen 'ready'
            sync_same = build_or_sync_project_sections(
                project_id="proj_test",
                script_text=script_v1,
                processing_mode="scene",
                settings=settings,
                project_dir=proj_dir,
                existing_sections=project_data["sections"],
                voice_meta=voice_meta,
            )
            self.assertEqual(sync_same["summary"]["ready_parts"], 2)

            # Editar SOLO el texto de la Escena 2 -> Parte 1 sigue 'ready', Parte 2 pasa a 'stale' aunque el WAV exista
            script_v2 = (
                "ESCENA 1 — INTRODUCCIÓN\n"
                "En 1914 comenzó una guerra sin precedentes.\n\n"
                "ESCENA 2 — DESARROLLO\n"
                "Las nuevas alianzas europeas transformaron por completo el destino del continente."
            )
            sync_edited = build_or_sync_project_sections(
                project_id="proj_test",
                script_text=script_v2,
                processing_mode="scene",
                settings=settings,
                project_dir=proj_dir,
                existing_sections=project_data["sections"],
                voice_meta=voice_meta,
            )
            self.assertEqual(sync_edited["sections"][0]["parts"][0]["status"], "ready")
            self.assertEqual(sync_edited["sections"][1]["parts"][0]["status"], "stale")
            self.assertTrue(sync_edited["sections"][1]["parts"][0]["has_audio"])

            # Cambiar modelo -> todas pasan a 'stale'
            settings_06b = {**settings, "model_id": "Qwen/Qwen3-TTS-12Hz-0.6B-Base"}
            sync_model = build_or_sync_project_sections(
                project_id="proj_test",
                script_text=script_v1,
                processing_mode="scene",
                settings=settings_06b,
                project_dir=proj_dir,
                existing_sections=project_data["sections"],
                voice_meta=voice_meta,
            )
            self.assertEqual(sync_model["summary"]["stale_parts"], 2)
            self.assertEqual(sync_model["summary"]["ready_parts"], 0)

    def test_interrupted_recovery_retry_failed_and_wav_assembly(self):
        with tempfile.TemporaryDirectory() as tmp:
            vlib, proj_dir = self._setup_workspace(Path(tmp))
            settings = dict(DEFAULT_GENERATION_SETTINGS)
            settings["voice_name"] = "Brian Warm Clonacion Voz"
            settings["max_chars"] = 90
            settings["part_pause_ms"] = 100
            settings["section_pause_ms"] = 250
            settings["trim_silence"] = False
            voice_meta = vlib.get_voice("Brian Warm Clonacion Voz", active_model_id=settings["model_id"])

            script = (
                "ESCENA 1 — INICIO\n"
                "Primera frase de la escena uno con suficiente detalle narrativo. "
                "Segunda frase bastante larga para dividir claramente en otra parte distinta.\n\n"
                "ESCENA 2 — CIERRE\n"
                "Tercera frase final de la narración."
            )
            sync = build_or_sync_project_sections(
                project_id="proj_test",
                script_text=script,
                processing_mode="scene",
                settings=settings,
                project_dir=proj_dir,
                voice_meta=voice_meta,
            )
            project_data = {
                "id": "proj_test",
                "name": "Recuperación",
                "script_text": script,
                "processing_mode": "scene",
                "settings": settings,
                "sections": sync["sections"],
                "updated_at": 0,
            }
            saved_file = proj_dir / "project.json"

            def _save(data):
                saved_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

            # Simular fallo en llamada #2 y cancelación tras la #2 (dejando la #3 pendiente)
            call_count = {"n": 0}
            ok_fn = _synthetic_tts_ok(0.2)

            def _flaky_tts(**kwargs):
                call_count["n"] += 1
                if call_count["n"] == 2:
                    request_cancel_production()
                    raise RuntimeError("Fallo temporal simulado")
                return ok_fn(**kwargs)

            targets = select_target_parts(project_data, mode="pending_only")
            self.assertGreaterEqual(len(targets), 3)

            res1 = execute_production_job(
                project_dir=proj_dir,
                project_data=project_data,
                voice_library=vlib,
                targets=targets,
                save_project_fn=_save,
                synthesizer_fn=_flaky_tts,
            )
            self.assertEqual(res1["completed"], 1)
            self.assertEqual(res1["failed"], 1)
            self.assertTrue(res1["cancelled"])

            # Reanudar desde pendientes (debe omitir parte 1 lista y parte 2 fallida, haciendo la 3)
            pending_targets = select_target_parts(project_data, mode="pending_only")
            self.assertEqual(pending_targets, [(2, 1)])
            res2 = execute_production_job(
                project_dir=proj_dir,
                project_data=project_data,
                voice_library=vlib,
                targets=pending_targets,
                save_project_fn=_save,
                synthesizer_fn=ok_fn,
            )
            self.assertEqual(res2["completed"], 1)

            # Reintentar fallidas (debe ejecutar solo la (1, 2))
            failed_targets = select_target_parts(project_data, mode="retry_failed")
            self.assertEqual(failed_targets, [(1, 2)])
            res3 = execute_production_job(
                project_dir=proj_dir,
                project_data=project_data,
                voice_library=vlib,
                targets=failed_targets,
                save_project_fn=_save,
                synthesizer_fn=ok_fn,
            )
            self.assertEqual(res3["completed"], 1)

            # Ensamblar Escena 1 (2 partes de 0.2s + 100ms pausa = 0.5s)
            sec_out = join_section_audio(
                project_dir=proj_dir,
                project_data=project_data,
                section_number=1,
                save_project_fn=_save,
            )
            self.assertAlmostEqual(sec_out["duration_sec"], 0.5, delta=0.03)
            self.assertTrue((proj_dir / "final" / sec_out["filename"]).exists())

            # Ensamblar Master (0.2 + 0.1 + 0.2 + 0.25 + 0.2 = 0.95s)
            master_out = join_master_audio(
                project_dir=proj_dir,
                project_data=project_data,
                save_project_fn=_save,
            )
            self.assertAlmostEqual(master_out["duration_sec"], 0.95, delta=0.04)
            master_wav = proj_dir / "final" / master_out["filename"]
            self.assertTrue(master_wav.exists())
            self.assertGreater(get_wav_duration(master_wav), 0.9)


if __name__ == "__main__":
    unittest.main()
