"""Calibración de «¿Cuánto te arriesgas?» (antes en R, en funciones.R).

Modelo de nivel (regresión logística conjunta y penalizada):

    nivel_verdadero(q) = nivel_inicial(q) + global + categoría(q) + pregunta(q)

    Aciertos:      logit P(acierto) = habilidad(jugador) + logit(p_objetivo(nivel_verdadero))
    Valoraciones:  regresión logística ordinal (más fácil < sí < más difícil) con umbrales
                   en nivel_mostrado ± 0,5 y escala s, sobre el nivel percibido
                   = nivel_verdadero + sesgo(evaluador) + b_fallo·falló + b_revision·revisión

La escala s (ruido de las valoraciones) es fija por defecto (modelo.escala_valoracion). Con una
valoración por pregunta no se puede estimar: el ajuste de cada pregunta «explica» su valoración y
s se hunde hacia 0, con lo que una sola valoración movería un nivel entero. Se puede estimar
poniendo modelo.sd_log_escala_valoracion > 0 cuando las preguntas tengan varias valoraciones.

Todo se ajusta a la vez por máxima verosimilitud penalizada (L2), con gradiente analítico.
Usa numpy y scipy.
"""

from __future__ import annotations

import json
import math
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit, logit

RAIZ = Path(__file__).resolve().parent.parent
TIPOS_PREGUNTA = ("respuesta", "revision", "anulacion")


def _avisar(mensaje: str):
    print(f"Aviso: {mensaje}", file=sys.stderr)


def _entero(x):
    """Como `as.integer` de R: el número entero, o None si falta o no se entiende."""
    if x is None or isinstance(x, bool):
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return int(f) if math.isfinite(f) else None


# ------------------------------------------------------------------ lectura

def leer_json(ruta: Path):
    return json.loads(Path(ruta).read_text(encoding="utf-8-sig"))


def leer_config(raiz: Path = RAIZ) -> dict:
    return leer_json(raiz / "app" / "data" / "config.json")


@dataclass
class Banco:
    id: list[str]
    v: np.ndarray
    categoria: list[str]
    subtema: list[str]
    nivel: np.ndarray
    posicion: dict[str, int] = field(default_factory=dict)

    def __post_init__(self):
        self.posicion = {q: i for i, q in enumerate(self.id)}

    def __len__(self):
        return len(self.id)


def categorias_del_banco(config: dict) -> list[dict]:
    """Las categorías del tablero y los temas que elige cada jugador (config.temas): para el modelo, un tema es
    una categoría más, con su propio ajuste."""
    return config["categorias"] + config.get("temas", {}).get("lista", [])


def leer_banco(raiz: Path, config: dict) -> Banco:
    # Un tema cuyo archivo aún no existe no tiene preguntas: no impide calibrar el resto.
    archivos = [raiz / "app" / cat["archivo"] for cat in categorias_del_banco(config)]
    preguntas = [p for ruta in archivos if ruta.exists() for p in leer_json(ruta)["preguntas"]]
    return Banco(id=[p["id"] for p in preguntas], v=np.array([int(p["v"]) for p in preguntas]),
                 categoria=[p["categoria"] for p in preguntas], subtema=[p["subtema"] for p in preguntas],
                 nivel=np.array([int(p["nivel"]) for p in preguntas]))


def leer_ajustes(raiz: Path) -> dict:
    ruta = raiz / "app" / "data" / "ajustes.json"
    return leer_json(ruta) if ruta.exists() else {"niveles": {}, "retiradas": {}}


@dataclass
class Exportaciones:
    registros: list[dict]
    n_archivos: int
    n_duplicados: int
    ignorados: dict[str, str]


def leer_exportaciones(carpeta: Path, avisar=_avisar) -> Exportaciones:
    """Lee todas las exportaciones (.json) de una carpeta y elimina duplicados por id. Un archivo que no se
    puede leer (cortado al descargarlo o al copiarlo) o que no es de la app se ignora con un aviso, en vez
    de parar toda la calibración, y queda en `ignorados` (archivo → motivo) para el informe."""
    carpeta = Path(carpeta)
    archivos = sorted((p for p in carpeta.rglob("*") if p.is_file() and p.name.endswith(".json")), key=lambda p: str(p)) if carpeta.exists() else []
    ignorados: dict[str, str] = {}

    def ignorar(ruta: Path, motivo: str):
        avisar(f"Ignoro {ruta.name}: {motivo}")
        ignorados[ruta.name] = motivo

    registros: list[dict] = []
    for ruta in archivos:
        try:
            x = leer_json(ruta)
        except (ValueError, UnicodeDecodeError):
            ignorar(ruta, "no se puede leer (¿está cortado o no es JSON?).")
            continue
        if not isinstance(x, dict) or x.get("app") != "cuanto-te-arriesgas" or _entero(x.get("formato")) != 1:
            ignorar(ruta, "no es una exportación de la app (formato 1).")
            continue
        r = x.get("registros")
        if not isinstance(r, list) or not r or not all(isinstance(reg, dict) for reg in r):
            continue
        registros += [{**reg, "archivo": ruta.name} for reg in r]
    vistos: set = set()
    unicos = []
    for reg in registros:
        if reg.get("id") in vistos:
            continue
        vistos.add(reg.get("id"))
        unicos.append(reg)
    return Exportaciones(unicos, len(archivos), len(registros) - len(unicos), ignorados)


