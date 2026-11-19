"""
Rutas REST completas para Qwen3Prime.
Incluye estado del sistema/hardware, control del modelo Qwen3-TTS, Biblioteca de Voces,
Proyectos independientes, producción secuencial, regeneración y exportación.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from backend.config import (
    APP_NAME,
    APP_VERSION,
    DEFAULT_GENERATION_SETTINGS,
    DEFAULT_MODEL_ID,
    PREFERRED_VOICE,
    QWEN_MODELS,
    QWEN_SUPPORTED_LANGUAGES,
    VOICES_DIR,
    get_hardware_info,
)
from backend.core.production_runner import (
    PRODUCTION_LOCK,
    execute_production_job,
    get_production_state,
    join_master_audio,
    join_section_audio,
    request_cancel_production,
    select_target_parts,
    start_production_background,
)
from backend.core.project_manager import ProjectManager
from backend.core.voice_library import VoiceLibrary
from backend.engine.qwen_engine import get_model_status, get_or_load_model, unload_model

router = APIRouter(prefix="/api")
voice_library = VoiceLibrary()
project_manager = ProjectManager(voice_library=voice_library)


class ModelLoadRequest(BaseModel):
    model_id: str = DEFAULT_MODEL_ID
    device: str = "auto"


class VoiceUpdateRequest(BaseModel):
    new_name: Optional[str] = None
    ref_text: Optional[str] = None
    x_vector_only_mode: Optional[bool] = None


class VoicePrepareRequest(BaseModel):
    model_id: str = DEFAULT_MODEL_ID
    device: str = "auto"
    force_rebuild: bool = False


class ProjectCreateRequest(BaseModel):
    name: str
    script_text: str = ""
    processing_mode: str = "scene"
    settings: Optional[Dict[str, Any]] = None


class ProjectSaveRequest(BaseModel):
    name: Optional[str] = None
    script_text: Optional[str] = None
    processing_mode: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None


class ProjectRenameRequest(BaseModel):
    name: str


class ProduceRequest(BaseModel):
    mode: str = "pending_only"  # pending_only | retry_failed | all
    section_number: Optional[int] = None


class RegeneratePartRequest(BaseModel):
    section_number: int
    part_number: int


class RegenerateBatchRequest(BaseModel):
    items: List[Tuple[int, int]]


class JoinSectionRequest(BaseModel):
    section_number: int


# -----------------------------------------------------------------------------
# SISTEMA, HARDWARE Y MODELO QWEN3-TTS
# -----------------------------------------------------------------------------


@router.get("/status")
def api_status():
    return {
        "status": "online",
        "app_name": APP_NAME,
        "version": APP_VERSION,
        "hardware": get_hardware_info(),
        "model": get_model_status(),
        "production": get_production_state(),
    }


@router.get("/hardware")
def api_hardware():
    return get_hardware_info()


@router.get("/config/defaults")
def api_defaults():
    return {
        "models": list(QWEN_MODELS.values()),
        "languages": QWEN_SUPPORTED_LANGUAGES,
        "default_settings": DEFAULT_GENERATION_SETTINGS,
    }


@router.post("/model/load")
def api_load_model(payload: ModelLoadRequest):
    try:
        get_or_load_model(model_id=payload.model_id, requested_device=payload.device)
        st = get_model_status()
        return {"status": "ok", "message": st["status_text"], "model": st}
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/model/unload")
def api_unload_model():
    return unload_model()


# -----------------------------------------------------------------------------
# BIBLIOTECA DE VOCES Y CLONACIÓN QWEN3
# -----------------------------------------------------------------------------


@router.get("/voices")
def api_list_voices(model_id: str = DEFAULT_MODEL_ID):
    voices = voice_library.list_voices(active_model_id=model_id)
    return {"voices": voices, "default_voice": PREFERRED_VOICE}


@router.post("/voices/upload")
async def api_upload_voice(
    file: UploadFile = File(...),
    name: str = Form(""),
    ref_text: str = Form(""),
    x_vector_only_mode: bool = Form(False),
):
    try:
        raw_bytes = await file.read()
        chosen_name = name.strip() or Path(file.filename or "Nueva_Voz").stem
        voice_library.import_voice_bytes(
            raw_bytes=raw_bytes,
            voice_name=chosen_name,
            ref_text=ref_text,
            x_vector_only_mode=x_vector_only_mode,
        )
        return {"voices": voice_library.list_voices()}
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.patch("/voices/{voice_name}")
def api_update_voice(voice_name: str, payload: VoiceUpdateRequest):
    try:
        updated = voice_library.update_voice_meta(
            voice_name,
            new_name=payload.new_name,
            ref_text=payload.ref_text,
            x_vector_only_mode=payload.x_vector_only_mode,
        )
        return {"voice": updated}
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/voices/{voice_name}/prepare")
def api_prepare_voice(voice_name: str, payload: VoicePrepareRequest):
    try:
        return voice_library.prepare_voice_prompt(
            voice_name,
            model_id=payload.model_id,
            device=payload.device,
            force_rebuild=payload.force_rebuild,
        )
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.delete("/voices/{voice_name}")
def api_delete_voice(voice_name: str):
    try:
        voice_library.delete_voice(voice_name)
        return {"voices": voice_library.list_voices()}
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/voices/{filename}/preview")
def api_preview_voice(filename: str):
    safe_name = Path(filename).name
    candidate = VOICES_DIR / safe_name
    if not candidate.exists():
        candidate_wav = VOICES_DIR / f"{safe_name}.wav"
        if candidate_wav.exists():
            candidate = candidate_wav
        else:
            raise HTTPException(status_code=404, detail="Archivo de voz no encontrado")
    return FileResponse(
        str(candidate.resolve()),
        media_type="audio/wav",
        filename=candidate.name,
        headers={"Cache-Control": "no-store"},
    )


# -----------------------------------------------------------------------------
# PROYECTOS INDEPENDIENTES
# -----------------------------------------------------------------------------


@router.get("/projects")
def api_list_projects():
    return project_manager.list_projects()


@router.post("/projects")
def api_create_project(payload: ProjectCreateRequest):
    try:
        return project_manager.create_project(
            name=payload.name,
            script_text=payload.script_text,
            processing_mode=payload.processing_mode,
            settings=payload.settings,
        )
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/projects/{project_id}")
def api_get_project(project_id: str):
    try:
        return project_manager.get_project(project_id)
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.put("/projects/{project_id}")
def api_save_project(project_id: str, payload: ProjectSaveRequest):
    try:
        return project_manager.save_project(
            project_id,
            name=payload.name,
            script_text=payload.script_text,
            processing_mode=payload.processing_mode,
            settings=payload.settings,
        )
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.patch("/projects/{project_id}/rename")
def api_rename_project(project_id: str, payload: ProjectRenameRequest):
    try:
        return project_manager.rename_project(project_id, payload.name)
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.delete("/projects/{project_id}")
def api_delete_project(project_id: str):
    try:
        if get_production_state()["is_generating"] and get_production_state()["active_project_id"] == project_id:
            raise HTTPException(status_code=409, detail="No se puede eliminar un proyecto mientras está generando audio.")
        project_manager.delete_project(project_id)
        return {"status": "deleted"}
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/projects/{project_id}/export-zip")
def api_export_project_zip(project_id: str):
    try:
        zip_path = project_manager.export_project_zip(project_id)
        return FileResponse(
            str(zip_path),
            media_type="application/zip",
            filename=zip_path.name,
            background=BackgroundTask(shutil.rmtree, zip_path.parent, ignore_errors=True),
        )
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


# -----------------------------------------------------------------------------
# PRODUCCIÓN, REGENERACIÓN Y ENSAMBLADO WAV
# -----------------------------------------------------------------------------


@router.post("/projects/{project_id}/produce")
def api_start_production(project_id: str, payload: ProduceRequest):
    try:
        res = project_manager.get_project(project_id)
        project_data = res["project"]
        p_dir = project_manager.get_project_dir(project_id)
        mode = payload.mode if payload.mode in ("pending_only", "retry_failed", "all") else "pending_only"
        targets = select_target_parts(
            project_data,
            mode=mode,
            section_number=payload.section_number,
        )
        return start_production_background(
            project_dir=p_dir,
            project_data=project_data,
            voice_library=voice_library,
            targets=targets,
            save_project_fn=project_manager.save_project_data,
            is_explicit_regenerate=(mode == "all"),
        )
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/production/cancel")
def api_cancel_production():
    return request_cancel_production()


@router.post("/projects/{project_id}/regenerate-part")
def api_regenerate_part(project_id: str, payload: RegeneratePartRequest):
    if not PRODUCTION_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Ya existe una generación en curso.")
    try:
        res = project_manager.get_project(project_id)
        project_data = res["project"]
        p_dir = project_manager.get_project_dir(project_id)
        targets = select_target_parts(
            project_data,
            mode="explicit",
            explicit_items=[(payload.section_number, payload.part_number)],
        )
        if not targets:
            raise HTTPException(status_code=404, detail="Parte no encontrada en el proyecto.")
        outcome = execute_production_job(
            project_dir=p_dir,
            project_data=project_data,
            voice_library=voice_library,
            targets=targets,
            save_project_fn=project_manager.save_project_data,
            is_explicit_regenerate=True,
        )
        if outcome["failed"] > 0:
            raise HTTPException(status_code=400, detail="Error al regenerar la parte solicitada.")
        updated = project_manager.get_project(project_id)
        return {
            "status": "ok",
            "message": f"Parte {payload.part_number} (Sección {payload.section_number}) regenerada.",
            **updated,
        }
    except HTTPException:
        raise
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))
    finally:
        PRODUCTION_LOCK.release()


@router.post("/projects/{project_id}/regenerate-batch")
def api_regenerate_batch(project_id: str, payload: RegenerateBatchRequest):
    try:
        res = project_manager.get_project(project_id)
        project_data = res["project"]
        p_dir = project_manager.get_project_dir(project_id)
        targets = select_target_parts(
            project_data,
            mode="explicit",
            explicit_items=payload.items,
        )
        return start_production_background(
            project_dir=p_dir,
            project_data=project_data,
            voice_library=voice_library,
            targets=targets,
            save_project_fn=project_manager.save_project_data,
            is_explicit_regenerate=True,
        )
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/projects/{project_id}/join-section")
def api_join_section(project_id: str, payload: JoinSectionRequest):
    try:
        res = project_manager.get_project(project_id)
        project_data = res["project"]
        p_dir = project_manager.get_project_dir(project_id)
        return join_section_audio(
            project_dir=p_dir,
            project_data=project_data,
            section_number=payload.section_number,
            save_project_fn=project_manager.save_project_data,
        )
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.post("/projects/{project_id}/join-master")
def api_join_master(project_id: str):
    try:
        res = project_manager.get_project(project_id)
        project_data = res["project"]
        p_dir = project_manager.get_project_dir(project_id)
        return join_master_audio(
            project_dir=p_dir,
            project_data=project_data,
            save_project_fn=project_manager.save_project_data,
        )
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))
