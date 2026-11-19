"""
Configuración central, rutas, modelos Qwen3-TTS soportados y detección de hardware.
"""

from __future__ import annotations

import importlib.util
import os
import platform
import socket
import sys
from pathlib import Path
from typing import Any, Dict, List

APP_NAME = "Qwen3Prime"
APP_VERSION = "1.0.0"

BASE_DIR = Path(__file__).resolve().parent.parent
VOICES_DIR = BASE_DIR / "voices"
PROMPT_CACHE_DIR = VOICES_DIR / "prompt_cache"
VOICES_MANIFEST_FILE = VOICES_DIR / "voices_manifest.json"
PROJECTS_DIR = BASE_DIR / "projects"
DIST_DIR = BASE_DIR / "dist"

for _d in (VOICES_DIR, PROMPT_CACHE_DIR, PROJECTS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

PREFERRED_VOICE = "Brian Warm Clonacion Voz"
DEFAULT_LANGUAGE = "Spanish"
DEFAULT_MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
FALLBACK_CPU_MODEL_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
DEFAULT_SEED = 737219296
DEFAULT_MAX_CHARS = 250

QWEN_MODELS: Dict[str, Dict[str, Any]] = {
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base": {
        "id": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        "label": "Qwen3-TTS 12Hz 1.7B Base (Principal)",
        "size_gb_approx": 4.2,
        "recommended_vram_gb": 6.0,
        "recommended_ram_gb": 12.0,
        "description": "Máxima fidelidad de clonación vocal y prosodia natural para narración documental.",
    },
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base": {
        "id": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        "label": "Qwen3-TTS 12Hz 0.6B Base (Alternativo / CPU)",
        "size_gb_approx": 1.8,
        "recommended_vram_gb": 3.0,
        "recommended_ram_gb": 8.0,
        "description": "Modelo compacto y más rápido en CPU o sistemas con recursos limitados.",
    },
}

# Los 10 idiomas oficialmente soportados por Qwen3-TTS
QWEN_SUPPORTED_LANGUAGES: List[Dict[str, str]] = [
    {"id": "Spanish", "code": "es", "label": "Español", "native": "Español"},
    {"id": "English", "code": "en", "label": "Inglés", "native": "English"},
    {"id": "Portuguese", "code": "pt", "label": "Portugués", "native": "Português"},
    {"id": "French", "code": "fr", "label": "Francés", "native": "Français"},
    {"id": "Italian", "code": "it", "label": "Italiano", "native": "Italiano"},
    {"id": "German", "code": "de", "label": "Alemán", "native": "Deutsch"},
    {"id": "Russian", "code": "ru", "label": "Ruso", "native": "Русский"},
    {"id": "Japanese", "code": "ja", "label": "Japonés", "native": "日本語"},
    {"id": "Korean", "code": "ko", "label": "Coreano", "native": "한국어"},
    {"id": "Chinese", "code": "zh", "label": "Chino", "native": "中文"},
]

DEFAULT_GENERATION_SETTINGS: Dict[str, Any] = {
    "model_id": DEFAULT_MODEL_ID,
    "device": "auto",  # auto | cpu | cuda
    "language": DEFAULT_LANGUAGE,
    "voice_name": PREFERRED_VOICE,
    "max_chars": DEFAULT_MAX_CHARS,
    "do_sample": True,
    "temperature": 0.75,
    "top_p": 0.9,
    "top_k": 50,
    "repetition_penalty": 1.05,
    "max_new_tokens": 2048,
    "subtalker_dosample": True,
    "subtalker_temperature": 0.75,
    "subtalker_top_p": 0.9,
    "subtalker_top_k": 50,
    "seed": DEFAULT_SEED,
    "keep_seed_on_regenerate": True,
    "x_vector_only_mode": False,
    "sentence_pause_ms": 140,
    "part_pause_ms": 220,
    "section_pause_ms": 650,
    "trim_silence": True,
    "silence_threshold_db": -42.0,
    "strip_leading_artifact": True,
}


