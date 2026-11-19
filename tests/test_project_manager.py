import math
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

STUDIO_ROOT = Path(__file__).resolve().parent.parent
if str(STUDIO_ROOT) not in sys.path:
    sys.path.insert(0, str(STUDIO_ROOT))

from backend.core.production_runner import execute_production_job, join_master_audio, select_target_parts
from backend.core.project_manager import ProjectManager
from backend.core.voice_library import VoiceLibrary


def _make_wav_bytes(sr: int = 16000, dur: float = 0.2) -> bytes:
    import io
    import struct
    import wave

    buf = io.BytesIO()
    n = int(sr * dur)
    frames = bytearray()
    for i in range(n):
        frames.extend(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 240 * i / sr))))
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(bytes(frames))
    return buf.getvalue()


class TestProjectManager(unittest.TestCase):
    def _make_managers(self, root: Path):
        vlib = VoiceLibrary(voices_dir=root / "voices", manifest_file=root / "voices" / "voices_manifest.json")
        vlib.import_voice_bytes(
            raw_bytes=_make_wav_bytes(),
            voice_name="Brian Warm Clonacion Voz",
            ref_text="Referencia de prueba.",
        )
        pm = ProjectManager(projects_dir=root / "projects", voice_library=vlib)
        return pm, vlib

    def test_independent_multi_project_lifecycle_isolation_and_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            pm, vlib = self._make_managers(Path(tmp))

            # Inicialización crea 1 proyecto base
            listed = pm.list_projects()
            self.assertEqual(len(listed["projects"]), 1)
            p_init_id = listed["active_project_id"]
            self.assertIsNotNone(p_init_id)

            # Crear dos proyectos independientes
            p1 = pm.create_project(
                name="Roma Ep 1",
                script_text="ESCENA 1 — CAÍDA\nEl año 476 marcó un cambio de era.",
                processing_mode="scene",
            )["project"]
            p2 = pm.create_project(
                name="Grecia Ep 2",
                script_text="Primer párrafo autónomo.\n\nSegundo párrafo independiente.",
                processing_mode="paragraph",
            )["project"]

            self.assertNotEqual(p1["id"], p2["id"])
            self.assertTrue((pm.get_project_dir(p1["id"]) / "project.json").exists())
            self.assertTrue((pm.get_project_dir(p2["id"]) / "project.json").exists())

            # Producir audio solo en p1 y crear master WAV
            p1_dir = pm.get_project_dir(p1["id"])
            targets = select_target_parts(p1, mode="pending_only")
            execute_production_job(
                project_dir=p1_dir,
                project_data=p1,
                voice_library=vlib,
                targets=targets,
                save_project_fn=pm.save_project_data,
                synthesizer_fn=lambda **kw: ([0.1] * 3200, 16000),
            )
            join_master_audio(
                project_dir=p1_dir,
                project_data=p1,
                save_project_fn=pm.save_project_data,
            )

            # Renombrar p1 sin alterar p2
            renamed = pm.rename_project(p1["id"], "Roma Ep 1 — Edición Final")["project"]
            self.assertEqual(renamed["name"], "Roma Ep 1 — Edición Final")
            p2_loaded = pm.get_project(p2["id"])["project"]
            self.assertEqual(p2_loaded["name"], "Grecia Ep 2")
            self.assertEqual(p2_loaded["processing_mode"], "paragraph")

            # Exportar ZIP de p1 incluye project.json, guion.txt, escenas completas y master (SIN sub-partes sueltas)
            zip_path = pm.export_project_zip(p1["id"])
            try:
                self.assertTrue(zip_path.exists())
                with zipfile.ZipFile(zip_path, "r") as zf:
                    names = zf.namelist()
                    self.assertIn("project.json", names)
                    self.assertIn("guion.txt", names)
                    self.assertIn("escenas/escena_001_completa.wav", names)
                    self.assertIn("escenas/master_narracion.wav", names)
                    self.assertFalse(any(n.startswith("segments/") for n in names))
            finally:
                if zip_path.exists():
                    zip_path.unlink()

            # Eliminar p2 no afecta a p1 ni al proyecto inicial
            pm.delete_project(p2["id"])
            after = pm.list_projects(ensure_init=False)["projects"]
            ids_left = {item["id"] for item in after}
            self.assertIn(p1["id"], ids_left)
            self.assertNotIn(p2["id"], ids_left)

            # Bloqueo de path traversal
            with self.assertRaises(ValueError):
                pm.get_project_dir("../escape")

            # Resolución segura de ruta de audio
            master_resolved = pm.resolve_project_audio_path(p1["id"], "final", "master_narracion.wav")
            self.assertTrue(master_resolved.exists())


if __name__ == "__main__":
    unittest.main()