# ------------------------------------------------------------------ preparación

def cortes_valoracion(valoracion: str | None, L: int | None, desde, hasta, rango: dict):
    """Entre qué cortes cae el nivel que percibe quien valora. Con el nivel mostrado L: «más fácil» es
    (−∞, L − 0,5); «sí, encaja», (L − 0,5, L + 0,5), y «más difícil», (L + 0,5, +∞). Una horquilla «entre
    a y b» (modo revisión) es (a − 0,5, b + 0,5), abierta por abajo si a es el nivel mínimo y por arriba si
    b es el máximo: «de 1 a L − 1» equivale a «más fácil». Inválida: (None, None)."""
    if valoracion in ("facil", "justa", "dificil") and L is None:
        return None, None
    if valoracion == "facil":
        return -math.inf, L - 0.5
    if valoracion == "justa":
        return L - 0.5, L + 0.5
    if valoracion == "dificil":
        return L + 0.5, math.inf
    if valoracion == "horquilla" and desde is not None and hasta is not None and rango["min"] <= desde <= hasta <= rango["max"]:
        return (-math.inf if desde <= rango["min"] else desde - 0.5), (math.inf if hasta >= rango["max"] else hasta + 0.5)
    return None, None


_RE_TS = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)")


def instante(ts) -> float | None:
    """Instante de un `ts` (ISO 8601 en UTC) en segundos, para ordenar registros. None si falta o no se entiende."""
    m = _RE_TS.match(ts) if isinstance(ts, str) else None
    if not m:
        return None
    try:
        base = datetime(*(int(g) for g in m.groups()[:5]), tzinfo=timezone.utc)
    except ValueError:
        return None
    return base.timestamp() + float(m.group(6))


def vista_antes(registros: list[dict]) -> list[bool]:
    """Para cada registro, si su `jugador` ya había visto esa pregunta (misma `pregunta` y misma `v`) en un
    registro anterior (`ts` estrictamente menor) de cualquier exportación: como `jugador` (la respondió o
    se la anularon), como `lector` o como `evaluador`. Es lo mismo que la app apunta en `cta.vistas`, pero
    sin depender del móvil: vale aunque se haya olvidado al jugador o haya jugado en otro móvil."""
    clave = [(r.get("pregunta"), _entero(r.get("v"))) for r in registros]
    t = [instante(r.get("ts")) for r in registros]
    primera: dict = {}
    for r, k, tr in zip(registros, clave, t):
        if tr is None:
            continue
        for campo in ("jugador", "lector", "evaluador"):
            quien = r.get(campo)
            if quien is not None:
                c = (quien, k)
                primera[c] = min(primera.get(c, tr), tr)
    salida = []
    for r, k, tr in zip(registros, clave, t):
        jugador = r.get("jugador")
        antes = primera.get((jugador, k)) if jugador is not None else None
        salida.append(jugador is not None and tr is not None and antes is not None and antes < tr)
    return salida


@dataclass
class Datos:
    respuestas: list[dict]
    valoraciones: list[dict]
    marcas: list[dict]
    descartes: dict[str, int]
    n_registros: int


def _logico(x):
    return None if x is None else bool(x)


