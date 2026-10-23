"""Entrena el modelo filtro del generador con vuestras marcas de «pregunta mala».

Uso (desde la carpeta raíz del proyecto):
    py analisis/entrenar_filtro.py [--datos analisis/datos]

Necesita preguntas con puntuación del juez (py generador/juez.py --banco) y datos de partidas.
Escribe generador/filtro.json, que generador/generar.py usa en lugar de los umbrales fijos.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from calibracion import RAIZ, calibrar, leer_config
from modelo_filtro import CARACTERISTICAS, caracteristicas_juez, entrenar_logistica_ridge, etiquetas_filtro, prob_mala

MIN_EJEMPLOS = 40
MIN_POR_CLASE = 8


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--datos", type=Path, default=RAIZ / "analisis" / "datos", help="carpeta con las exportaciones")
    args = ap.parse_args(argv)

    config = leer_config(RAIZ)
    res = calibrar(RAIZ, args.datos)
    ids, X = caracteristicas_juez(RAIZ, config)
    if not ids:
        print("Ninguna pregunta tiene puntuación del juez. Ejecuta antes:  py generador/juez.py --banco")
        return 0
    etiquetas = etiquetas_filtro(res)
    con = [i for i, q in enumerate(ids) if etiquetas.get(q) is not None]
    X = X[con]
    y = np.array([etiquetas[ids[i]] for i in con])
    malas, buenas = int(np.sum(y == 1)), int(np.sum(y == 0))
    print(f"Ejemplos con puntuación y etiqueta: {len(y)} ({malas} malas, {buenas} buenas)")
    if len(y) < MIN_EJEMPLOS or malas < MIN_POR_CLASE or buenas < MIN_POR_CLASE:
        print(f"Aún no hay datos suficientes (hacen falta {MIN_EJEMPLOS} ejemplos y {MIN_POR_CLASE} de cada clase). "
              "El generador seguirá usando los umbrales del juez.")
        return 0

    modelo = entrenar_logistica_ridge(X, y)
    p = prob_mala(modelo, X)
    print(f"Acierto en los propios datos: {100 * np.mean((p > 0.5) == (y == 1)):.0f} %")
    print("Pesos (sobre características estandarizadas; positivo = más probable que sea mala):")
    for nombre, peso in zip(CARACTERISTICAS, modelo["pesos"]):
        print(f"  {nombre}: {peso:+.2f}")

    salida = {
        "formato": 1,
        "entrenado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "n": len(y), "n_malas": malas,
        "caracteristicas": CARACTERISTICAS,
        "intercepto": modelo["intercepto"],
        "pesos": [float(x) for x in modelo["pesos"]], "medias": [float(x) for x in modelo["medias"]],
        "desviaciones": [float(x) for x in modelo["desviaciones"]],
        "umbral": 0.5,
    }
    (RAIZ / "generador" / "filtro.json").write_text(json.dumps(salida, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Modelo escrito en generador/filtro.json")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(principal())
