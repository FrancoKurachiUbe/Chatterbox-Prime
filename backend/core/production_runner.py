"""
Orquestador secuencial de producción para Qwen3Prime.
Características:
- Cola secuencial con lock exclusivo (protege RAM/VRAM).
- Reutilización de voice_clone_prompt durante toda la sesión.
- Guardado incremental tras cada parte para tolerar cortes/cierres.
- Reanudación desde la 1ª parte pendiente o desactualizada (stale).
- Reintento de partes fallidas, regeneración individual, por lote o por escena.
- Cancelación limpia entre segmentos sin corromper WAVs ya terminados.
- Ensamblado WAV por sección y Master completo con pausas configurables.
"""

from __future__ import annotations

import copy
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from backend.core.hashing import (
    compute_summary_metrics,
    mark_part_failed,
    mark_part_ready,
)
from backend.core.segmenter import split_text_for_tts
from backend.core.voice_library import VoiceLibrary
from backend.engine.audio_processor import (
    build_silence,
    clean_generated_segment_audio,
    concatenate_wav_files,
    get_wav_duration,
    save_wav,
)
from backend.engine.voice_cloner import synthesize_with_voice_clone

PRODUCTION_LOCK = threading.Lock()
_STATE_LOCK = threading.Lock()
_CANCEL_EVENT = threading.Event()

SynthesizerFn = Callable[..., Tuple[Any, int]]
SaveProjectFn = Callable[[Dict[str, Any]], None]

_PRODUCTION_STATE: Dict[str, Any] = {
    "is_generating": False,
    "active_project_id": None,
    "current_step": 0,
    "total_steps": 0,
    "current_label": "",
    "message": "Sistema listo",
    "started_at": None,
    "elapsed_sec": 0,
    "errors": [],
}


def get_production_state() -> Dict[str, Any]:
    with _STATE_LOCK:
        snap = copy.deepcopy(_PRODUCTION_STATE)
    if snap["is_generating"] and snap["started_at"]:
        snap["elapsed_sec"] = max(0, int(time.time() - snap["started_at"]))
    return snap


def request_cancel_production() -> Dict[str, str]:
    _CANCEL_EVENT.set()
    with _STATE_LOCK:
        if _PRODUCTION_STATE["is_generating"]:
            _PRODUCTION_STATE["message"] = "Cancelando tras finalizar el segmento actual..."
            return {"status": "cancelling", "message": _PRODUCTION_STATE["message"]}
    return {"status": "idle", "message": "No hay ninguna generación activa."}


def _update_state(**kwargs: Any) -> None:
    with _STATE_LOCK:
        _PRODUCTION_STATE.update(kwargs)


def _find_part(project: Dict[str, Any], sec_num: int, part_num: int) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
    for sec in project.get("sections", []):
        if int(sec["number"]) == int(sec_num):
            for p in sec.get("parts", []):
                if int(p["number"]) == int(part_num):
                    return sec, p
    return None


def select_target_parts(
    project: Dict[str, Any],
    *,
    mode: str = "pending_only",
    section_number: Optional[int] = None,
    explicit_items: Optional[Iterable[Tuple[int, int]]] = None,
) -> List[Tuple[int, int]]:
    """
    Determina las tuplas (section_number, part_number) en orden del guion.
    mode:
      - 'pending_only': partes 'pending' o 'stale' (salta 'ready' y 'failed')
      - 'retry_failed': únicamente partes 'failed'
      - 'all': todas las partes (del proyecto o de section_number)
      - 'explicit': únicamente las tuplas indicadas en explicit_items
    """
    if mode == "explicit" and explicit_items is not None:
        wanted = {(int(s), int(p)) for s, p in explicit_items}
        ordered: List[Tuple[int, int]] = []
        for sec in project.get("sections", []):
            s_num = int(sec["number"])
            for p in sec.get("parts", []):
                p_num = int(p["number"])
                if (s_num, p_num) in wanted:
                    ordered.append((s_num, p_num))
        return ordered

    targets: List[Tuple[int, int]] = []
    for sec in project.get("sections", []):
        s_num = int(sec["number"])
        if section_number is not None and s_num != int(section_number):
            continue
        for p in sec.get("parts", []):
            st = p.get("status", "pending")
            if mode == "pending_only" and st in ("pending", "stale"):
                targets.append((s_num, int(p["number"])))
            elif mode == "retry_failed" and st == "failed":
                targets.append((s_num, int(p["number"])))
            elif mode == "all":
                targets.append((s_num, int(p["number"])))
    return targets


