"""
Gestión del ciclo de vida del modelo oficial Qwen3-TTS (`qwen-tts`).
Soporta carga lazy/singleton, detección automática CPU/CUDA (incluida futura RTX 5060),
liberación de memoria RAM/VRAM y fijación de semilla.
"""

from __future__ import annotations

import gc
import inspect
import random
import threading
from typing import Any, Dict, Optional, Tuple

from backend.config import DEFAULT_MODEL_ID, QWEN_MODELS, get_hardware_info

_MODEL_LOCK = threading.Lock()
_MODEL_INSTANCE: Optional[Any] = None
_ACTIVE_MODEL_ID: Optional[str] = None
_ACTIVE_DEVICE: Optional[str] = None
_ACTIVE_DTYPE: Optional[str] = None
_LAST_ERROR: Optional[str] = None


def set_seed(seed: Optional[int]) -> None:
    """Establece semillas de PyTorch, NumPy y Python random."""
    if seed is None:
        return
    seed_int = int(seed)
    random.seed(seed_int)
    try:
        import numpy as np  # type: ignore

        np.random.seed(seed_int % (2 ** 32 - 1))
    except Exception:
        pass
    try:
        import torch  # type: ignore

        torch.manual_seed(seed_int)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed_int)
    except Exception:
        pass


def resolve_device(requested_device: str = "auto") -> str:
    """Resuelve el dispositivo PyTorch real según hardware disponible."""
    req = (requested_device or "auto").strip().lower()
    hw = get_hardware_info()

    if req == "cuda":
        if not hw["cuda_available"]:
            raise RuntimeError(
                "Se solicitó CUDA pero no hay ninguna GPU NVIDIA con CUDA disponible en este equipo."
            )
        return "cuda:0"

    if req == "cpu":
        return "cpu"

    # auto
    return "cuda:0" if hw["cuda_available"] else "cpu"


def get_model_status() -> Dict[str, Any]:
    """Devuelve el estado actual del modelo Qwen3-TTS en memoria."""
    if _MODEL_INSTANCE is not None and _ACTIVE_MODEL_ID:
        return {
            "loaded": True,
            "active_model_id": _ACTIVE_MODEL_ID,
            "active_device": _ACTIVE_DEVICE,
            "active_dtype": _ACTIVE_DTYPE,
            "last_error": _LAST_ERROR,
            "status_text": f"Modelo cargado: {_ACTIVE_MODEL_ID.split('/')[-1]} ({_ACTIVE_DEVICE})",
        }
    return {
        "loaded": False,
        "active_model_id": None,
        "active_device": None,
        "active_dtype": None,
        "last_error": _LAST_ERROR,
        "status_text": "Modelo en reposo (se cargará al preparar voz o producir)",
    }


def unload_model() -> Dict[str, Any]:
    """Libera el modelo actual de RAM/VRAM."""
    global _MODEL_INSTANCE, _ACTIVE_MODEL_ID, _ACTIVE_DEVICE, _ACTIVE_DTYPE
    with _MODEL_LOCK:
        was_loaded = _MODEL_INSTANCE is not None
        _MODEL_INSTANCE = None
        _ACTIVE_MODEL_ID = None
        _ACTIVE_DEVICE = None
        _ACTIVE_DTYPE = None
        gc.collect()
        try:
            import torch  # type: ignore

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
    return {
        "status": "ok",
        "message": "Memoria del modelo liberada correctamente." if was_loaded else "No había ningún modelo cargado.",
    }


def _select_dtype_and_attention(device: str) -> Tuple[Any, Optional[str], str]:
    """Selecciona dtype y mecanismo de atención seguros para CPU o GPU (RTX 5060)."""
    import torch  # type: ignore

    hw = get_hardware_info()
    if device.startswith("cuda"):
        # bfloat16 recomendado para Ampere/Ada/Blackwell (RTX 5060)
        if torch.cuda.is_bf16_supported():
            dtype = torch.bfloat16
            dtype_name = "bfloat16"
        else:
            dtype = torch.float16
            dtype_name = "float16"
        attn = "flash_attention_2" if hw.get("flash_attn_installed") else "sdpa"
        return dtype, attn, dtype_name

    # CPU: float32 estable; no exigir flash_attn
    return torch.float32, "sdpa", "float32"


