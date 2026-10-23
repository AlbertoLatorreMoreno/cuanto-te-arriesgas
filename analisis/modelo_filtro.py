"""Modelo filtro del generador (fase 6): regresión logística con penalización ridge que estima la
probabilidad de que una pregunta sea mala a partir de las puntuaciones del juez IA.

Las características son las de `generador/filtro.py`, que es quien aplica el modelo: así solo hay
una forma de calcularlas.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

from calibracion import RAIZ, Resultado, contar, leer_json, log1pexp


def _cargar_filtro_del_generador():
    spec = importlib.util.spec_from_file_location("filtro_del_generador", RAIZ / "generador" / "filtro.py")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


filtro_generador = _cargar_filtro_del_generador()
CARACTERISTICAS = filtro_generador.CARACTERISTICAS


def caracteristicas_de(preguntas: list[dict]) -> tuple[list[str], np.ndarray]:
    """Ids y matriz de características de las preguntas con puntuación del juez (las demás se saltan)."""
    con_juez = [p for p in preguntas if p.get("juez")]
    filas = [[filtro_generador.caracteristicas(p)[c] for c in CARACTERISTICAS] for p in con_juez]
    return [p["id"] for p in con_juez], np.array(filas, dtype=float).reshape(len(filas), len(CARACTERISTICAS))


def caracteristicas_juez(raiz: Path, config: dict) -> tuple[list[str], np.ndarray]:
    preguntas = [p for cat in config["categorias"] for p in leer_json(raiz / "app" / cat["archivo"])["preguntas"]]
    return caracteristicas_de(preguntas)


def etiquetas_filtro(res: Resultado) -> dict[str, int | None]:
    """1 = mala (retirada o marcada), 0 = buena (jugada al menos una vez y sin marcas), None = sin datos."""
    marcadas = {m["pregunta"] for m in res.datos.marcas} | set(res.ajustes["retiradas"])
    jugadas = contar([x["q"] for x in res.datos.respuestas], len(res.banco))
    return {q: (1 if q in marcadas else 0 if jugadas[i] > 0 else None) for i, q in enumerate(res.banco.id)}


def entrenar_logistica_ridge(X: np.ndarray, y: np.ndarray, lambda_: float = 1.0) -> dict:
    X, y = np.asarray(X, dtype=float), np.asarray(y, dtype=float)
    medias = X.mean(axis=0)
    sds = X.std(axis=0, ddof=1) if len(X) > 1 else np.ones(X.shape[1])
    sds[~np.isfinite(sds) | (sds == 0)] = 1.0
    Z = (X - medias) / sds

    def objetivo(b):
        eta = b[0] + Z @ b[1:]
        return float(np.sum(log1pexp(eta) - y * eta) + lambda_ / 2 * np.sum(b[1:] ** 2))

    def gradiente(b):
        r = expit(b[0] + Z @ b[1:]) - y
        return np.concatenate([[np.sum(r)], Z.T @ r + lambda_ * b[1:]])

    opt = minimize(objetivo, np.zeros(X.shape[1] + 1), jac=gradiente, method="BFGS", options={"gtol": 1e-8})
    return {"intercepto": float(opt.x[0]), "pesos": opt.x[1:], "medias": medias, "desviaciones": sds}


def prob_mala(modelo: dict, X: np.ndarray) -> np.ndarray:
    Z = (np.asarray(X, dtype=float) - modelo["medias"]) / modelo["desviaciones"]
    return expit(modelo["intercepto"] + Z @ np.asarray(modelo["pesos"]))