def _synthesize_part_audio(
    *,
    normalized_text: str,
    voice_record: Dict[str, Any],
    wav_path: Path,
    settings: Dict[str, Any],
    seed_override: Optional[int],
    synthesizer_fn: SynthesizerFn,
) -> Tuple[List[float], int]:
    """
    Sintetiza una parte completa. Si la expansión numérica extendió demasiado el
    texto normalizado y contiene múltiples oraciones, sub-divide por oraciones
    uniéndolas con `sentence_pause_ms`.
    """
    max_chars = int(settings.get("max_chars", 250))
    safe_ceiling = max(320, int(max_chars * 1.45))
    if len(normalized_text) > safe_ceiling:
        sub_chunks = split_text_for_tts(normalized_text, max_chars=max(240, int(max_chars * 1.3)))
    else:
        sub_chunks = [normalized_text]

    trim_enabled = bool(settings.get("trim_silence", True))
    threshold_db = float(settings.get("silence_threshold_db", -42.0))
    strip_leading = bool(settings.get("strip_leading_artifact", True))
    sentence_pause_ms = int(settings.get("sentence_pause_ms", 140))
    effective_xvec = bool(voice_record.get("x_vector_only_mode") or settings.get("x_vector_only_mode"))

    combined_samples: List[float] = []
    target_sr: Optional[int] = None

    for idx, chunk in enumerate(sub_chunks):
        if not chunk.strip():
            continue
        raw_audio, sr = synthesizer_fn(
            text=chunk,
            language=str(settings.get("language", "Spanish")),
            voice_name=str(voice_record["name"]),
            wav_path=wav_path,
            wav_sha256=str(voice_record.get("wav_sha256", "")),
            ref_text=str(voice_record.get("ref_text", "")),
            x_vector_only_mode=effective_xvec,
            settings=settings,
            seed_override=seed_override,
        )
        if target_sr is None:
            target_sr = int(sr)

        processed = clean_generated_segment_audio(
            raw_audio,
            int(sr),
            trim_silence=trim_enabled,
            threshold_db=threshold_db,
            strip_leading_artifact=strip_leading,
        )

        combined_samples.extend(processed)
        if idx < len(sub_chunks) - 1 and sentence_pause_ms > 0:
            combined_samples.extend(build_silence(sentence_pause_ms, target_sr))

    if target_sr is None:
        raise ValueError("El fragmento de texto no produjo audio.")
    return combined_samples, target_sr