def get_or_load_model(model_id: str = DEFAULT_MODEL_ID, requested_device: str = "auto") -> Any:
    """
    Carga Qwen3TTSModel.from_pretrained() bajo demanda y reutiliza la instancia en memoria.
    """
    global _MODEL_INSTANCE, _ACTIVE_MODEL_ID, _ACTIVE_DEVICE, _ACTIVE_DTYPE, _LAST_ERROR

    if model_id not in QWEN_MODELS:
        raise ValueError(f"Modelo no soportado: {model_id}. Opciones: {list(QWEN_MODELS.keys())}")

    target_device = resolve_device(requested_device)

    with _MODEL_LOCK:
        if (
            _MODEL_INSTANCE is not None
            and _ACTIVE_MODEL_ID == model_id
            and _ACTIVE_DEVICE == target_device
        ):
            return _MODEL_INSTANCE

        # Si hay otro modelo o dispositivo cargado, liberar primero para evitar OOM en 16 GB RAM
        if _MODEL_INSTANCE is not None:
            _MODEL_INSTANCE = None
            _ACTIVE_MODEL_ID = None
            _ACTIVE_DEVICE = None
            _ACTIVE_DTYPE = None
            gc.collect()
            try:
                import torch  # type: ignore

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

        try:
            import torch  # noqa: F401
            from qwen_tts import Qwen3TTSModel  # type: ignore
        except ImportError as exc:
            _LAST_ERROR = f"Falta qwen-tts o PyTorch: {exc}"
            raise RuntimeError(
                "No se pudo importar 'qwen_tts.Qwen3TTSModel'. "
                "Ejecuta install.bat o instala con: pip install qwen-tts torch soundfile"
            ) from exc

        hw = get_hardware_info()
        model_meta = QWEN_MODELS[model_id]
        if not hw["cuda_available"] and hw["ram_available_gb"] > 0:
            if hw["ram_available_gb"] < 4.5 and "1.7B" in model_id:
                raise RuntimeError(
                    f"RAM libre insuficiente ({hw['ram_available_gb']} GB) para cargar {model_id} en CPU. "
                    "Cierra otros programas o selecciona Qwen3-TTS-12Hz-0.6B-Base."
                )

        dtype, attn_impl, dtype_name = _select_dtype_and_attention(target_device)

        kwargs: Dict[str, Any] = {
            "device_map": target_device,
        }

        try:
            sig = inspect.signature(Qwen3TTSModel.from_pretrained)
            params = sig.parameters
            if "dtype" in params:
                kwargs["dtype"] = dtype
            elif "torch_dtype" in params:
                kwargs["torch_dtype"] = dtype
            else:
                kwargs["dtype"] = dtype

            if attn_impl and ("attn_implementation" in params or any(
                p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()
            )):
                kwargs["attn_implementation"] = attn_impl
        except Exception:
            kwargs["dtype"] = dtype
            if attn_impl:
                kwargs["attn_implementation"] = attn_impl

        try:
            print(f"[Qwen3Engine] Cargando {model_id} en {target_device} ({dtype_name}, attn={attn_impl})...")
            try:
                model = Qwen3TTSModel.from_pretrained(model_id, **kwargs)
            except (TypeError, ValueError, ImportError) as opt_err:
                # Reintentar sin attn_implementation si el entorno Windows/CPU no soporta ese backend
                if "attn_implementation" in kwargs:
                    print(f"[Qwen3Engine] Reintentando sin attn_implementation ({opt_err})...")
                    kwargs.pop("attn_implementation", None)
                    model = Qwen3TTSModel.from_pretrained(model_id, **kwargs)
                else:
                    raise

            _MODEL_INSTANCE = model
            _ACTIVE_MODEL_ID = model_id
            _ACTIVE_DEVICE = target_device
            _ACTIVE_DTYPE = dtype_name
            _LAST_ERROR = None
            print(f"[Qwen3Engine] Modelo listo: {model_id} ({target_device})")
            return model
        except Exception as err:
            _LAST_ERROR = str(err)
            _MODEL_INSTANCE = None
            _ACTIVE_MODEL_ID = None
            _ACTIVE_DEVICE = None
            _ACTIVE_DTYPE = None
            gc.collect()
            raise RuntimeError(
                f"Error al cargar {model_meta['label']} en {target_device}: {err}"
            ) from err