def preparar_datos(registros: list[dict], banco: Banco, config: dict) -> Datos:
    descartes = {"pregunta_desconocida": 0, "version_antigua": 0, "repetida": 0, "vista_antes": 0}
    if not registros:
        return Datos([], [], [], descartes, 0)
    ya_vista = vista_antes(registros)
    r = []
    for reg, vista in zip(registros, ya_vista):
        # Solo los registros de preguntas: los de las rondas (y los de un tipo desconocido) van aparte y no
        # cuentan como «pregunta que ya no existe».
        if reg.get("tipo") not in TIPOS_PREGUNTA:
            continue
        q = banco.posicion.get(reg.get("pregunta"))
        if q is None:
            descartes["pregunta_desconocida"] += 1
            continue
        v = _entero(reg.get("v"))
        # Sin versión o con otra versión: no se mezclan datos de dos textos distintos.
        if v is None or v != banco.v[q]:
            descartes["version_antigua"] += 1
            continue
        r.append({**reg, "q": q, "ya_vista": vista})

    resp = []
    for x in r:
        if x.get("tipo") != "respuesta" or x.get("acierto") is None:
            continue
        # Si quien responde ya había visto la pregunta (quizá la leyó con la respuesta a la vista), ni su
        # acierto ni su valoración dicen nada de la dificultad: no entran en el modelo. Sus marcas de calidad
        # sí cuentan (se toman de `r`, más abajo). La app lo marca (alternativa «repetida») cuando tiene que
        # repetir, pero solo sabe lo visto en ese móvil y lo olvida al olvidar al jugador; por eso también
        # se busca en los registros anteriores (`vista_antes`). Cada respuesta se cuenta en un solo motivo.
        if x.get("alternativa") == "repetida":
            descartes["repetida"] += 1
        elif x["ya_vista"]:
            descartes["vista_antes"] += 1
        else:
            resp.append(x)
    # Pregunta de mapa: el acierto se recalcula con la zona de acierto actual (`config.mapa.acierto_fraccion`),
    # para que las respuestas jugadas con otra zona (hasta el 26 de octubre, la mitad) digan lo mismo que las nuevas.
    fraccion = (config.get("mapa") or {}).get("acierto_fraccion", 0.75)
    for x in resp:
        d, maxima = x.get("distancia_km"), x.get("distancia_max_km")
        if isinstance(d, (int, float)) and isinstance(maxima, (int, float)):
            x["acierto"] = d < maxima * fraccion

    # `cronometro`: segundos que hubo para responder (None si la pregunta no llevaba); solo para el informe.
    respuestas = [{"q": x["q"], "jugador": x.get("jugador"), "y": int(bool(x["acierto"])), "nivel": _entero(x.get("nivel_mostrado")),
                   "apuesta": _entero(x.get("apuesta")), "es_final": bool(x.get("es_final") or False),
                   "cronometro": _entero(x.get("cronometro")), "tiempo_agotado": _logico(x.get("tiempo_agotado"))} for x in resp]

    def valoracion(x, evaluador, fallo, rev):
        L = _entero(x.get("nivel_mostrado"))
        ci, cs = cortes_valoracion(x.get("valoracion"), L, _entero(x.get("nivel_desde")), _entero(x.get("nivel_hasta")), config["niveles"])
        if ci is None:
            return None
        return {"q": x["q"], "evaluador": evaluador, "L": L, "c_inf": ci, "c_sup": cs, "horquilla": x.get("valoracion") == "horquilla",
                "fallo": fallo, "rev": rev}

    valoraciones = [valoracion(x, x.get("jugador"), int(not bool(x["acierto"])), 0) for x in resp if x.get("valoracion") is not None]
    valoraciones += [valoracion(x, x.get("evaluador"), 0, 1) for x in r if x.get("tipo") == "revision" and x.get("valoracion") is not None]
    valoraciones = [x for x in valoraciones if x is not None]

    # Marcas de calidad: «pregunta mala» en partida o revisión, y anulaciones por calidad.
    calidad = {m["id"] for m in config["motivos_anulacion"] if m.get("calidad")}
    marcas = [{"pregunta": x["pregunta"], "quien": f"partida:{x.get('partida')}", "motivo": x["mala"]}
              for x in r if x.get("tipo") == "respuesta" and x.get("mala") is not None]
    marcas += [{"pregunta": x["pregunta"], "quien": f"evaluador:{x.get('evaluador')}", "motivo": x["mala"]}
               for x in r if x.get("tipo") == "revision" and x.get("mala") is not None]
    marcas += [{"pregunta": x["pregunta"], "quien": f"partida:{x.get('partida')}", "motivo": x["motivo"]}
               for x in r if x.get("tipo") == "anulacion" and x.get("motivo") in calidad]
    return Datos(respuestas, valoraciones, marcas, descartes, len(registros))


# ------------------------------------------------------------------ modelo

def log1pexp(x):
    return np.where(x > 35, x, np.log1p(np.exp(np.minimum(x, 35))))


def log_plogis(x):
    """log(plogis(x)), estable también en las colas."""
    return -np.logaddexp(0.0, -x)


def contar(indices, n: int) -> np.ndarray:
    """Cuántas veces aparece cada índice 0..n-1."""
    indices = np.asarray(indices, dtype=int)
    return np.bincount(indices, minlength=n) if indices.size else np.zeros(n, dtype=int)


def suma_por(indices, valores, n: int) -> np.ndarray:
    indices = np.asarray(indices, dtype=int)
    if not indices.size:
        return np.zeros(n)
    return np.bincount(indices, weights=np.asarray(valores, dtype=float), minlength=n)


