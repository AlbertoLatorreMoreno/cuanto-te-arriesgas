"""Filtro de candidatas.

Mientras no haya datos suficientes, usa umbrales sobre las puntuaciones del juez.
Cuando `analisis/entrenar_filtro.py` haya escrito `generador/filtro.json`, usa esa
regresión logística (entrenada con vuestras marcas de «pregunta mala») para estimar
la probabilidad de que una pregunta sea mala.

Las características se calculan solo aquí: el entrenamiento (analisis/modelo_filtro.py) usa estas mismas funciones.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

UMBRALES = {"exactitud_min": 4, "ambiguedad_max": 2, "claridad_min": 4, "desvio_nivel_max": 2}
CARACTERISTICAS = ["exactitud", "ambiguedad", "claridad", "desvio_nivel", "longitud", "numerica"]


def es_numerica(respuesta: str) -> int:
    """1 si la respuesta empieza por un número, admitiendo el signo menos tipográfico «−» del banco."""
    return 1 if re.match(r"^\s*[-\u2212]?\d", respuesta) else 0


def caracteristicas(p: dict) -> dict:
    j = p["juez"]
    return {
        "exactitud": j["exactitud"],
        "ambiguedad": j["ambiguedad"],
        "claridad": j["claridad"],
        "desvio_nivel": abs(j["nivel_estimado"] - p["nivel"]),
        "longitud": len(p["pregunta"]) / 100,
        "numerica": es_numerica(p["respuesta"]),
    }


def cargar_modelo(ruta: Path) -> dict | None:
    if not ruta.exists():
        return None
    modelo = json.loads(ruta.read_text(encoding="utf-8"))
    if modelo.get("formato") != 1 or modelo.get("caracteristicas") != CARACTERISTICAS:
        raise ValueError(f"{ruta.name} no es compatible con esta versión del generador")
    return modelo


def prob_mala(p: dict, modelo: dict) -> float:
    x = caracteristicas(p)
    z = modelo["intercepto"]
    for nombre, peso, media, sd in zip(CARACTERISTICAS, modelo["pesos"], modelo["medias"], modelo["desviaciones"]):
        z += peso * (x[nombre] - media) / (sd or 1)
    return 1 / (1 + math.exp(-z))


def evaluar(p: dict, modelo: dict | None) -> tuple[bool, str]:
    """(pasa, motivo). Exige que la pregunta tenga puntuaciones del juez."""
    if not p.get("juez"):
        return False, "sin valoración del juez"
    if modelo:
        prob = prob_mala(p, modelo)
        if prob > modelo["umbral"]:
            return False, f"el modelo filtro estima un {prob:.0%} de probabilidad de que sea mala"
        return True, f"probabilidad de ser mala: {prob:.0%}"
    x = caracteristicas(p)
    if x["exactitud"] < UMBRALES["exactitud_min"]:
        return False, f"exactitud {x['exactitud']}/5"
    if x["ambiguedad"] > UMBRALES["ambiguedad_max"]:
        return False, f"ambigüedad {x['ambiguedad']}/5"
    if x["claridad"] < UMBRALES["claridad_min"]:
        return False, f"claridad {x['claridad']}/5"
    if x["desvio_nivel"] > UMBRALES["desvio_nivel_max"]:
        return False, f"el juez la ve de nivel {p['juez']['nivel_estimado']}, no {p['nivel']}"
    return True, "pasa los umbrales del juez"
