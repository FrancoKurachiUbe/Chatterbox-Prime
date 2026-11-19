"""
Motor de clonación de voz con Qwen3-TTS.
Usa create_voice_clone_prompt() para extraer y cachear en memoria y disco
la identidad vocal reutilizable, y generate_voice_clone() para sintetizar.
"""

from __future__ import annotations

import hashlib
import inspect
import re
import threading
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from backend.config import PROMPT_CACHE_DIR
from backend.engine.qwen_engine import get_or_load_model, set_seed

_PROMPT_MEM_LOCK = threading.Lock()
_PROMPT_MEMORY_CACHE: Dict[str, Any] = {}


def _model_slug(model_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", model_id).strip("_")


def compute_prompt_cache_key(
    voice_name: str,
    wav_sha256: str,
    ref_text: str,
    x_vector_only_mode: bool,
    model_id: str,
) -> str:
    """Genera una clave única determinista para invalidar el prompt si cambia WAV, texto o modelo."""
    normalized_ref = _normalize_ref_text(ref_text)
    raw = "|".join([
        "v3_cleanref",
        voice_name.strip(),
        wav_sha256.strip(),
        normalized_ref,
        "xvec1" if x_vector_only_mode else "icl0",
        model_id.strip(),
    ])
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]
    safe_voice = re.sub(r"[^a-zA-Z0-9_-]+", "_", voice_name).strip("_") or "voice"
    return f"{safe_voice}__{_model_slug(model_id)}__{digest}"


def _normalize_ref_text(ref_text: str) -> str:
    cleaned = " ".join((ref_text or "").strip().split())
    if cleaned and cleaned[-1] not in ".!?…":
        cleaned += "."
    return cleaned


def get_prompt_cache_path(cache_key: str) -> Path:
    PROMPT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return PROMPT_CACHE_DIR / f"{cache_key}.pt"


def has_cached_prompt(cache_key: str) -> bool:
    if cache_key in _PROMPT_MEMORY_CACHE:
        return True
    p = get_prompt_cache_path(cache_key)
    return p.exists() and p.is_file() and p.stat().st_size > 0


def invalidate_voice_prompts(voice_name: str) -> int:
    """Elimina caches de prompt en memoria y disco asociados a una voz."""
    safe_prefix = (re.sub(r"[^a-zA-Z0-9_-]+", "_", voice_name).strip("_") or "voice") + "__"
    removed = 0
    with _PROMPT_MEM_LOCK:
        for k in list(_PROMPT_MEMORY_CACHE.keys()):
            if k.startswith(safe_prefix):
                del _PROMPT_MEMORY_CACHE[k]
                removed += 1
    if PROMPT_CACHE_DIR.exists():
        for p in PROMPT_CACHE_DIR.glob(f"{safe_prefix}*"):
            try:
                p.unlink()
                removed += 1
            except Exception:
                pass
    return removed


def _save_prompt_to_disk(cache_path: Path, prompt_items: Any) -> None:
    """Persiste VoiceClonePromptItem en disco usando torch.save (o pickle fallback)."""
    try:
        import torch  # type: ignore

        # Mover tensores internos a CPU antes de serializar si aplica
        torch.save(prompt_items, str(cache_path))
    except ImportError:
        import pickle

        with open(cache_path, "wb") as f:
            pickle.dump(prompt_items, f)


def _load_prompt_from_disk(cache_path: Path) -> Any:
    """Carga VoiceClonePromptItem desde disco."""
    try:
        import torch  # type: ignore

        return torch.load(str(cache_path), map_location="cpu", weights_only=False)
    except ImportError:
        import pickle

        with open(cache_path, "rb") as f:
            return pickle.load(f)