def _get_system_ram_gb() -> Dict[str, float]:
    """Obtiene RAM total y disponible sin requerir dependencias obligatorias."""
    try:
        import psutil  # type: ignore

        vm = psutil.virtual_memory()
        return {
            "total_gb": round(vm.total / (1024 ** 3), 2),
            "available_gb": round(vm.available / (1024 ** 3), 2),
        }
    except Exception:
        pass

    if sys.platform == "win32":
        try:
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            return {
                "total_gb": round(stat.ullTotalPhys / (1024 ** 3), 2),
                "available_gb": round(stat.ullAvailPhys / (1024 ** 3), 2),
            }
        except Exception:
            pass

    meminfo = Path("/proc/meminfo")
    if meminfo.exists():
        try:
            content = meminfo.read_text(encoding="utf-8")
            total_kb = 0
            avail_kb = 0
            for line in content.splitlines():
                if line.startswith("MemTotal:"):
                    total_kb = int(line.split()[1])
                elif line.startswith("MemAvailable:"):
                    avail_kb = int(line.split()[1])
            return {
                "total_gb": round(total_kb / (1024 ** 2), 2),
                "available_gb": round(avail_kb / (1024 ** 2), 2),
            }
        except Exception:
            pass

    return {"total_gb": 0.0, "available_gb": 0.0}


def get_hardware_info() -> Dict[str, Any]:
    """Inspecciona hardware actual (CPU, RAM, CUDA, GPU, paquetes disponibles)."""
    ram = _get_system_ram_gb()
    torch_installed = importlib.util.find_spec("torch") is not None
    qwen_installed = importlib.util.find_spec("qwen_tts") is not None
    flash_attn_installed = importlib.util.find_spec("flash_attn") is not None
    soundfile_installed = importlib.util.find_spec("soundfile") is not None

    cuda_available = False
    gpu_name = None
    vram_total_gb = 0.0
    vram_free_gb = 0.0
    torch_version = None

    if torch_installed:
        try:
            import torch  # type: ignore

            torch_version = torch.__version__
            cuda_available = bool(torch.cuda.is_available())
            if cuda_available:
                gpu_name = torch.cuda.get_device_name(0)
                free_b, total_b = torch.cuda.mem_get_info(0)
                vram_free_gb = round(free_b / (1024 ** 3), 2)
                vram_total_gb = round(total_b / (1024 ** 3), 2)
        except Exception:
            pass

    recommended_device = "cuda" if cuda_available else "cpu"
    recommended_model = DEFAULT_MODEL_ID if (cuda_available and vram_total_gb >= 5.5) else FALLBACK_CPU_MODEL_ID

    warnings: List[str] = []
    if not torch_installed:
        warnings.append("PyTorch no está instalado en este entorno Python.")
    if not qwen_installed:
        warnings.append("La biblioteca oficial qwen-tts no está instalada.")
    if not cuda_available:
        warnings.append(
            "No se detectó GPU NVIDIA con CUDA. El motor funcionará en CPU (float32). "
            "Para sesiones largas en CPU se recomienda el modelo 0.6B-Base."
        )
    if ram["available_gb"] > 0 and ram["available_gb"] < 6.0 and not cuda_available:
        warnings.append(
            f"RAM disponible reducida ({ram['available_gb']} GB). Cierra aplicaciones pesadas antes de cargar 1.7B."
        )

    return {
        "os": f"{platform.system()} {platform.release()}",
        "python_version": platform.python_version(),
        "cpu_cores": os.cpu_count() or 1,
        "ram_total_gb": ram["total_gb"],
        "ram_available_gb": ram["available_gb"],
        "torch_installed": torch_installed,
        "torch_version": torch_version,
        "qwen_tts_installed": qwen_installed,
        "flash_attn_installed": flash_attn_installed,
        "soundfile_installed": soundfile_installed,
        "cuda_available": cuda_available,
        "gpu_name": gpu_name,
        "vram_total_gb": vram_total_gb,
        "vram_free_gb": vram_free_gb,
        "recommended_device": recommended_device,
        "recommended_model": recommended_model,
        "warnings": warnings,
    }


def is_port_available(host: str, port: int) -> bool:
    """Comprueba si un puerto TCP local está realmente libre (evita WinError 10048)."""
    probe_host = "127.0.0.1" if host in ("0.0.0.0", "::", "") else host
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
            client.settimeout(0.25)
            if client.connect_ex((probe_host, port)) == 0:
                return False
    except OSError:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as srv:
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                try:
                    srv.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)  # type: ignore[attr-defined]
                except OSError:
                    pass
            srv.bind((host, port))
        return True
    except OSError:
        return False


def find_available_port(host: str, preferred_port: int, max_tries: int = 20) -> int:
    """Devuelve `preferred_port` si está libre, o el primer puerto libre consecutivo."""
    for offset in range(max(1, max_tries)):
        candidate = preferred_port + offset
        if is_port_available(host, candidate):
            return candidate
    raise RuntimeError(
        f"No se encontró ningún puerto libre entre {preferred_port} y {preferred_port + max_tries - 1}. "
        "Cierra ventanas anteriores de Qwen3Prime o reinicia el puerto ocupado."
    )