K_SUAVE = 4.0


def suave(x, lo, hi):
    """Recorte suave del nivel a [lo, hi]: casi la identidad dentro y saturado fuera."""
    def sp(z):
        kz = K_SUAVE * z
        return np.where(kz > 30, z, np.log1p(np.exp(np.minimum(kz, 30))) / K_SUAVE)
    return lo + sp(x - lo) - sp(x - hi)


def dsuave(x, lo, hi):
    return expit(K_SUAVE * (x - lo)) - expit(K_SUAVE * (x - hi))


def log_prob_valoracion(U, s, ci, cs, derivadas: bool = False):
    """Log-probabilidad de cada valoración: el nivel percibido (logístico, centrado en U y de escala s) cae
    entre los cortes ci y cs, que pueden ser infinitos. Con `derivadas`, también las de U y s."""
    U, ci, cs = np.asarray(U, dtype=float), np.asarray(ci, dtype=float), np.asarray(cs, dtype=float)
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        zi = (ci - U) / s
        zs = (cs - U) / s
        abajo = np.isinf(ci)  # abierta por abajo: P = F(zs)
        arriba = np.isinf(cs)  # abierta por arriba: P = 1 - F(zi)

        def resta(la, lb):  # log(e^la - e^lb), con la > lb
            return la + np.log1p(-np.minimum(np.exp(lb - la), 1 - 1e-15))

        lFs = log_plogis(zs)
        l1mFi = log_plogis(-zi)
        # Con los dos cortes por encima de U se restan las colas de arriba, que no se redondean a 1.
        lp = np.where(abajo & arriba, 0.0, np.where(abajo, lFs, np.where(arriba, l1mFi,
                      np.where(zi > 0, resta(l1mFi, log_plogis(-zs)), resta(lFs, log_plogis(zi))))))
        if not derivadas:
            return lp
        Fi = expit(zi)
        Fs = expit(zs)
        fi = Fi * (1 - Fi)
        fs = Fs * (1 - Fs)
        P = np.maximum(Fs - Fi, 1e-300)
        zi0 = np.where(abajo, 0.0, zi)
        zs0 = np.where(arriba, 0.0, zs)
        dU = np.where(abajo & arriba, 0.0, np.where(abajo, -(1 - Fs) / s, np.where(arriba, Fi / s, -(fs - fi) / (s * P))))
        ds = np.where(abajo & arriba, 0.0, np.where(abajo, -(1 - Fs) * zs0 / s, np.where(arriba, Fi * zi0 / s, -(fs * zs0 - fi * zi0) / (s * P))))
    return lp, dU, ds


class TablaObjetivo:
    """Probabilidad de acierto de un jugador medio según la tabla objetivo (lineal a trozos)."""

    def __init__(self, config: dict):
        self.obj = np.array(config["objetivo_acierto"], dtype=float)
        self.pend = np.diff(self.obj)

    def _segmento(self, t):
        return np.clip(np.floor(t), 1, len(self.obj) - 1).astype(int)

    def p(self, t):
        i = self._segmento(t)
        return np.clip(self.obj[i - 1] + self.pend[i - 1] * (t - i), 1e-4, 1 - 1e-4)

    def dp(self, t):
        return self.pend[self._segmento(t) - 1]


K_CENTRO = 10.0  # obliga a que la habilidad media sea 0: el «jugador medio» es el del grupo