def get_or_create_voice_clone_prompt(
    *,
    voice_name: str,
    wav_path: Path,
    wav_sha256: str,
    ref_text: str,
    x_vector_only_mode: bool,
    model_id: str,
    requested_device: str = "auto",
    force_rebuild: bool = False,
    model_override: Optional[Any] = None,
) -> Tuple[Any, str, bool]:
    """
    Obtiene el voice_clone_prompt desde memoria/disco o lo construye con
    model.create_voice_clone_prompt().
    Devuelve: (prompt_items, cache_key, from_cache).
    """
    if not wav_path.exists() or not wav_path.is_file():
        raise FileNotFoundError(f"No existe el archivo WAV de referencia: {wav_path}")

    if not x_vector_only_mode and not ref_text.strip():
        raise ValueError(
            f"La voz '{voice_name}' requiere su transcripción exacta (ref_text) o activar modo solo x-vector."
        )

    cache_key = compute_prompt_cache_key(
        voice_name=voice_name,
        wav_sha256=wav_sha256,
        ref_text=ref_text,
        x_vector_only_mode=x_vector_only_mode,
        model_id=model_id,
    )
    cache_path = get_prompt_cache_path(cache_key)

    if not force_rebuild:
        with _PROMPT_MEM_LOCK:
            if cache_key in _PROMPT_MEMORY_CACHE:
                return _PROMPT_MEMORY_CACHE[cache_key], cache_key, True

        if cache_path.exists() and cache_path.stat().st_size > 0:
            try:
                loaded = _load_prompt_from_disk(cache_path)
                with _PROMPT_MEM_LOCK:
                    _PROMPT_MEMORY_CACHE[cache_key] = loaded
                return loaded, cache_key, True
            except Exception as load_err:
                print(f"[VoiceCloner] Cache corrupta o incompatible ({load_err}), recalculando...")

    model = model_override or get_or_load_model(model_id=model_id, requested_device=requested_device)

    # Preparar copia temporal limpia en prompt_cache/ sin tocar el WAV original
    effective_ref_wav = wav_path
    try:
        from backend.engine.audio_processor import prepare_clean_reference_wav

        clean_ref_path = PROMPT_CACHE_DIR / f"{cache_key}.ref_clean.wav"
        effective_ref_wav = prepare_clean_reference_wav(wav_path, clean_ref_path)
    except Exception:
        effective_ref_wav = wav_path

    clean_ref_text = _normalize_ref_text(ref_text) if not x_vector_only_mode else None

    prompt_items = model.create_voice_clone_prompt(
        ref_audio=str(effective_ref_wav.resolve()),
        ref_text=clean_ref_text,
        x_vector_only_mode=bool(x_vector_only_mode),
    )

    with _PROMPT_MEM_LOCK:
        _PROMPT_MEMORY_CACHE[cache_key] = prompt_items
    _save_prompt_to_disk(cache_path, prompt_items)

    return prompt_items, cache_key, False


def _filter_supported_generation_kwargs(model: Any, settings: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extrae únicamente los parámetros reales que admite Qwen3TTSModel.generate_voice_clone().
    """
    do_sample = bool(settings.get("do_sample", True))
    candidate: Dict[str, Any] = {
        "do_sample": do_sample,
        "max_new_tokens": int(settings.get("max_new_tokens", 2048)),
        "repetition_penalty": float(settings.get("repetition_penalty", 1.05)),
        "non_streaming_mode": True,
    }
    if do_sample:
        candidate["temperature"] = float(settings.get("temperature", 0.75))
        candidate["top_p"] = float(settings.get("top_p", 0.9))
        candidate["top_k"] = int(settings.get("top_k", 50))

    sub_do_sample = bool(settings.get("subtalker_dosample", do_sample))
    candidate["subtalker_dosample"] = sub_do_sample
    if sub_do_sample:
        candidate["subtalker_temperature"] = float(settings.get("subtalker_temperature", candidate.get("temperature", 0.75)))
        candidate["subtalker_top_p"] = float(settings.get("subtalker_top_p", candidate.get("top_p", 0.9)))
        candidate["subtalker_top_k"] = int(settings.get("subtalker_top_k", candidate.get("top_k", 50)))

    try:
        sig = inspect.signature(model.generate_voice_clone)
        has_var_kw = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
        if not has_var_kw:
            return {k: v for k, v in candidate.items() if k in sig.parameters}
        # Solo pasar non_streaming_mode si existe explícitamente en la firma
        if "non_streaming_mode" not in sig.parameters:
            candidate.pop("non_streaming_mode", None)
    except Exception:
        candidate.pop("non_streaming_mode", None)
    return candidate


def synthesize_with_voice_clone(
    *,
    text: str,
    language: str,
    voice_name: str,
    wav_path: Path,
    wav_sha256: str,
    ref_text: str,
    x_vector_only_mode: bool,
    settings: Dict[str, Any],
    seed_override: Optional[int] = None,
    model_override: Optional[Any] = None,
) -> Tuple[Any, int]:
    """
    Sintetiza un fragmento de texto reutilizando voice_clone_prompt precalculado.
    Devuelve (audio_1d_float32, sample_rate).
    """
    model_id = str(settings.get("model_id", "Qwen/Qwen3-TTS-12Hz-1.7B-Base"))
    device_req = str(settings.get("device", "auto"))

    model = model_override or get_or_load_model(model_id=model_id, requested_device=device_req)

    prompt_items, _, _ = get_or_create_voice_clone_prompt(
        voice_name=voice_name,
        wav_path=wav_path,
        wav_sha256=wav_sha256,
        ref_text=ref_text,
        x_vector_only_mode=x_vector_only_mode,
        model_id=model_id,
        requested_device=device_req,
        force_rebuild=False,
        model_override=model,
    )

    effective_seed = seed_override if seed_override is not None else settings.get("seed")
    if effective_seed is not None:
        set_seed(int(effective_seed))

    gen_kwargs = _filter_supported_generation_kwargs(model, settings)

    wavs, sr = model.generate_voice_clone(
        text=text,
        language=language,
        voice_clone_prompt=prompt_items,
        **gen_kwargs,
    )

    audio = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
    return audio, int(sr)