def execute_production_job(
    *,
    project_dir: Path,
    project_data: Dict[str, Any],
    voice_library: VoiceLibrary,
    targets: List[Tuple[int, int]],
    save_project_fn: SaveProjectFn,
    synthesizer_fn: SynthesizerFn = synthesize_with_voice_clone,
    is_explicit_regenerate: bool = False,
) -> Dict[str, Any]:
    """Ejecuta de forma síncrona (llamada en hilo o directamente en tests) los targets."""
    if not targets:
        _update_state(
            is_generating=False,
            active_project_id=None,
            current_step=0,
            total_steps=0,
            current_label="",
            message="No hay partes pendientes por generar.",
        )
        return {"completed": 0, "failed": 0, "cancelled": False}

    project_id = str(project_data["id"])
    settings = dict(project_data.get("settings", {}))
    voice_name = str(settings.get("voice_name", ""))
    voice_record = voice_library.get_voice(voice_name, active_model_id=str(settings.get("model_id", "")))
    ref_wav_path = voice_library.get_voice_wav_path(voice_name)

    segments_dir = project_dir / "segments"
    segments_dir.mkdir(parents=True, exist_ok=True)

    started_ts = int(time.time())
    _CANCEL_EVENT.clear()
    _update_state(
        is_generating=True,
        active_project_id=project_id,
        current_step=0,
        total_steps=len(targets),
        current_label="",
        message="Iniciando motor Qwen3-TTS...",
        started_at=started_ts,
        elapsed_sec=0,
        errors=[],
    )

    completed = 0
    failed = 0
    errors_list: List[str] = []
    cancelled = False
    touched_sections: set[int] = set()

    try:
        for idx, (sec_num, part_num) in enumerate(targets, start=1):
            if _CANCEL_EVENT.is_set():
                cancelled = True
                break

            found = _find_part(project_data, sec_num, part_num)
            if found is None:
                continue
            _, part = found

            label = f"{'Escena' if project_data.get('processing_mode') == 'scene' else 'Párrafo'} {sec_num} — Parte {part_num}"
            part["status"] = "generating"
            _update_state(
                current_step=idx,
                current_label=label,
                message=f"Generando {label} ({idx}/{len(targets)})",
            )

            seed_override: Optional[int] = None
            base_seed = int(settings.get("seed", 737219296))
            if is_explicit_regenerate and not bool(settings.get("keep_seed_on_regenerate", True)):
                seed_override = base_seed + (sec_num * 100) + part_num + (int(time.time()) % 1000)

            out_wav = segments_dir / part["filename"]
            try:
                samples, sr = _synthesize_part_audio(
                    normalized_text=part["normalized_text"],
                    voice_record=voice_record,
                    wav_path=ref_wav_path,
                    settings=settings,
                    seed_override=seed_override,
                    synthesizer_fn=synthesizer_fn,
                )
                save_wav(samples, sr, out_wav)
                duration_sec = get_wav_duration(out_wav)
                mark_part_ready(part, project_id=project_id, duration_sec=duration_sec)
                completed += 1
                touched_sections.add(int(sec_num))
            except Exception as err:
                err_text = str(err)
                mark_part_failed(part, error_message=err_text)
                failed += 1
                errors_list.append(f"{label}: {err_text}")
                _update_state(errors=list(errors_list))

            project_data["updated_at"] = int(time.time())
            save_project_fn(project_data)

        # Auto-ensamblar escenas/párrafos que hayan quedado 100% completos
        for sec in project_data.get("sections", []):
            s_num = int(sec["number"])
            if s_num in touched_sections and sec.get("parts") and all(
                p.get("status") == "ready" for p in sec["parts"]
            ):
                try:
                    join_section_audio(
                        project_dir=project_dir,
                        project_data=project_data,
                        section_number=s_num,
                        save_project_fn=save_project_fn,
                    )
                except Exception:
                    pass

        if cancelled:
            final_msg = f"Generación cancelada ({completed} completadas, {failed} fallidas)."
        elif failed > 0:
            final_msg = f"Producción finalizada con {failed} parte(s) fallida(s)."
        else:
            final_msg = f"Producción completada: {completed} parte(s) generada(s)."

        _update_state(
            is_generating=False,
            active_project_id=None,
            current_label="",
            message=final_msg,
            elapsed_sec=max(0, int(time.time() - started_ts)),
        )
        return {"completed": completed, "failed": failed, "cancelled": cancelled}
    finally:
        with _STATE_LOCK:
            _PRODUCTION_STATE["is_generating"] = False
            _PRODUCTION_STATE["active_project_id"] = None


def start_production_background(
    *,
    project_dir: Path,
    project_data: Dict[str, Any],
    voice_library: VoiceLibrary,
    targets: List[Tuple[int, int]],
    save_project_fn: SaveProjectFn,
    synthesizer_fn: SynthesizerFn = synthesize_with_voice_clone,
    is_explicit_regenerate: bool = False,
) -> Dict[str, Any]:
    """Lanza la cola secuencial en un hilo en segundo plano evitando ejecuciones simultáneas."""
    if not targets:
        return {"status": "empty", "message": "No hay partes seleccionadas o pendientes para generar."}

    if not PRODUCTION_LOCK.acquire(blocking=False):
        raise RuntimeError("Ya existe una producción de audio en curso. Espera o cancélala primero.")

    def _worker() -> None:
        try:
            execute_production_job(
                project_dir=project_dir,
                project_data=project_data,
                voice_library=voice_library,
                targets=targets,
                save_project_fn=save_project_fn,
                synthesizer_fn=synthesizer_fn,
                is_explicit_regenerate=is_explicit_regenerate,
            )
        finally:
            PRODUCTION_LOCK.release()

    t = threading.Thread(target=_worker, daemon=True, name="Qwen3-Production-Worker")
    t.start()
    return {
        "status": "started",
        "message": f"Producción iniciada ({len(targets)} parte(s) en cola).",
        "total_targets": len(targets),
    }


