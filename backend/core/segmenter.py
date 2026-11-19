"""
Sistema de segmentación fiel por Párrafos, Escenas y Partes para guiones largos.
Conserva el orden original, respeta límites de oraciones y permite longitud
configurable desde la interfaz (~250 caracteres por defecto).
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

from backend.config import DEFAULT_MAX_CHARS
from backend.core.text_normalizer import normalize_numbers_for_tts

_SCENE_HEADER_RE = re.compile(
    r"^\s*(?:ESCENA|Escena|SCENE|Scene|CAP[ÍI]TULO|Cap[íi]tulo|PARTE|Parte)\s+(\d+)(?:\s*[—–:\-\.]\s*(.*))?\s*$",
    re.IGNORECASE,
)


def parse_paragraphs_from_script(text_input: str) -> List[Dict[str, Any]]:
    """Detecta párrafos separados por una o más líneas en blanco."""
    cleaned = text_input.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not cleaned:
        raise ValueError("El guion está vacío. Introduce texto para continuar.")

    raw_paragraphs = [p.strip() for p in re.split(r"\n\s*\n", cleaned) if p.strip()]
    if not raw_paragraphs:
        raw_paragraphs = [cleaned]

    return [
        {
            "number": idx + 1,
            "title": f"Párrafo {idx + 1}",
            "text": p_text,
        }
        for idx, p_text in enumerate(raw_paragraphs)
    ]


def parse_scenes_from_script(text_input: str) -> List[Dict[str, Any]]:
    """
    Detecta encabezados como:
      ESCENA 1 — INTRODUCCIÓN
      ESCENA 2 — DESARROLLO
      ESCENA 3 — CONCLUSIÓN
    Conserva texto introductorio previo integrándolo en la primera escena o en Introducción.
    """
    cleaned = text_input.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not cleaned:
        raise ValueError("El guion está vacío. Introduce texto para continuar.")

    lines = cleaned.split("\n")
    scenes: List[Dict[str, Any]] = []
    current: Dict[str, Any] | None = None
    pre_lines: List[str] = []

    for line in lines:
        match = _SCENE_HEADER_RE.match(line)
        if match:
            if current is not None:
                body = "\n".join(current["lines"]).strip()
                if body:
                    scenes.append({
                        "number": current["number"],
                        "title": current["title"],
                        "text": body,
                    })
            sec_num = int(match.group(1))
            sec_title = (match.group(2) or "").strip()
            current = {
                "number": sec_num,
                "title": sec_title,
                "lines": [],
            }
        else:
            if current is not None:
                current["lines"].append(line)
            elif line.strip():
                pre_lines.append(line)

    if current is not None:
        body = "\n".join(current["lines"]).strip()
        if body:
            scenes.append({
                "number": current["number"],
                "title": current["title"],
                "text": body,
            })

    if pre_lines:
        intro_text = "\n".join(pre_lines).strip()
        if not scenes:
            scenes.append({"number": 1, "title": "Escena 1", "text": intro_text})
        elif scenes[0]["number"] == 1:
            scenes[0]["text"] = f"{intro_text}\n\n{scenes[0]['text']}".strip()
        else:
            scenes.insert(0, {"number": 1, "title": "Introducción", "text": intro_text})

    if not scenes:
        scenes.append({"number": 1, "title": "Escena 1", "text": cleaned})

    for idx, s in enumerate(scenes):
        s["number"] = idx + 1
        if not s.get("title"):
            s["title"] = f"Escena {s['number']}"

    return scenes


def split_text_for_tts(text: str, max_chars: int = DEFAULT_MAX_CHARS) -> List[str]:
    """
    Divide un texto en segmentos de hasta `max_chars` caracteres respetando:
    1) Párrafos internos
    2) Límites de oraciones (. ! ? ; …)
    3) Cláusulas (, :) si una oración supera max_chars
    4) Palabras completas (nunca corta palabras arbitrariamente)
    """
    limit = max(80, int(max_chars or DEFAULT_MAX_CHARS))
    cleaned = text.strip()
    if not cleaned:
        return []

    paragraphs = [p.strip() for p in re.split(r"\n+", cleaned) if p.strip()]
    chunks: List[str] = []

    for paragraph in paragraphs:
        raw_sentences = re.findall(r'[^.!?;…\n]+(?:[.!?;…]+\s*["\'»”)]*|$)', paragraph)
        sentences = [s.strip() for s in raw_sentences if s.strip()]
        if not sentences:
            sentences = [paragraph]

        if len(sentences) == 1 and len(paragraph) <= limit:
            chunks.append(paragraph)
            continue

        current_chunk = ""
        for sentence in sentences:
            if len(sentence) > limit:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                    current_chunk = ""

                # Intentar dividir por cláusulas (comas / dos puntos)
                clauses = [c.strip() for c in re.split(r"(?<=[,:])\s+", sentence) if c.strip()]
                if len(clauses) > 1:
                    clause_buf = ""
                    for cl in clauses:
                        if len(cl) > limit:
                            if clause_buf:
                                chunks.append(clause_buf.strip())
                                clause_buf = ""
                            chunks.extend(_split_by_words(cl, limit))
                            continue
                        cand = f"{clause_buf} {cl}".strip() if clause_buf else cl
                        if len(cand) <= limit:
                            clause_buf = cand
                        else:
                            if clause_buf:
                                chunks.append(clause_buf.strip())
                            clause_buf = cl
                    if clause_buf:
                        current_chunk = clause_buf
                else:
                    word_parts = _split_by_words(sentence, limit)
                    chunks.extend(word_parts[:-1])
                    current_chunk = word_parts[-1] if word_parts else ""
                continue

            candidate = f"{current_chunk} {sentence}".strip() if current_chunk else sentence
            if len(candidate) <= limit:
                current_chunk = candidate
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = sentence

        if current_chunk:
            chunks.append(current_chunk.strip())

    return chunks


def _split_by_words(text: str, limit: int) -> List[str]:
    words = text.split()
    out: List[str] = []
    buf = ""
    for w in words:
        cand = f"{buf} {w}".strip() if buf else w
        if len(cand) <= limit:
            buf = cand
        else:
            if buf:
                out.append(buf)
            buf = w
    if buf:
        out.append(buf)
    return out


def segment_script(
    script_text: str,
    processing_mode: str = "scene",
    language: str = "Spanish",
    max_chars: int = DEFAULT_MAX_CHARS,
) -> List[Dict[str, Any]]:
    """
    Segmenta el guion completo conservando 1:1 cada parte visible con su
    equivalente normalizado fonéticamente para Qwen3-TTS.
    """
    if processing_mode == "paragraph":
        raw_sections = parse_paragraphs_from_script(script_text)
    else:
        raw_sections = parse_scenes_from_script(script_text)

    structured: List[Dict[str, Any]] = []
    for sec in raw_sections:
        raw_parts = split_text_for_tts(sec["text"], max_chars=max_chars)
        parts = []
        for idx, raw_p in enumerate(raw_parts):
            norm_p = normalize_numbers_for_tts(raw_p, language)
            parts.append({
                "number": idx + 1,
                "text": raw_p,
                "normalized_text": norm_p,
            })

        structured.append({
            "number": sec["number"],
            "title": sec["title"],
            "text": sec["text"],
            "normalized_text": normalize_numbers_for_tts(sec["text"], language),
            "parts": parts,
        })

    return structured
