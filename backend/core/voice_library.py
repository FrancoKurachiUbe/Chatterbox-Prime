"""
Biblioteca persistente de voces de referencia (WAV intactos + manifiesto JSON).
Conserva Brian Warm Clonacion Voz.wav como voz principal y rastrea el estado
de preparación del prompt de clonación por modelo.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.config import DEFAULT_MODEL_ID, PREFERRED_VOICE, VOICES_DIR, VOICES_MANIFEST_FILE
from backend.engine.voice_cloner import (
    compute_prompt_cache_key,
    get_or_create_voice_clone_prompt,
    has_cached_prompt,
    invalidate_voice_prompts,
)


def _sanitize_voice_name(name: str) -> str:
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name or "").strip()
    return cleaned or "Voz_Personalizada"


def _compute_file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _inspect_wav(path: Path) -> Dict[str, Any]:
    """Inspecciona duración, sample rate y canales de un WAV sin modificarlo."""
    info: Dict[str, Any] = {
        "size_kb": round(path.stat().st_size / 1024, 1),
        "duration_sec": None,
        "sample_rate": None,
        "channels": None,
    }
    try:
        with wave.open(str(path), "rb") as wf:
            sr = wf.getframerate()
            frames = wf.getnframes()
            ch = wf.getnchannels()
            info["sample_rate"] = sr
            info["channels"] = ch
            info["duration_sec"] = round(frames / float(sr), 2) if sr > 0 else None
        return info
    except Exception:
        pass

    try:
        import soundfile as sf  # type: ignore

        sf_info = sf.info(str(path))
        info["sample_rate"] = int(sf_info.samplerate)
        info["channels"] = int(sf_info.channels)
        info["duration_sec"] = round(float(sf_info.duration), 2)
    except Exception:
        pass
    return info


class VoiceLibrary:
    """Gestiona voces de referencia en voices/ y sus metadatos en voices_manifest.json."""

    def __init__(self, voices_dir: Path = VOICES_DIR, manifest_file: Path = VOICES_MANIFEST_FILE) -> None:
        self.voices_dir = voices_dir
        self.manifest_file = manifest_file
        self.voices_dir.mkdir(parents=True, exist_ok=True)

    def _load_manifest(self) -> Dict[str, Any]:
        if not self.manifest_file.exists():
            return {"voices": {}}
        try:
            data = json.loads(self.manifest_file.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("voices"), dict):
                return data
        except Exception:
            pass
        return {"voices": {}}

    def _save_manifest(self, manifest: Dict[str, Any]) -> None:
        self.voices_dir.mkdir(parents=True, exist_ok=True)
        self.manifest_file.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _sync_with_disk(self) -> Dict[str, Any]:
        manifest = self._load_manifest()
        entries: Dict[str, Any] = manifest.setdefault("voices", {})
        wav_files = sorted(self.voices_dir.glob("*.wav"), key=lambda p: p.stem.lower())
        disk_by_stem = {p.stem: p for p in wav_files}

        changed = False
        now = int(time.time())

        # Registrar cualquier WAV presente en voices/ que aún no esté en el manifiesto
        for stem, wav_path in disk_by_stem.items():
            sha = _compute_file_sha256(wav_path)
            if stem not in entries:
                entries[stem] = {
                    "name": stem,
                    "filename": wav_path.name,
                    "ref_text": "",
                    "x_vector_only_mode": False,
                    "wav_sha256": sha,
                    "created_at": now,
                    "updated_at": now,
                }
                changed = True
            elif entries[stem].get("wav_sha256") != sha:
                entries[stem]["wav_sha256"] = sha
                entries[stem]["filename"] = wav_path.name
                entries[stem]["updated_at"] = now
                changed = True

        # Asegurar entrada visible para Brian Warm Clonacion Voz incluso antes de copiar su WAV
        if PREFERRED_VOICE not in entries:
            entries[PREFERRED_VOICE] = {
                "name": PREFERRED_VOICE,
                "filename": f"{PREFERRED_VOICE}.wav",
                "ref_text": "",
                "x_vector_only_mode": False,
                "wav_sha256": "",
                "created_at": now,
                "updated_at": now,
            }
            changed = True

        if changed:
            self._save_manifest(manifest)
        return manifest

    def _build_voice_record(self, stem: str, meta: Dict[str, Any], active_model_id: str) -> Dict[str, Any]:
        filename = meta.get("filename") or f"{stem}.wav"
        wav_path = self.voices_dir / filename
        exists = wav_path.exists() and wav_path.is_file() and wav_path.stat().st_size > 44
        wav_info = _inspect_wav(wav_path) if exists else {
            "size_kb": 0.0,
            "duration_sec": None,
            "sample_rate": None,
            "channels": None,
        }
        ref_text = str(meta.get("ref_text", "") or "")
        xvec = bool(meta.get("x_vector_only_mode", False))
        sha = str(meta.get("wav_sha256") or "")
        if exists and not sha:
            sha = _compute_file_sha256(wav_path)

        prompt_ready_models: List[str] = []
        if exists and sha and (xvec or ref_text.strip()):
            for mid in ("Qwen/Qwen3-TTS-12Hz-1.7B-Base", "Qwen/Qwen3-TTS-12Hz-0.6B-Base"):
                key = compute_prompt_cache_key(stem, sha, ref_text, xvec, mid)
                if has_cached_prompt(key):
                    prompt_ready_models.append(mid)

        if not exists:
            prompt_status = "missing_audio"
        elif not xvec and not ref_text.strip():
            prompt_status = "needs_transcript"
        elif active_model_id in prompt_ready_models:
            prompt_status = "ready"
        else:
            prompt_status = "not_prepared"

        return {
            "name": stem,
            "filename": filename,
            "size_kb": wav_info["size_kb"],
            "duration_sec": wav_info["duration_sec"],
            "sample_rate": wav_info["sample_rate"],
            "channels": wav_info["channels"],
            "ref_text": ref_text,
            "x_vector_only_mode": xvec,
            "is_default": stem == PREFERRED_VOICE,
            "exists_on_disk": exists,
            "wav_sha256": sha,
            "preview_url": f"/api/voices/{filename}/preview",
            "prompt_ready_models": prompt_ready_models,
            "prompt_status": prompt_status,
        }

    def list_voices(self, active_model_id: str = DEFAULT_MODEL_ID) -> List[Dict[str, Any]]:
        manifest = self._sync_with_disk()
        entries = manifest.get("voices", {})
        records = [
            self._build_voice_record(stem, meta, active_model_id)
            for stem, meta in entries.items()
        ]
        # Priorizar Brian Warm Clonacion Voz al principio
        records.sort(key=lambda r: (0 if r["is_default"] else 1, r["name"].lower()))
        return records

    def get_voice(self, voice_name: str, active_model_id: str = DEFAULT_MODEL_ID) -> Dict[str, Any]:
        manifest = self._sync_with_disk()
        entries = manifest.get("voices", {})
        if voice_name not in entries:
            raise KeyError(f"Voz no encontrada: {voice_name}")
        return self._build_voice_record(voice_name, entries[voice_name], active_model_id)

    def get_voice_wav_path(self, voice_name: str) -> Path:
        manifest = self._sync_with_disk()
        entries = manifest.get("voices", {})
        if voice_name in entries:
            p = self.voices_dir / entries[voice_name].get("filename", f"{voice_name}.wav")
            if p.exists() and p.is_file():
                return p
        direct = self.voices_dir / f"{voice_name}.wav"
        if direct.exists() and direct.is_file():
            return direct
        raise FileNotFoundError(f"No se encontró el archivo WAV para la voz '{voice_name}'.")

    def import_voice_bytes(
        self,
        *,
        raw_bytes: bytes,
        voice_name: str,
        ref_text: str = "",
        x_vector_only_mode: bool = False,
        active_model_id: str = DEFAULT_MODEL_ID,
    ) -> Dict[str, Any]:
        if len(raw_bytes) <= 44:
            raise ValueError("El archivo WAV está vacío o no es válido.")

        safe_name = _sanitize_voice_name(voice_name)
        dest_path = self.voices_dir / f"{safe_name}.wav"
        dest_path.write_bytes(raw_bytes)

        invalidate_voice_prompts(safe_name)

        manifest = self._load_manifest()
        entries = manifest.setdefault("voices", {})
        now = int(time.time())
        sha = _compute_file_sha256(dest_path)
        prev = entries.get(safe_name, {})

        entries[safe_name] = {
            "name": safe_name,
            "filename": dest_path.name,
            "ref_text": ref_text if ref_text is not None else prev.get("ref_text", ""),
            "x_vector_only_mode": bool(x_vector_only_mode),
            "wav_sha256": sha,
            "created_at": prev.get("created_at", now),
            "updated_at": now,
        }
        self._save_manifest(manifest)
        return self._build_voice_record(safe_name, entries[safe_name], active_model_id)

    def update_voice_meta(
        self,
        voice_name: str,
        *,
        new_name: Optional[str] = None,
        ref_text: Optional[str] = None,
        x_vector_only_mode: Optional[bool] = None,
        active_model_id: str = DEFAULT_MODEL_ID,
    ) -> Dict[str, Any]:
        manifest = self._sync_with_disk()
        entries = manifest.setdefault("voices", {})
        if voice_name not in entries:
            raise KeyError(f"Voz no encontrada: {voice_name}")

        entry = entries[voice_name]
        target_name = voice_name

        if new_name and _sanitize_voice_name(new_name) != voice_name:
            target_name = _sanitize_voice_name(new_name)
            if target_name in entries:
                raise ValueError(f"Ya existe una voz llamada '{target_name}'.")
            old_wav = self.voices_dir / entry["filename"]
            new_wav = self.voices_dir / f"{target_name}.wav"
            if old_wav.exists():
                old_wav.rename(new_wav)
            invalidate_voice_prompts(voice_name)
            del entries[voice_name]
            entry["name"] = target_name
            entry["filename"] = new_wav.name
            entries[target_name] = entry

        if ref_text is not None and ref_text != entry.get("ref_text"):
            entry["ref_text"] = ref_text
            invalidate_voice_prompts(target_name)

        if x_vector_only_mode is not None and bool(x_vector_only_mode) != bool(entry.get("x_vector_only_mode")):
            entry["x_vector_only_mode"] = bool(x_vector_only_mode)
            invalidate_voice_prompts(target_name)

        entry["updated_at"] = int(time.time())
        self._save_manifest(manifest)
        return self._build_voice_record(target_name, entry, active_model_id)

    def delete_voice(self, voice_name: str) -> None:
        manifest = self._sync_with_disk()
        entries = manifest.setdefault("voices", {})
        if voice_name in entries:
            wav_path = self.voices_dir / entries[voice_name].get("filename", f"{voice_name}.wav")
            if wav_path.exists():
                wav_path.unlink()
            del entries[voice_name]
            self._save_manifest(manifest)
        invalidate_voice_prompts(voice_name)

    def prepare_voice_prompt(
        self,
        voice_name: str,
        *,
        model_id: str = DEFAULT_MODEL_ID,
        device: str = "auto",
        force_rebuild: bool = False,
        model_override: Optional[Any] = None,
    ) -> Dict[str, Any]:
        record = self.get_voice(voice_name, active_model_id=model_id)
        if not record["exists_on_disk"]:
            raise FileNotFoundError(
                f"Coloca el archivo '{record['filename']}' dentro de la carpeta voices/ o súbelo desde la interfaz."
            )
        wav_path = self.voices_dir / record["filename"]
        _, cache_key, from_cache = get_or_create_voice_clone_prompt(
            voice_name=voice_name,
            wav_path=wav_path,
            wav_sha256=record["wav_sha256"],
            ref_text=record["ref_text"],
            x_vector_only_mode=record["x_vector_only_mode"],
            model_id=model_id,
            requested_device=device,
            force_rebuild=force_rebuild,
            model_override=model_override,
        )
        updated = self.get_voice(voice_name, active_model_id=model_id)
        return {
            "status": "ok",
            "from_cache": from_cache,
            "cache_key": cache_key,
            "message": (
                f"Prompt recuperado de caché para '{voice_name}'."
                if from_cache
                else f"Prompt de clonación preparado y guardado para '{voice_name}'."
            ),
            "voice": updated,
        }