def join_section_audio(
    *,
    project_dir: Path,
    project_data: Dict[str, Any],
    section_number: int,
    save_project_fn: SaveProjectFn,
) -> Dict[str, Any]:
    """Une todas las partes de una escena/párrafo con `part_pause_ms` sin compresión destructiva."""
    segments_dir = project_dir / "segments"
    final_dir = project_dir / "final"
    final_dir.mkdir(parents=True, exist_ok=True)

    target_sec = next(
        (s for s in project_data.get("sections", []) if int(s["number"]) == int(section_number)),
        None,
    )
    if target_sec is None:
        raise KeyError(f"Sección {section_number} no encontrada.")

    parts = target_sec.get("parts", [])
    if not parts:
        raise ValueError("La sección no contiene partes para unir.")

    part_pause_ms = int(project_data.get("settings", {}).get("part_pause_ms", 220))
    items: List[Tuple[Path, int]] = []
    for idx, p in enumerate(parts):
        if p.get("status") != "ready":
            raise ValueError(f"La Parte {p['number']} no está lista (estado: {p.get('status')}).")
        wav_path = segments_dir / p["filename"]
        if not wav_path.exists() or wav_path.stat().st_size <= 44:
            raise FileNotFoundError(f"Falta el audio de la Parte {p['number']} ({p['filename']}).")
        pause = part_pause_ms if idx < len(parts) - 1 else 0
        items.append((wav_path, pause))

    joined_filename = target_sec["joined_filename"]
    out_path = final_dir / joined_filename
    _, total_dur = concatenate_wav_files(items, out_path)

    project_id = str(project_data["id"])
    audio_url = f"/projects/{project_id}/final/{joined_filename}"
    target_sec["has_joined"] = True
    target_sec["joined_audio_url"] = audio_url
    project_data["updated_at"] = int(time.time())
    save_project_fn(project_data)

    return {
        "filename": joined_filename,
        "audio_url": audio_url,
        "duration_sec": total_dur,
    }


def join_master_audio(
    *,
    project_dir: Path,
    project_data: Dict[str, Any],
    save_project_fn: SaveProjectFn,
) -> Dict[str, Any]:
    """
    Ensambla el Master WAV final uniendo todas las partes listas en orden
    con `part_pause_ms` entre partes y `section_pause_ms` entre secciones.
    """
    segments_dir = project_dir / "segments"
    final_dir = project_dir / "final"
    final_dir.mkdir(parents=True, exist_ok=True)

    settings = project_data.get("settings", {})
    part_pause_ms = int(settings.get("part_pause_ms", 220))
    section_pause_ms = int(settings.get("section_pause_ms", 650))

    section_ready_files: List[List[Path]] = []
    for sec in project_data.get("sections", []):
        files_in_sec: List[Path] = []
        for p in sec.get("parts", []):
            wav_path = segments_dir / p["filename"]
            if p.get("status") == "ready" and wav_path.exists() and wav_path.stat().st_size > 44:
                files_in_sec.append(wav_path)
        if files_in_sec:
            section_ready_files.append(files_in_sec)

    if not section_ready_files:
        raise ValueError("No hay ningún segmento de audio generado todavía para unir el Master.")

    items: List[Tuple[Path, int]] = []
    for s_idx, sec_files in enumerate(section_ready_files):
        is_last_sec = s_idx == len(section_ready_files) - 1
        for p_idx, wav_path in enumerate(sec_files):
            is_last_in_sec = p_idx == len(sec_files) - 1
            if is_last_in_sec:
                pause = 0 if is_last_sec else section_pause_ms
            else:
                pause = part_pause_ms
            items.append((wav_path, pause))

    master_filename = "master_narracion.wav"
    out_path = final_dir / master_filename
    _, total_dur = concatenate_wav_files(items, out_path)

    project_id = str(project_data["id"])
    master_url = f"/projects/{project_id}/final/{master_filename}"
    project_data["master_filename"] = master_filename
    project_data["master_audio_url"] = master_url
    project_data["updated_at"] = int(time.time())
    save_project_fn(project_data)

    return {
        "filename": master_filename,
        "audio_url": master_url,
        "duration_sec": total_dur,
        "summary": compute_summary_metrics(project_data.get("sections", []), project_data.get("processing_mode", "scene")),
    }
