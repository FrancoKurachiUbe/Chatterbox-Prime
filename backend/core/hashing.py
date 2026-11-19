"""
Sistema de hashing determinista y verificación real de segmentos de audio.
No confía únicamente en si existe un WAV: compara el hash del texto normalizado,
voz de referencia (archivo + transcripción + modo), modelo y parámetros reales.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.config import DEFAULT_GENERATION_SETTINGS, DEFAULT_MAX_CHARS
from backend.core.segmenter import segment_script
from backend.engine.audio_processor import get_wav_duration


def _canonical_generation_params(settings: Dict[str, Any]) -> Dict[str, Any]:
    merged = {**DEFAULT_GENERATION_SETTINGS, **(settings or {})}
    return {
        "model_id": str(merged.get("model_id", "")),
        "language": str(merged.get("language", "Spanish")),
        "voice_name": str(merged.get("voice_name", "")),
        "do_sample": bool(merged.get("do_sample", True)),
        "temperature": round(float(merged.get("temperature", 0.75)), 4),
        "top_p": round(float(merged.get("top_p", 0.9)), 4),
        "top_k": int(merged.get("top_k", 50)),
        "repetition_penalty": round(float(merged.get("repetition_penalty", 1.05)), 4),
        "max_new_tokens": int(merged.get("max_new_tokens", 2048)),
        "subtalker_dosample": bool(merged.get("subtalker_dosample", True)),
        "subtalker_temperature": round(float(merged.get("subtalker_temperature", 0.75)), 4),
        "subtalker_top_p": round(float(merged.get("subtalker_top_p", 0.9)), 4),
        "subtalker_top_k": int(merged.get("subtalker_top_k", 50)),
        "seed": int(merged.get("seed", 737219296)),
        "x_vector_only_mode": bool(merged.get("x_vector_only_mode", False)),
        "sentence_pause_ms": int(merged.get("sentence_pause_ms", 140)),
        "trim_silence": bool(merged.get("trim_silence", True)),
        "silence_threshold_db": round(float(merged.get("silence_threshold_db", -42.0)), 2),
        "strip_leading_artifact": bool(merged.get("strip_leading_artifact", True)),
        "cleaner_rev": 2 if bool(merged.get("strip_leading_artifact", True)) else 0,
    }


def compute_part_content_hash(
    *,
    normalized_text: str,
    settings: Dict[str, Any],
    voice_meta: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Calcula SHA-256 determinista del contenido efectivo + voz + modelo + ajustes.
    Cualquier cambio relevante invalida automáticamente segmentos previos ('stale').
    """
    voice_info = voice_meta or {}
    payload = {
        "normalized_text": normalized_text.strip(),
        "params": _canonical_generation_params(settings),
        "voice": {
            "wav_sha256": str(voice_info.get("wav_sha256", "")),
            "ref_text": str(voice_info.get("ref_text", "")).strip(),
            "voice_xvec": bool(voice_info.get("x_vector_only_mode", False)),
        },
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _part_filename(processing_mode: str, sec_num: int, part_num: int) -> str:
    prefix = "escena" if processing_mode == "scene" else "parrafo"
    return f"{prefix}_{sec_num:03d}_parte_{part_num:03d}.wav"


def _section_joined_filename(processing_mode: str, sec_num: int) -> str:
    prefix = "escena" if processing_mode == "scene" else "parrafo"
    suffix = "completa" if processing_mode == "scene" else "completo"
    return f"{prefix}_{sec_num:03d}_{suffix}.wav"


def build_or_sync_project_sections(
    *,
    project_id: str,
    script_text: str,
    processing_mode: str,
    settings: Dict[str, Any],
    project_dir: Path,
    existing_sections: Optional[List[Dict[str, Any]]] = None,
    voice_meta: Optional[Dict[str, Any]] = None,
    existing_master_filename: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Segmenta el guion (si tiene texto) y reconcilia cada parte con los WAV
    existentes en disco y su `generated_hash` guardado para recuperación exacta.
    """
    segments_dir = project_dir / "segments"
    final_dir = project_dir / "final"
    segments_dir.mkdir(parents=True, exist_ok=True)
    final_dir.mkdir(parents=True, exist_ok=True)

    # Indexar estado previo por (section_number, part_number)
    prev_parts: Dict[tuple[int, int], Dict[str, Any]] = {}
    for sec in existing_sections or []:
        s_num = int(sec.get("number", 0))
        for p in sec.get("parts", []):
            prev_parts[(s_num, int(p.get("number", 0)))] = p

    cleaned_script = (script_text or "").strip()
    if not cleaned_script:
        return {
            "sections": [],
            "summary": compute_summary_metrics([], processing_mode),
            "master_filename": None,
            "master_audio_url": None,
        }

    language = str(settings.get("language", "Spanish"))
    max_chars = int(settings.get("max_chars", DEFAULT_MAX_CHARS))
    raw_sections = segment_script(
        cleaned_script,
        processing_mode=processing_mode,
        language=language,
        max_chars=max_chars,
    )

    reconciled_sections: List[Dict[str, Any]] = []
    for sec in raw_sections:
        s_num = int(sec["number"])
        joined_name = _section_joined_filename(processing_mode, s_num)
        joined_path = final_dir / joined_name
        has_joined = joined_path.exists() and joined_path.is_file() and joined_path.stat().st_size > 44

        parts_out: List[Dict[str, Any]] = []
        for p in sec["parts"]:
            p_num = int(p["number"])
            filename = _part_filename(processing_mode, s_num, p_num)
            wav_path = segments_dir / filename
            wav_exists = wav_path.exists() and wav_path.is_file() and wav_path.stat().st_size > 44

            expected_hash = compute_part_content_hash(
                normalized_text=p["normalized_text"],
                settings=settings,
                voice_meta=voice_meta,
            )

            prev = prev_parts.get((s_num, p_num), {})
            prev_gen_hash = prev.get("generated_hash")
            prev_status = prev.get("status")
            prev_error = prev.get("error_message")
            prev_updated = prev.get("updated_at")

            if wav_exists:
                duration_sec = get_wav_duration(wav_path)
                audio_url = f"/projects/{project_id}/segments/{filename}"
                if prev_gen_hash == expected_hash:
                    status = "ready"
                    error_msg = None
                else:
                    # Existe audio en disco pero cambió texto, voz, modelo o parámetros
                    status = "stale"
                    error_msg = None
            else:
                duration_sec = None
                audio_url = None
                if prev_status == "failed" and prev_error:
                    status = "failed"
                    error_msg = prev_error
                else:
                    status = "pending"
                    error_msg = None

            parts_out.append({
                "number": p_num,
                "text": p["text"],
                "normalized_text": p["normalized_text"],
                "content_hash": expected_hash,
                "filename": filename,
                "audio_url": audio_url,
                "has_audio": wav_exists,
                "duration_sec": duration_sec,
                "status": status,
                "error_message": error_msg,
                "generated_hash": prev_gen_hash if wav_exists else None,
                "updated_at": prev_updated,
            })

        reconciled_sections.append({
            "number": s_num,
            "title": sec["title"],
            "text": sec["text"],
            "normalized_text": sec["normalized_text"],
            "joined_filename": joined_name,
            "joined_audio_url": f"/projects/{project_id}/final/{joined_name}" if has_joined else None,
            "has_joined": has_joined,
            "parts": parts_out,
        })

    master_name = existing_master_filename or "master_narracion.wav"
    master_path = final_dir / master_name
    has_master = master_path.exists() and master_path.is_file() and master_path.stat().st_size > 44

    return {
        "sections": reconciled_sections,
        "summary": compute_summary_metrics(reconciled_sections, processing_mode),
        "master_filename": master_name if has_master else None,
        "master_audio_url": f"/projects/{project_id}/final/{master_name}" if has_master else None,
    }


def compute_summary_metrics(sections: List[Dict[str, Any]], processing_mode: str) -> Dict[str, Any]:
    all_parts = [p for s in sections for p in s.get("parts", [])]
    total = len(all_parts)
    ready = sum(1 for p in all_parts if p.get("status") == "ready")
    pending = sum(1 for p in all_parts if p.get("status") == "pending")
    failed = sum(1 for p in all_parts if p.get("status") == "failed")
    stale = sum(1 for p in all_parts if p.get("status") == "stale")
    percent = int(round((ready / float(total)) * 100)) if total > 0 else 0
    return {
        "mode": processing_mode,
        "mode_label": "Escenas" if processing_mode == "scene" else "Párrafos",
        "total_sections": len(sections),
        "total_parts": total,
        "ready_parts": ready,
        "pending_parts": pending,
        "failed_parts": failed,
        "stale_parts": stale,
        "percent": percent,
    }


def mark_part_ready(part: Dict[str, Any], *, project_id: str, duration_sec: float) -> None:
    part["status"] = "ready"
    part["has_audio"] = True
    part["audio_url"] = f"/projects/{project_id}/segments/{part['filename']}"
    part["duration_sec"] = duration_sec
    part["error_message"] = None
    part["generated_hash"] = part["content_hash"]
    part["updated_at"] = int(time.time())


def mark_part_failed(part: Dict[str, Any], *, error_message: str) -> None:
    part["status"] = "failed"
    part["error_message"] = error_message
    part["updated_at"] = int(time.time())