class Modelo:
    def __init__(self, datos: Datos, banco: Banco, config: dict):
        m = config["modelo"]
        self.lo, self.hi = m["nivel_suave_min"], m["nivel_suave_max"]
        self.tabla = TablaObjetivo(config)
        self.categorias = [c["id"] for c in categorias_del_banco(config)]
        self.cat_q = np.array([self.categorias.index(c) for c in banco.categoria])
        self.n0 = banco.nivel.astype(float)
        Q, C = len(banco), len(self.categorias)
        resp, val = datos.respuestas, datos.valoraciones
        self.jugadores = sorted({x["jugador"] for x in resp})
        self.evaluadores = sorted({x["evaluador"] for x in val})
        J, E = len(self.jugadores), len(self.evaluadores)
        self.Q, self.C, self.J, self.E = Q, C, J, E

        self.qA = np.array([x["q"] for x in resp], dtype=int)
        self.jA = np.array([self.jugadores.index(x["jugador"]) for x in resp], dtype=int)
        self.yA = np.array([x["y"] for x in resp], dtype=float)
        self.qB = np.array([x["q"] for x in val], dtype=int)
        self.eB = np.array([self.evaluadores.index(x["evaluador"]) for x in val], dtype=int)
        self.ciB = np.array([x["c_inf"] for x in val], dtype=float)
        self.csB = np.array([x["c_sup"] for x in val], dtype=float)
        self.falloB = np.array([x["fallo"] for x in val], dtype=float)
        self.revB = np.array([x["rev"] for x in val], dtype=float)

        self.sd_h = m["sd_habilidad"]
        self.sd_g = m.get("sd_ajuste_global", 1.5)
        # Un tema solo lo responde quien lo elige (un fan): su desvío puede ser mayor que el de una categoría.
        temas = {t["id"] for t in config.get("temas", {}).get("lista", [])}
        self.sd_c = np.array([m.get("sd_ajuste_tema", m["sd_ajuste_categoria"]) if c in temas else m["sd_ajuste_categoria"]
                              for c in self.categorias], dtype=float)
        self.sd_d = m["sd_ajuste_pregunta"]
        self.sd_e = m["sd_evaluador"]
        self.sd_b = m["sd_efectos_valoracion"]
        self.ls0 = math.log(m.get("escala_valoracion", 1.5))
        self.sd_ls = m.get("sd_log_escala_valoracion", 0) or 0
        self.estimar_ls = self.sd_ls > 0

        tam = [("theta", J), ("global", 1), ("cat", C), ("d", Q), ("rho", E), ("beta", 1), ("gamma", 1), ("ls", int(self.estimar_ls))]
        self.trozos, inicio = {}, 0
        for nombre, n in tam:
            self.trozos[nombre] = slice(inicio, inicio + n)
            inicio += n
        self.inicial = np.zeros(inicio)
        if self.estimar_ls:
            self.inicial[self.trozos["ls"]] = self.ls0
        self.indices_d = np.arange(self.trozos["d"].start, self.trozos["d"].stop)

    def desempaquetar(self, par) -> dict:
        u = {k: par[s] for k, s in self.trozos.items()}
        u["global"], u["beta"], u["gamma"] = float(u["global"][0]), float(u["beta"][0]), float(u["gamma"][0])
        u["ls"] = float(u["ls"][0]) if self.estimar_ls else self.ls0
        return u

    def niveles(self, u: dict):
        t = self.n0 + u["global"] + u["cat"][self.cat_q] + u["d"]
        return t, suave(t, self.lo, self.hi), dsuave(t, self.lo, self.hi)

    def _U(self, u, ts):
        return ts[self.qB] + u["rho"][self.eB] + u["beta"] * self.falloB + u["gamma"] * self.revB

    def objetivo(self, par) -> float:
        u = self.desempaquetar(par)
        _, ts, _ = self.niveles(u)
        lp = logit(self.tabla.p(ts))
        eta = u["theta"][self.jA] + lp[self.qA]
        nll_a = float(np.sum(log1pexp(eta) - self.yA * eta))
        nll_b = 0.0
        if self.qB.size:
            nll_b = -float(np.sum(log_prob_valoracion(self._U(u, ts), math.exp(u["ls"]), self.ciB, self.csB)))
        th = u["theta"]
        pen = (np.sum(th ** 2) / (2 * self.sd_h ** 2) + K_CENTRO * np.sum(th) ** 2 + u["global"] ** 2 / (2 * self.sd_g ** 2)
               + np.sum(u["cat"] ** 2 / (2 * self.sd_c ** 2)) + np.sum(u["d"] ** 2) / (2 * self.sd_d ** 2)
               + np.sum(u["rho"] ** 2) / (2 * self.sd_e ** 2) + (u["beta"] ** 2 + u["gamma"] ** 2) / (2 * self.sd_b ** 2)
               + ((u["ls"] - self.ls0) ** 2 / (2 * self.sd_ls ** 2) if self.estimar_ls else 0.0))
        return nll_a + nll_b + float(pen)

    def gradiente(self, par) -> np.ndarray:
        u = self.desempaquetar(par)
        _, ts, dts = self.niveles(u)
        p = self.tabla.p(ts)
        lp = logit(p)
        dlp_dt = self.tabla.dp(ts) / (p * (1 - p)) * dts

        eta = u["theta"][self.jA] + lp[self.qA]
        ra = expit(eta) - self.yA
        g_theta = suma_por(self.jA, ra, self.J)
        g_t = suma_por(self.qA, ra * dlp_dt[self.qA], self.Q)

        g_rho = np.zeros(self.E)
        g_beta = g_gamma = g_ls = 0.0
        if self.qB.size:
            s = math.exp(u["ls"])
            _, dU, ds = log_prob_valoracion(self._U(u, ts), s, self.ciB, self.csB, derivadas=True)
            gu = -dU
            g_t = g_t + suma_por(self.qB, gu * dts[self.qB], self.Q)
            g_rho = suma_por(self.eB, gu, self.E)
            g_beta = float(np.sum(gu * self.falloB))
            g_gamma = float(np.sum(gu * self.revB))
            g_ls = -float(np.sum(ds)) * s

        th = u["theta"]
        partes = [
            g_theta + th / self.sd_h ** 2 + 2 * K_CENTRO * np.sum(th),
            [np.sum(g_t) + u["global"] / self.sd_g ** 2],
            suma_por(self.cat_q, g_t, self.C) + u["cat"] / self.sd_c ** 2,
            g_t + u["d"] / self.sd_d ** 2,
            g_rho + u["rho"] / self.sd_e ** 2,
            [g_beta + u["beta"] / self.sd_b ** 2],
            [g_gamma + u["gamma"] / self.sd_b ** 2],
        ]
        if self.estimar_ls:
            partes.append([g_ls + (u["ls"] - self.ls0) / self.sd_ls ** 2])
        return np.concatenate([np.asarray(x, dtype=float) for x in partes])


