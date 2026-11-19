"""
Procesamiento y calidad de audio WAV sin normalización ni compresión destructiva.
Conserva frecuencia de muestreo original, convierte canales si es necesario,
recorta silencios artificiales excesivos e inserta pausas naturales configurables.
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple


def _to_mono_float_list(audio: Sequence[float] | object) -> List[float]:
    """Convierte tensores, arrays NumPy o listas a mono float32 list en rango [-1, 1]."""
    try:
        import numpy as np  # type: ignore

        arr = np.asarray(audio, dtype=np.float32)
        if arr.ndim == 2:
            # Soportar (channels, samples) o (samples, channels)
            if arr.shape[0] <= 8 and arr.shape[0] < arr.shape[1]:
                arr = np.mean(arr, axis=0)
            else:
                arr = np.mean(arr, axis=1)
        elif arr.ndim > 2:
            arr = arr.reshape(-1)
        arr = np.clip(arr, -1.0, 1.0)
        return arr.tolist()
    except ImportError:
        pass

    # Fallback puro Python
    if hasattr(audio, "tolist"):
        raw = audio.tolist()  # type: ignore[attr-defined]
    else:
        raw = list(audio)  # type: ignore[arg-type]

    if raw and isinstance(raw[0], (list, tuple)):
        # Promedio de canales si es 2D
        if len(raw) <= 8 and isinstance(raw[0], (list, tuple)) and len(raw[0]) > 8:
            ch_count = len(raw)
            n = len(raw[0])
            return [
                max(-1.0, min(1.0, sum(float(raw[c][i]) for c in range(ch_count)) / ch_count))
                for i in range(n)
            ]
        return [
            max(-1.0, min(1.0, sum(float(x) for x in frame) / max(1, len(frame))))
            for frame in raw
        ]
    return [max(-1.0, min(1.0, float(x))) for x in raw]


def trim_trailing_silence(
    samples: Sequence[float] | object,
    sample_rate: int,
    *,
    threshold_db: float = -42.0,
    min_keep_sec: float = 0.30,
    tail_pad_ms: int = 180,
) -> List[float]:
    """
    Recorta únicamente el silencio muerto excesivo al final del segmento,
    dejando un respiro natural (`tail_pad_ms`) para evitar cortes abruptos.
    """
    mono = _to_mono_float_list(samples)
    if not mono:
        return mono

    amp_thresh = 10.0 ** (float(threshold_db) / 20.0)
    last_active = -1
    for i in range(len(mono) - 1, -1, -1):
        if abs(mono[i]) > amp_thresh:
            last_active = i
            break

    if last_active == -1:
        return mono

    pad_samples = int((tail_pad_ms / 1000.0) * sample_rate)
    min_samples = int(min_keep_sec * sample_rate)
    end_idx = min(len(mono), max(min_samples, last_active + pad_samples))
    return mono[:end_idx]


def trim_leading_echo_artifact(
    samples: Sequence[float] | object,
    sample_rate: int,
    *,
    threshold_db: float = -38.0,
    max_artifact_sec: float = 1.25,
    min_gap_sec: float = 0.08,
    min_remaining_sec: float = 0.35,
    lead_pad_ms: int = 25,
) -> List[float]:
    """
    Detecta y elimina un artefacto aislado al inicio (típico eco de sílabas ICL
    como 'aba' o 'saba' + pausa antes de la locución real), sin recortar habla continua.
    Usa ventanas de 10 ms, umbral adaptativo respecto al volumen real de la voz,
    puenteo de cierres consonánticos internos (<= 70 ms) y detección de pausa >= `min_gap_sec`.
    """
    mono = _to_mono_float_list(samples)
    if not mono or sample_rate <= 0:
        return mono

    win_sec = 0.01  # 10 ms por ventana
    win_samples = max(1, int(win_sec * sample_rate))
    total_wins = len(mono) // win_samples
    if total_wins < 30:
        return mono

    # Medir RMS por ventana (hasta 6s para calibrar volumen real de voz)
    calib_wins = min(total_wins, int(6.0 / win_sec))
    win_rms: List[float] = []
    for w in range(calib_wins):
        start = w * win_samples
        seg = mono[start : start + win_samples]
        win_rms.append(math.sqrt(sum(x * x for x in seg) / float(len(seg))))

    nonzero = sorted(r for r in win_rms if r > 1e-4)
    if not nonzero:
        return mono

    speech_ref_rms = nonzero[int(0.85 * (len(nonzero) - 1))]
    base_thresh = 10.0 ** (float(threshold_db) / 20.0)
    # Umbral adaptativo: ~17 dB debajo de la voz real, acotado para no cortar voz suave
    rms_thresh = max(base_thresh, min(0.055, speech_ref_rms * 0.14))

    # Escanear primeros 2.8 segundos
    scan_wins = min(calib_wins, int(2.8 / win_sec))
    raw_active = [win_rms[w] >= rms_thresh for w in range(scan_wins)]

    first_active = next((idx for idx, flag in enumerate(raw_active) if flag), None)
    if first_active is None or first_active * win_sec > 0.70:
        return mono

    # Puentear micro-valles consonánticos (ej. cierre de /b/ o /p/ en 'sa-ba' <= 70 ms)
    bridged = list(raw_active)
    max_dip_wins = 7  # 70 ms
    i = 0
    while i < scan_wins:
        if bridged[i]:
            j = i + 1
            while j < scan_wins and not bridged[j] and (j - i - 1) <= max_dip_wins:
                j += 1
            if j < scan_wins and bridged[j] and (j - i - 1) <= max_dip_wins:
                for k in range(i + 1, j):
                    bridged[k] = True
                i = j
                continue
        i += 1

    # Buscar huecos de silencio >= min_gap_sec cuyo inicio acumulado desde first_active <= max_artifact_sec
    min_gap_wins = max(1, int(round(min_gap_sec / win_sec)))
    max_span_wins = int(round(max_artifact_sec / win_sec))

    candidates: List[Tuple[int, int]] = []  # (gap_len_wins, speech_start_win)
    w_idx = first_active
    while w_idx < scan_wins:
        if not bridged[w_idx]:
            gap_start = w_idx
            while w_idx < scan_wins and not bridged[w_idx]:
                w_idx += 1
            gap_end = w_idx
            gap_len = gap_end - gap_start
            span_before_gap = gap_start - first_active
            if gap_end < scan_wins and span_before_gap <= max_span_wins and gap_len >= min_gap_wins:
                # Confirmar voz sostenida después del hueco (al menos 120 ms activos en los siguientes 600 ms)
                look_ahead = raw_active[gap_end : min(scan_wins, gap_end + 60)]
                if sum(1 for f in look_ahead if f) >= 12:
                    candidates.append((gap_len, gap_end))
        else:
            w_idx += 1

    if not candidates:
        return mono

    # Elegir la pausa más clara/amplia dentro de la ventana de artefacto inicial
    _, best_speech_win = max(candidates, key=lambda item: (item[0], item[1]))
    speech_start_sample = best_speech_win * win_samples
    if len(mono) - speech_start_sample < int(min_remaining_sec * sample_rate):
        return mono

    cut_idx = max(0, speech_start_sample - int((lead_pad_ms / 1000.0) * sample_rate))
    # Buscar cruce mínimo cercano (+/- 5 ms) para evitar clic
    search_end = min(len(mono), cut_idx + int(0.005 * sample_rate))
    if search_end > cut_idx:
        cut_idx = min(range(cut_idx, search_end), key=lambda idx: abs(mono[idx]))

    out = mono[cut_idx:]
    fade_len = min(len(out) // 8, int(0.008 * sample_rate))
    for k in range(fade_len):
        out[k] *= k / float(max(1, fade_len))
    return out


def clean_generated_segment_audio(
    samples: Sequence[float] | object,
    sample_rate: int,
    *,
    trim_silence: bool = True,
    threshold_db: float = -42.0,
    strip_leading_artifact: bool = True,
) -> List[float]:
    """Limpia artefacto inicial aislado (si existe) y silencio muerto final."""
    mono = _to_mono_float_list(samples)
    if strip_leading_artifact:
        mono = trim_leading_echo_artifact(
            mono,
            sample_rate,
            threshold_db=max(-38.0, float(threshold_db) + 4.0),
        )
    if trim_silence:
        mono = trim_trailing_silence(mono, sample_rate, threshold_db=threshold_db)
    return mono


def build_silence(duration_ms: int, sample_rate: int) -> List[float]:
    if duration_ms <= 0 or sample_rate <= 0:
        return []
    count = int((duration_ms / 1000.0) * sample_rate)
    return [0.0] * max(0, count)


def prepare_clean_reference_wav(src_wav_path: Path, dest_wav_path: Path) -> Path:
    """
    Genera una copia temporal limpia del WAV de referencia (sin modificar jamás el
    archivo original en voices/) recortando silencios sucios de borde y añadiendo un
    cierre limpio de silencio para reducir arrastres fonéticos en modo ICL.
    """
    mono, sr = load_wav_mono(src_wav_path)
    if not mono:
        return src_wav_path

    # Quitar offset DC y detectar límites reales de voz
    mean_dc = sum(mono) / float(len(mono))
    centered = [max(-1.0, min(1.0, x - mean_dc)) for x in mono]

    thresh = 10.0 ** (-40.0 / 20.0)
    first_idx = next((i for i, v in enumerate(centered) if abs(v) > thresh), 0)
    last_idx = next((i for i in range(len(centered) - 1, -1, -1) if abs(centered[i]) > thresh), len(centered) - 1)

    pad_edge = int(0.025 * sr)
    trimmed = centered[max(0, first_idx - pad_edge) : min(len(centered), last_idx + pad_edge + 1)]
    if len(trimmed) < int(0.2 * sr):
        trimmed = centered

    # Fundido suave de entrada/salida (15ms / 30ms) para evitar clics de frontera
    fade_in = min(len(trimmed) // 4, int(0.015 * sr))
    for i in range(fade_in):
        trimmed[i] *= i / float(max(1, fade_in))
    fade_out = min(len(trimmed) // 4, int(0.030 * sr))
    for i in range(fade_out):
        trimmed[-1 - i] *= i / float(max(1, fade_out))

    # Margen de silencio limpio al inicio (100 ms) y al final (550 ms)
    padded = build_silence(100, sr) + trimmed + build_silence(550, sr)
    return save_wav(padded, sr, dest_wav_path)


def save_wav(samples: Sequence[float] | object, sample_rate: int, dest_path: Path) -> Path:
    """
    Guarda audio mono en formato WAV PCM 16-bit preservando el sample_rate original
    y sin aplicar compresión ni normalización destructiva.
    """
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    mono = _to_mono_float_list(samples)

    try:
        import numpy as np  # type: ignore
        import soundfile as sf  # type: ignore

        arr = np.asarray(mono, dtype=np.float32)
        sf.write(str(dest_path.resolve()), arr, int(sample_rate), subtype="PCM_16")
        return dest_path
    except ImportError:
        pass

    pcm_frames = bytearray()
    for s in mono:
        clamped = max(-1.0, min(1.0, float(s)))
        val = int(round(clamped * 32767.0))
        pcm_frames.extend(struct.pack("<h", val))

    with wave.open(str(dest_path.resolve()), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(bytes(pcm_frames))

    return dest_path


def load_wav_mono(path: Path) -> Tuple[List[float], int]:
    """Carga un archivo WAV en mono float [-1, 1] devolviendo (samples, sample_rate)."""
    try:
        import numpy as np  # type: ignore
        import soundfile as sf  # type: ignore

        data, sr = sf.read(str(path.resolve()), dtype="float32", always_2d=True)
        mono = np.mean(data, axis=1)
        return mono.tolist(), int(sr)
    except ImportError:
        pass

    with wave.open(str(path.resolve()), "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        sw = wf.getsampwidth()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    if sw != 2:
        raise ValueError(f"Se requiere soundfile para leer WAV de {sw * 8} bits: {path.name}")

    total_samples = len(raw) // 2
    unpacked = struct.unpack(f"<{total_samples}h", raw)
    if ch == 1:
        return [s / 32768.0 for s in unpacked], sr

    mono_out: List[float] = []
    for i in range(0, len(unpacked), ch):
        frame_avg = sum(unpacked[i : i + ch]) / float(ch)
        mono_out.append(frame_avg / 32768.0)
    return mono_out, sr


def get_wav_duration(path: Path) -> float:
    """Devuelve la duración en segundos de un WAV."""
    try:
        with wave.open(str(path.resolve()), "rb") as wf:
            sr = wf.getframerate()
            return round(wf.getnframes() / float(sr), 3) if sr > 0 else 0.0
    except Exception:
        try:
            import soundfile as sf  # type: ignore

            return round(float(sf.info(str(path.resolve())).duration), 3)
        except Exception:
            return 0.0


def _resample_linear(samples: List[float], src_sr: int, dst_sr: int) -> List[float]:
    if src_sr == dst_sr or not samples:
        return samples
    ratio = dst_sr / float(src_sr)
    out_len = max(1, int(round(len(samples) * ratio)))
    out: List[float] = []
    max_idx = len(samples) - 1
    for i in range(out_len):
        pos = i / ratio
        idx0 = int(math.floor(pos))
        idx1 = min(max_idx, idx0 + 1)
        frac = pos - idx0
        val = samples[idx0] * (1.0 - frac) + samples[idx1] * frac
        out.append(val)
    return out


def concatenate_wav_files(
    items: Iterable[Tuple[Path, int]],
    output_path: Path,
) -> Tuple[Path, float]:
    """
    Concatena una secuencia de (ruta_wav, pausa_despues_ms) conservando la frecuencia
    de muestreo del primer segmento y sin aplicar normalización destructiva.
    """
    items_list = list(items)
    if not items_list:
        raise ValueError("No hay archivos de audio para unir.")

    combined: List[float] = []
    target_sr: int | None = None

    for idx, (wav_path, pause_after_ms) in enumerate(items_list):
        if not wav_path.exists() or wav_path.stat().st_size <= 44:
            raise FileNotFoundError(f"Falta el segmento de audio: {wav_path.name}")

        samples, sr = load_wav_mono(wav_path)
        if target_sr is None:
            target_sr = sr
        elif sr != target_sr:
            samples = _resample_linear(samples, sr, target_sr)

        combined.extend(samples)
        if idx < len(items_list) - 1 and pause_after_ms > 0:
            combined.extend(build_silence(pause_after_ms, target_sr))

    assert target_sr is not None
    save_wav(combined, target_sr, output_path)
    return output_path, round(len(combined) / float(target_sr), 3)
