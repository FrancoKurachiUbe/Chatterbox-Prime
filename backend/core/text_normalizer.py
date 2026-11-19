"""
Normalización fonética de números y símbolos en español para síntesis TTS.
Mantiene intacto el texto original visible en el editor y en los paneles.
"""

from __future__ import annotations

import re

_UNITS = [
    "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"
]
_TEENS = {
    10: "diez", 11: "once", 12: "doce", 13: "trece", 14: "catorce",
    15: "quince", 16: "dieciséis", 17: "diecisiete", 18: "dieciocho", 19: "diecinueve",
}
_TWENTIES = {
    20: "veinte", 21: "veintiuno", 22: "veintidós", 23: "veintitrés", 24: "veinticuatro",
    25: "veinticinco", 26: "veintiséis", 27: "veintisiete", 28: "veintiocho", 29: "veintinueve",
}
_TENS = {
    30: "treinta", 40: "cuarenta", 50: "cincuenta",
    60: "sesenta", 70: "setenta", 80: "ochenta", 90: "noventa",
}
_HUNDREDS = {
    100: "cien", 200: "doscientos", 300: "trescientos", 400: "cuatrocientos",
    500: "quinientos", 600: "seiscientos", 700: "setecientos", 800: "ochocientos",
    900: "novecientos",
}


def number_to_spanish(n: int) -> str:
    """Convierte un entero a palabras en español natural."""
    if n < 0:
        return f"menos {number_to_spanish(abs(n))}"
    if n < 10:
        return _UNITS[n]
    if n in _TEENS:
        return _TEENS[n]
    if n in _TWENTIES:
        return _TWENTIES[n]
    if n < 100:
        tens = (n // 10) * 10
        units = n % 10
        if units == 0:
            return _TENS[tens]
        return f"{_TENS[tens]} y {_UNITS[units]}"
    if n < 1000:
        hundreds = (n // 100) * 100
        remainder = n % 100
        if n == 100:
            return "cien"
        prefix = "ciento" if hundreds == 100 else _HUNDREDS[hundreds]
        if remainder == 0:
            return prefix
        return f"{prefix} {number_to_spanish(remainder)}"
    if n < 2000:
        remainder = n % 1000
        return "mil" if remainder == 0 else f"mil {number_to_spanish(remainder)}"
    if n < 1_000_000:
        thousands = n // 1000
        remainder = n % 1000
        base = f"{number_to_spanish(thousands)} mil"
        return base if remainder == 0 else f"{base} {number_to_spanish(remainder)}"
    if n < 1_000_000_000:
        millions = n // 1_000_000
        remainder = n % 1_000_000
        head = "un millón" if millions == 1 else f"{number_to_spanish(millions)} millones"
        return head if remainder == 0 else f"{head} {number_to_spanish(remainder)}"
    return str(n)


def normalize_numbers_for_tts(text: str, language: str = "Spanish") -> str:
    """
    Convierte números (enteros, decimales y porcentajes) a palabras en español
    para evitar pronunciación errática en TTS. No altera el texto para otros idiomas.
    """
    lang_norm = (language or "").strip().lower()
    if lang_norm not in ("spanish", "es", "español"):
        return text

    # Porcentajes: 45% -> cuarenta y cinco por ciento
    def _replace_percent(m: re.Match) -> str:
        num_str = m.group(1)
        return f"{_normalize_numeric_token(num_str)} por ciento"

    def _normalize_numeric_token(token: str) -> str:
        if "." in token or "," in token:
            sep = "." if "." in token else ","
            parts = token.split(sep, 1)
            if parts[0].isdigit() and parts[1].isdigit() and len(parts[0]) <= 9:
                word_sep = "punto" if sep == "." else "coma"
                left = number_to_spanish(int(parts[0]))
                # Si la parte decimal tiene ceros a la izquierda (ej. 05), leer dígito por dígito
                if parts[1].startswith("0") and len(parts[1]) > 1:
                    right = " ".join(_UNITS[int(ch)] for ch in parts[1])
                else:
                    right = number_to_spanish(int(parts[1])) if len(parts[1]) <= 6 else parts[1]
                return f"{left} {word_sep} {right}"
            return token
        if token.isdigit() and len(token) <= 9:
            return number_to_spanish(int(token))
        return token

    out = re.sub(r"\b(\d+(?:[.,]\d+)?)\s*%", _replace_percent, text)
    out = re.sub(r"\b\d+(?:[.,]\d+)?\b", lambda m: _normalize_numeric_token(m.group(0)), out)
    return out