@dataclass
class Ajuste:
    par: np.ndarray
    u: dict
    nivel_continuo: np.ndarray
    sd_nivel: np.ndarray
    convergido: bool
    mensaje: str


def ajustar(modelo: Modelo, maxit: int = 2000, avisar=_avisar) -> Ajuste:
    # Los mismos criterios que optim(method = "L-BFGS-B", factr = 1e5) en R: memoria 5 y sin parar por el gradiente.
    r = minimize(modelo.objetivo, modelo.inicial, jac=modelo.gradiente, method="L-BFGS-B",
                 options={"maxiter": maxit, "ftol": 1e5 * np.finfo(float).eps, "gtol": 0.0, "maxcor": 5})
    if not r.success:
        avisar(f"La optimización no ha convergido del todo: {r.message}")
    u = modelo.desempaquetar(r.x)
    _, ts, _ = modelo.niveles(u)

    # Incertidumbre aproximada de cada nivel (curvatura de la función objetivo en su ajuste por pregunta):
    # solo para preguntas con datos; el resto queda sin ella.
    con_datos = sorted(set(modelo.qA.tolist()) | set(modelo.qB.tolist()))
    sd_nivel = np.full(len(ts), np.nan)
    h = 1e-4
    for q in con_datos:
        i = modelo.indices_d[q]
        e = np.zeros(len(r.x))
        e[i] = h
        curv = (modelo.gradiente(r.x + e)[i] - modelo.gradiente(r.x - e)[i]) / (2 * h)
        if math.isfinite(curv) and curv > 0:
            sd_nivel[q] = 1 / math.sqrt(curv)
    return Ajuste(r.x, u, ts, sd_nivel, bool(r.success), str(r.message))


# ------------------------------------------------------------------ resultados

def retiradas_por_marcas(marcas: list[dict], config: dict, restaurar=()) -> dict[str, str]:
    """Se retira una pregunta marcada con un motivo inmediato («errónea») o por varias personas distintas."""
    inmediatos = config["retirada"]["motivos_inmediatos"]
    minimo = config["retirada"]["marcas_distintas"]
    salida: dict[str, str] = {}
    for id_ in dict.fromkeys(m["pregunta"] for m in marcas):
        if id_ in restaurar:
            continue
        m = [x for x in marcas if x["pregunta"] == id_]
        graves = [x["motivo"] for x in m if x["motivo"] in inmediatos]
        if graves:
            salida[id_] = graves[0]
        elif len({x["quien"] for x in m}) >= minimo:
            # El motivo más repetido; si empatan, el primero por orden alfabético.
            cuenta = Counter(x["motivo"] for x in m)
            salida[id_] = min(cuenta, key=lambda k: (-cuenta[k], k))
    return salida


def freno_retiradas(retiradas: dict, previas: dict, marcas: list[dict], maximo: int | None) -> dict | None:
    """Si esta calibración retira de golpe más preguntas nuevas que `maximo` (`retirada.max_por_calibracion`), las
    nuevas y de dónde vienen sus marcas (los cinco orígenes con más); si no, None. Cualquiera puede enviar datos a la
    hoja del grupo, y una sola marca de «errónea» retira una pregunta: con marcas falsas se podría vaciar el banco.
    Por encima del máximo, calibrar.py no escribe los ajustes sin que se confirme."""
    nuevas = [q for q in retiradas if q not in previas]
    if maximo is None or len(nuevas) <= maximo:
        return None
    origen = Counter(m["quien"] for m in marcas if m["pregunta"] in set(nuevas))
    return {"nuevas": nuevas, "origen": origen.most_common(5)}


def leer_restaurar(raiz: Path) -> list[str]:
    ruta = raiz / "analisis" / "restaurar.txt"
    if not ruta.exists():
        return []
    lineas = [re.sub(r"#.*$", "", linea).strip() for linea in ruta.read_text(encoding="utf-8-sig").splitlines()]
    return [linea for linea in lineas if linea]


