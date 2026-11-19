"""
Gestión de proyectos independientes para Qwen3Prime.
Cada proyecto vive en su carpeta aislada `projects/<project_id>/` con su propio
`project.json`, `segments/` y `final/`, evitando colisiones o pérdida de trabajo.
"""

from __future__ import annotations

import copy
import json
import re
import shutil
import tempfile
import threading
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.config import DEFAULT_GENERATION_SETTINGS, PROJECTS_DIR
from backend.core.hashing import build_or_sync_project_sections, compute_summary_metrics
from backend.core.voice_library import VoiceLibrary

_DEFAULT_STARTER_SCRIPT = (
    "ESCENA 1 — INTRODUCCIÓN\n"
    "En el año 1453, las murallas de Constantinopla resistían uno de los asedios más decisivos de la historia.\n\n"
    "ESCENA 2 — DESARROLLO\n"
    "Durante 53 días, miles de defensores vigilaron el Cuerno de Oro mientras el Imperio Otomano desplegaba su artillería."
)


class ProjectManager:
    """Administra múltiples proyectos independientes dentro de `projects/`."""

    def __init__(
        self,
        projects_dir: Path = PROJECTS_DIR,
        voice_library: Optional[VoiceLibrary] = None,
    ) -> None:
        self.projects_dir = projects_dir
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.state_file = self.projects_dir / "workspace_state.json"
        self.voice_library = voice_library or VoiceLibrary()
        self._io_lock = threading.RLock()

    def _validate_project_id(self, project_id: str) -> str:
        clean = (project_id or "").strip()
        if not clean or not re.fullmatch(r"[a-zA-Z0-9_-]+", clean):
            raise ValueError(f"Identificador de proyecto inválido: '{project_id}'")
        return clean

    def get_project_dir(self, project_id: str) -> Path:
        clean = self._validate_project_id(project_id)
        p_dir = (self.projects_dir / clean).resolve()
        root_resolved = self.projects_dir.resolve()
        if root_resolved not in p_dir.parents:
            raise ValueError("Ruta de proyecto fuera del directorio permitido.")
        return p_dir

    def _load_workspace_state(self) -> Dict[str, Any]:
        if not self.state_file.exists():
            return {}
        try:
            data = json.loads(self.state_file.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _save_workspace_state(self, state: Dict[str, Any]) -> None:
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    def get_active_project_id(self) -> Optional[str]:
        return self._load_workspace_state().get("active_project_id")

    def set_active_project_id(self, project_id: Optional[str]) -> None:
        with self._io_lock:
            state = self._load_workspace_state()
            state["active_project_id"] = project_id
            self._save_workspace_state(state)

    def _resolve_voice_meta(self, voice_name: str, model_id: str) -> Dict[str, Any]:
        try:
            return self.voice_library.get_voice(voice_name, active_model_id=model_id)
        except KeyError:
            return {}

    def _save_project_raw(self, project_dir: Path, project_data: Dict[str, Any]) -> None:
        with self._io_lock:
            project_dir.mkdir(parents=True, exist_ok=True)
            (project_dir / "segments").mkdir(parents=True, exist_ok=True)
            (project_dir / "final").mkdir(parents=True, exist_ok=True)
            proj_file = project_dir / "project.json"
            tmp_file = project_dir / "project.json.tmp"
            tmp_file.write_text(json.dumps(project_data, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp_file.replace(proj_file)

    def save_project_data(self, project_data: Dict[str, Any]) -> None:
        p_dir = self.get_project_dir(project_data["id"])
        self._save_project_raw(p_dir, project_data)

    def ensure_initial_project(self) -> None:
        """Crea un proyecto inicial solo si el espacio de trabajo nunca ha sido inicializado."""
        with self._io_lock:
            if self.state_file.exists():
                return
            existing = [
                d for d in self.projects_dir.iterdir()
                if d.is_dir() and (d / "project.json").exists()
            ]
            if existing:
                self.set_active_project_id(existing[0].name)
                return
            self.create_project(
                name="Proyecto Inicial — Qwen3Prime",
                script_text=_DEFAULT_STARTER_SCRIPT,
                processing_mode="scene",
            )

    def _reconcile_project(self, project_data: Dict[str, Any]) -> Dict[str, Any]:
        p_dir = self.get_project_dir(project_data["id"])
        settings = {**copy.deepcopy(DEFAULT_GENERATION_SETTINGS), **(project_data.get("settings") or {})}
        project_data["settings"] = settings
        voice_meta = self._resolve_voice_meta(settings.get("voice_name", ""), settings.get("model_id", ""))
        sync = build_or_sync_project_sections(
            project_id=project_data["id"],
            script_text=project_data.get("script_text", ""),
            processing_mode=project_data.get("processing_mode", "scene"),
            settings=settings,
            project_dir=p_dir,
            existing_sections=project_data.get("sections", []),
            voice_meta=voice_meta,
            existing_master_filename=project_data.get("master_filename"),
        )
        project_data["sections"] = sync["sections"]
        project_data["master_filename"] = sync["master_filename"]
        project_data["master_audio_url"] = sync["master_audio_url"]
        return {"project": project_data, "summary": sync["summary"]}

    def create_project(
        self,
        *,
        name: str,
        script_text: str = "",
        processing_mode: str = "scene",
        settings: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        clean_name = (name or "").strip() or "Nuevo Proyecto"
        mode = "paragraph" if processing_mode == "paragraph" else "scene"
        now = int(time.time())
        project_id = f"proj_{now}_{uuid.uuid4().hex[:6]}"
        p_dir = self.get_project_dir(project_id)

        merged_settings = {**copy.deepcopy(DEFAULT_GENERATION_SETTINGS), **(settings or {})}
        project_data: Dict[str, Any] = {
            "id": project_id,
            "name": clean_name,
            "script_text": script_text,
            "processing_mode": mode,
            "settings": merged_settings,
            "sections": [],
            "master_filename": None,
            "master_audio_url": None,
            "created_at": now,
            "updated_at": now,
        }
        res = self._reconcile_project(project_data)
        self._save_project_raw(p_dir, res["project"])
        self.set_active_project_id(project_id)
        return res

    def get_project(self, project_id: str, *, set_active: bool = True) -> Dict[str, Any]:
        p_dir = self.get_project_dir(project_id)
        proj_file = p_dir / "project.json"
        if not proj_file.exists():
            raise FileNotFoundError(f"Proyecto no encontrado: {project_id}")

        with self._io_lock:
            project_data = json.loads(proj_file.read_text(encoding="utf-8"))
            res = self._reconcile_project(project_data)
            self._save_project_raw(p_dir, res["project"])
            if set_active:
                self.set_active_project_id(project_id)
            return res

    def save_project(
        self,
        project_id: str,
        *,
        name: Optional[str] = None,
        script_text: Optional[str] = None,
        processing_mode: Optional[str] = None,
        settings: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        p_dir = self.get_project_dir(project_id)
        proj_file = p_dir / "project.json"
        if not proj_file.exists():
            raise FileNotFoundError(f"Proyecto no encontrado: {project_id}")

        with self._io_lock:
            project_data = json.loads(proj_file.read_text(encoding="utf-8"))
            if name is not None and name.strip():
                project_data["name"] = name.strip()
            if script_text is not None:
                project_data["script_text"] = script_text
            if processing_mode in ("scene", "paragraph"):
                project_data["processing_mode"] = processing_mode
            if settings is not None:
                project_data["settings"] = {
                    **copy.deepcopy(DEFAULT_GENERATION_SETTINGS),
                    **project_data.get("settings", {}),
                    **settings,
                }
            project_data["updated_at"] = int(time.time())
            res = self._reconcile_project(project_data)
            self._save_project_raw(p_dir, res["project"])
            return res

    def rename_project(self, project_id: str, new_name: str) -> Dict[str, Any]:
        clean = (new_name or "").strip()
        if not clean:
            raise ValueError("El nombre del proyecto no puede estar vacío.")
        res = self.save_project(project_id, name=clean)
        return {"project": res["project"]}

    def delete_project(self, project_id: str) -> None:
        p_dir = self.get_project_dir(project_id)
        with self._io_lock:
            if not p_dir.exists():
                raise FileNotFoundError(f"Proyecto no encontrado: {project_id}")
            shutil.rmtree(p_dir)
            if self.get_active_project_id() == project_id:
                remaining = self.list_projects(ensure_init=False)["projects"]
                next_id = remaining[0]["id"] if remaining else None
                self.set_active_project_id(next_id)

    def list_projects(self, *, ensure_init: bool = True) -> Dict[str, Any]:
        if ensure_init:
            self.ensure_initial_project()

        items: List[Dict[str, Any]] = []
        for entry in self.projects_dir.iterdir():
            if not entry.is_dir():
                continue
            proj_file = entry / "project.json"
            if not proj_file.exists():
                continue
            try:
                data = json.loads(proj_file.read_text(encoding="utf-8"))
                sections = data.get("sections", [])
                mode = data.get("processing_mode", "scene")
                summary = compute_summary_metrics(sections, mode)
                settings = data.get("settings", {})
                master_file = data.get("master_filename")
                has_master = bool(
                    master_file
                    and (entry / "final" / master_file).exists()
                    and (entry / "final" / master_file).stat().st_size > 44
                )
                items.append({
                    "id": data["id"],
                    "name": data.get("name", entry.name),
                    "processing_mode": mode,
                    "voice_name": settings.get("voice_name", ""),
                    "model_id": settings.get("model_id", ""),
                    "total_sections": summary["total_sections"],
                    "total_parts": summary["total_parts"],
                    "ready_parts": summary["ready_parts"],
                    "percent": summary["percent"],
                    "has_master": has_master,
                    "created_at": data.get("created_at", 0),
                    "updated_at": data.get("updated_at", 0),
                })
            except Exception:
                continue

        items.sort(key=lambda x: x.get("updated_at", 0), reverse=True)
        active_id = self.get_active_project_id()
        if active_id and not any(it["id"] == active_id for it in items):
            active_id = items[0]["id"] if items else None
            self.set_active_project_id(active_id)

        return {"projects": items, "active_project_id": active_id}

    def resolve_project_audio_path(self, project_id: str, folder: str, filename: str) -> Path:
        if folder not in ("segments", "final"):
            raise ValueError("Carpeta de audio no permitida.")
        p_dir = self.get_project_dir(project_id)
        safe_file = Path(filename).name
        target = (p_dir / folder / safe_file).resolve()
        allowed_parent = (p_dir / folder).resolve()
        if allowed_parent not in target.parents or not target.exists() or not target.is_file():
            raise FileNotFoundError(f"Audio no encontrado: {safe_file}")
        return target

    def export_project_zip(self, project_id: str, dest_zip: Optional[Path] = None) -> Path:
        from backend.core.production_runner import join_master_audio, join_section_audio

        res = self.get_project(project_id, set_active=False)
        project_data = res["project"]
        p_dir = self.get_project_dir(project_id)

        # Garantizar que todas las escenas/párrafos completos tengan su WAV ensamblado y actualizado
        any_ready_section = False
        latest_final_mtime = 0.0
        for sec in project_data.get("sections", []):
            parts = sec.get("parts", [])
            if parts and all(p.get("status") == "ready" for p in parts):
                any_ready_section = True
                joined_name = sec.get("joined_filename")
                final_wav = (p_dir / "final" / joined_name) if joined_name else None
                needs_join = (
                    final_wav is None
                    or not final_wav.exists()
                    or final_wav.stat().st_size <= 44
                )
                if not needs_join and final_wav is not None:
                    final_mtime = final_wav.stat().st_mtime
                    for p in parts:
                        seg_wav = p_dir / "segments" / p["filename"]
                        if seg_wav.exists() and seg_wav.stat().st_mtime > final_mtime:
                            needs_join = True
                            break
                if needs_join:
                    try:
                        join_section_audio(
                            project_dir=p_dir,
                            project_data=project_data,
                            section_number=int(sec["number"]),
                            save_project_fn=self.save_project_data,
                        )
                    except Exception:
                        pass
                if final_wav is not None and final_wav.exists():
                    latest_final_mtime = max(latest_final_mtime, final_wav.stat().st_mtime)

        # Garantizar Master actualizado si existen escenas/partes listas
        has_any_ready = any_ready_section or any(
            p.get("status") == "ready"
            for sec in project_data.get("sections", [])
            for p in sec.get("parts", [])
        )
        if has_any_ready:
            master_wav = p_dir / "final" / "master_narracion.wav"
            needs_master = (
                not master_wav.exists()
                or master_wav.stat().st_size <= 44
                or (latest_final_mtime > 0 and master_wav.stat().st_mtime < latest_final_mtime)
            )
            if needs_master:
                try:
                    join_master_audio(
                        project_dir=p_dir,
                        project_data=project_data,
                        save_project_fn=self.save_project_data,
                    )
                except Exception:
                    pass

        if dest_zip is None:
            safe_slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", project_data["name"]).strip("_") or project_id
            tmp_dir = Path(tempfile.mkdtemp(prefix="qwen3prime_export_"))
            dest_zip = tmp_dir / f"{safe_slug}.zip"

        with zipfile.ZipFile(dest_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            proj_json = p_dir / "project.json"
            if proj_json.exists():
                zf.write(proj_json, arcname="project.json")
            zf.writestr("guion.txt", project_data.get("script_text", ""))

            # Exportar únicamente escenas/párrafos completos ensamblados + Master WAV (sin sub-partes sueltas)
            final_dir = p_dir / "final"
            if final_dir.exists():
                for wav in sorted(final_dir.glob("*.wav")):
                    zf.write(wav, arcname=f"escenas/{wav.name}")

        return dest_zip