# ------------------------------------------------------------------ rondas divertidas
# No entran en el modelo de niveles: por cada ronda se cuenta cuántas veces se ha jugado y cuántos
# aciertos (casillas) da de media, para ajustar su tiempo si da demasiadas o muy pocas.

def leer_rondas(raiz: Path, config: dict) -> list[dict]:
    if not config.get("rondas"):
        return []
    ruta = raiz / "app" / config["rondas"]["archivo"]
    if not ruta.exists():
        return []
    return [{"id": r["id"], "v": int(r["v"]), "titulo": r["titulo"], "tipo": r["tipo"], "cerrada": bool(r.get("cerrada")),
             "segundos": int(r["segundos"]), "total": len(r["elementos"])} for r in leer_json(ruta).get("rondas", [])]


def _clave_titulo(titulo: str):
    """Orden alfabético como el de una persona: sin tildes, sin mayúsculas y sin «¿» delante."""
    import unicodedata
    t = unicodedata.normalize("NFD", titulo.casefold())
    return "".join(c for c in t if c.isalnum() or c == " ").strip()


def estadisticas_rondas(registros: list[dict], rondas: list[dict]) -> dict:
    vacia = {"tabla": [], "jugadas": 0, "repetidas": 0, "otra_version": 0}
    jug = [r for r in registros if r.get("tipo") == "ronda"]
    anul = [r for r in registros if r.get("tipo") == "ronda_anulada"]
    if not jug and not anul:
        return vacia
    info = {r["id"]: r for r in rondas}

    def actual(r):
        # Solo la versión actual de cada ronda: con otra lista u otro tiempo, los aciertos no son comparables.
        ref = info.get(r.get("ronda"))
        return ref is not None and _entero(r.get("v")) == ref["v"]

    # Y sin las que quien jugaba ya conocía (alternativa «repetida»): sabría la lista.
    usar = [r for r in jug if actual(r) and r.get("alternativa") != "repetida"]
    anul = [r for r in anul if actual(r)]
    tabla = []
    for id_ in dict.fromkeys([r["ronda"] for r in usar] + [r["ronda"] for r in anul]):
        a = [float(r["aciertos"]) for r in usar if r["ronda"] == id_ and r.get("aciertos") is not None]
        ref = info[id_]
        tabla.append({**{k: ref[k] for k in ("id", "titulo", "tipo", "cerrada", "segundos", "total")},
                      "veces": len(a), "media": sum(a) / len(a) if a else None, "maximo": max(a) if a else None,
                      "cambiada": sum(1 for r in anul if r["ronda"] == id_),
                      "malas": sum(1 for r in usar if r["ronda"] == id_ and r.get("mala") is not None)})
    tabla.sort(key=lambda f: (-f["veces"], _clave_titulo(f["titulo"])))
    return {"tabla": tabla, "jugadas": len(jug), "repetidas": sum(1 for r in jug if actual(r) and r.get("alternativa") == "repetida"),
            "otra_version": sum(1 for r in jug if not actual(r))}


def leer_finales(raiz: Path, config: dict) -> list[dict]:
    archivo = (config.get("final") or {}).get("archivo")
    ruta = raiz / "app" / archivo if archivo else None
    if not ruta or not ruta.exists():
        return []
    salida = []
    for f in leer_json(ruta).get("finales", []):
        reto = f.get("tipo") == "reto"
        texto = f["titulo"] if reto else f["pregunta"]
        salida.append({"id": f["id"], "v": int(f["v"]), "nivel": int(f["nivel"]), "tipo": f["tipo"],
                       "titulo": texto if len(texto) <= 70 else texto[:69].rstrip() + "…",
                       "total": len(f["elementos"]) if reto else None, "minimo": f.get("minimo") if reto else None})
    return salida


def estadisticas_finales(registros: list[dict], finales: list[dict], config: dict) -> dict:
    """Cuánto se aciertan las finales propias, por nivel y una a una, frente al objetivo de `config.final`."""
    cfg = config.get("final") or {}
    base = cfg.get("nivel_base", 8)
    objetivos = {base + i: x for i, x in enumerate(cfg.get("objetivo_acierto") or [])}
    vacia = {"niveles": [], "tabla": [], "jugadas": 0, "repetidas": 0, "otra_version": 0, "objetivos": objetivos}
    jug = [r for r in registros if r.get("tipo") == "final"]
    anul = [r for r in registros if r.get("tipo") == "final_anulada"]
    if not jug and not anul:
        return vacia
    info = {f["id"]: f for f in finales}

    def actual(r):
        # Solo la versión actual: si se reescribe una final, sus datos anteriores no valen para ella.
        ref = info.get(r.get("final"))
        return ref is not None and _entero(r.get("v")) == ref["v"]

    # Sin las que quien jugaba ya había visto (alternativa «repetida»): sabría la respuesta.
    usar = [r for r in jug if actual(r) and r.get("alternativa") != "repetida"]
    anul = [r for r in anul if actual(r)]
    niveles = []
    for nivel in sorted({info[r["final"]]["nivel"] for r in usar} | set(objetivos)):
        de = [r for r in usar if info[r["final"]]["nivel"] == nivel]
        acertadas = sum(1 for r in de if r.get("acierto") is True)
        niveles.append({"nivel": nivel, "jugadas": len(de), "acertadas": acertadas,
                        "acierto": acertadas / len(de) if de else None, "objetivo": objetivos.get(nivel)})
    tabla = []
    for id_ in dict.fromkeys([r["final"] for r in usar] + [r["final"] for r in anul]):
        de = [r for r in usar if r["final"] == id_]
        ref = info[id_]
        aciertos = [float(r["aciertos"]) for r in de if r.get("aciertos") is not None]
        valoraciones = [r.get("valoracion") for r in de if r.get("valoracion")]
        tabla.append({**{k: ref[k] for k in ("id", "titulo", "tipo", "nivel", "total", "minimo")},
                      "veces": len(de), "acertada": sum(1 for r in de if r.get("acierto") is True),
                      "media_aciertos": sum(aciertos) / len(aciertos) if aciertos else None,
                      "facil": valoraciones.count("facil"), "dificil": valoraciones.count("dificil"),
                      "cambiada": sum(1 for r in anul if r["final"] == id_),
                      "malas": sum(1 for r in de if r.get("mala") is not None)})
    tabla.sort(key=lambda f: (f["nivel"], -f["veces"], f["id"]))
    return {"niveles": niveles, "tabla": tabla, "jugadas": len(jug), "objetivos": objetivos,
            "repetidas": sum(1 for r in jug if actual(r) and r.get("alternativa") == "repetida"),
            "otra_version": sum(1 for r in jug if not actual(r))}


# ------------------------------------------------------------------ calibración completa

@dataclass
class Resultado:
    config: dict
    banco: Banco
    exportaciones: Exportaciones
    datos: Datos
    modelo: Modelo
    ajuste: Ajuste
    nuevo: np.ndarray
    ajustes: dict
    rondas: dict
    finales: dict


def calibrar(raiz: Path, carpeta_datos: Path, avisar=_avisar) -> Resultado:
    config = leer_config(raiz)
    banco = leer_banco(raiz, config)
    exp = leer_exportaciones(carpeta_datos, avisar=avisar)
    rondas = estadisticas_rondas(exp.registros, leer_rondas(raiz, config))
    finales = estadisticas_finales(exp.registros, leer_finales(raiz, config), config)
    datos = preparar_datos(exp.registros, banco, config)
    modelo = Modelo(datos, banco, config)
    ajuste = ajustar(modelo, avisar=avisar)

    rango = config["niveles"]
    nuevo = np.clip(np.round(ajuste.nivel_continuo), rango["min"], rango["max"]).astype(int)
    # Prudencia: una pregunta con menos datos que el mínimo conserva su nivel inicial.
    n_datos = contar([x["q"] for x in datos.respuestas], len(banco)) + contar([x["q"] for x in datos.valoraciones], len(banco))
    pocos = n_datos < (config["modelo"].get("min_datos_cambio") or 0)
    nuevo[pocos] = banco.nivel[pocos]
    retiradas = retiradas_por_marcas(datos.marcas, config, leer_restaurar(raiz))
    cambian = [i for i in range(len(banco)) if nuevo[i] != banco.nivel[i]]
    # Versión de cada pregunta ajustada: si luego se reescribe (sube su `v`), la app deja de aplicarle
    # el ajuste, que se calculó con el texto anterior, sin esperar a la siguiente calibración.
    ajustadas = list(dict.fromkeys([banco.id[i] for i in cambian] + list(retiradas)))
    ajustes = {
        "formato": 1,
        "version": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generado_por": "analisis/calibrar.py",
        "n_respuestas": len(datos.respuestas),
        "n_valoraciones": len(datos.valoraciones),
        "niveles": {banco.id[i]: int(nuevo[i]) for i in cambian},
        "retiradas": retiradas,
        "versiones": {q: int(banco.v[banco.posicion[q]]) for q in ajustadas if q in banco.posicion},
    }
    return Resultado(config, banco, exp, datos, modelo, ajuste, nuevo, ajustes, rondas, finales)


def escribir_ajustes(ajustes: dict, ruta: Path):
    Path(ruta).write_text(json.dumps(ajustes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
