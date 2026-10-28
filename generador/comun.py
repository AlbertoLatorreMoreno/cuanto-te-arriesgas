"""Utilidades compartidas del generador: rutas, banco, ajustes, ids y escritura de archivos."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "herramientas"))

import validar_banco as vb  # noqa: E402  (reutilizamos validación, normalización y duplicados)


class Proyecto:
    """Acceso a los archivos del proyecto. `raiz` se puede cambiar en los tests."""

    def __init__(self, raiz: Path = RAIZ):
        self.raiz = Path(raiz)
        self.app = self.raiz / "app"
        self.config = json.loads((self.app / "data" / "config.json").read_text(encoding="utf-8"))

    # ---------------------------------------------------------------- banco

    def ruta_categoria(self, cat_id: str) -> Path:
        cat = self.categoria(cat_id)
        return self.app / cat["archivo"]

    def categorias(self) -> list[dict]:
        """Las categorías del tablero y los temas que elige cada jugador (config.temas), que tienen el mismo formato."""
        return self.config["categorias"] + self.config.get("temas", {}).get("lista", [])

    def es_tema(self, cat_id: str) -> bool:
        return any(t["id"] == cat_id for t in self.config.get("temas", {}).get("lista", []))

    def categoria(self, cat_id: str) -> dict:
        for c in self.categorias():
            if c["id"] == cat_id:
                return c
        raise KeyError(f"Categoría desconocida: {cat_id}")

    def subtema(self, cat_id: str, sub_id: str) -> dict:
        for s in self.categoria(cat_id)["subtemas"]:
            if s["id"] == sub_id:
                return s
        raise KeyError(f"Subtema desconocido: {cat_id}/{sub_id}")

    def banco(self) -> list[dict]:
        preguntas = []
        for c in self.categorias():
            ruta = self.ruta_categoria(c["id"])
            if self.es_tema(c["id"]) and not ruta.exists():
                continue  # un tema sin archivo todavía no tiene preguntas (las categorías del tablero, sí o sí)
            datos = json.loads(ruta.read_text(encoding="utf-8"))
            preguntas.extend(datos["preguntas"])
        return preguntas

    def guardar_categoria(self, cat_id: str, preguntas: list[dict]) -> None:
        """Escribe el archivo de una categoría con el mismo estilo que el banco:
        una pregunta por línea y una línea en blanco entre subtemas."""
        orden = [s["id"] for s in self.categoria(cat_id)["subtemas"]]
        por_sub: dict[str, list[dict]] = {s: [] for s in orden}
        for p in preguntas:
            por_sub.setdefault(p["subtema"], []).append(p)
        bloques = []
        for sub, lista in por_sub.items():
            if not lista:
                continue
            lista = sorted(lista, key=lambda p: (p["nivel"], p["id"]))
            bloques.append(",\n".join("    " + json.dumps(limpiar(p), ensure_ascii=False) for p in lista))
        texto = '{\n  "categoria": "' + cat_id + '",\n  "preguntas": [\n' + ",\n\n".join(bloques) + "\n  ]\n}\n"
        self.ruta_categoria(cat_id).write_text(texto, encoding="utf-8")

    def ajustes(self) -> dict:
        ruta = self.app / "data" / "ajustes.json"
        return json.loads(ruta.read_text(encoding="utf-8")) if ruta.exists() else {"niveles": {}, "retiradas": {}}

    def ids_usados(self) -> set[str]:
        """Ids del banco y del archivo de control: un id retirado o borrado no se reutiliza nunca."""
        ids = {p["id"] for p in self.banco()}
        lock = self.app / "data" / "preguntas.lock.json"
        if lock.exists():
            ids |= set(json.loads(lock.read_text(encoding="utf-8")))
        return ids


ORDEN_CAMPOS = ["id", "v", "categoria", "subtema", "nivel", "tipo", "pregunta", "respuesta", "tambien_vale",
                "criterio", "lat", "lon", "distancia_max_km", "vista", "explicacion", "verificacion", "origen", "juez"]


def limpiar(p: dict) -> dict:
    """Quita campos vacíos e internos y ordena los campos como en el banco."""
    salida = {}
    for k in ORDEN_CAMPOS:
        if k not in p:
            continue
        v = p[k]
        if k in ("criterio", "explicacion", "verificacion", "juez") and (v is None or v == "" or v == {}):
            continue
        salida[k] = v
    return salida


def ajuste_vigente(p: dict, ajustes: dict) -> bool:
    """Un ajuste vale para la versión de la pregunta con la que se calculó (como en la app): si se ha
    reescrito (ha subido su `v`), vuelve a su nivel inicial y deja de estar retirada."""
    v = ajustes.get("versiones", {}).get(p["id"])
    return v is None or v == p["v"]


def nivel_efectivo(p: dict, ajustes: dict) -> int:
    n = ajustes.get("niveles", {}).get(p["id"])
    return n if isinstance(n, int) and ajuste_vigente(p, ajustes) else p["nivel"]


def esta_retirada(p: dict, ajustes: dict) -> bool:
    return p["id"] in ajustes.get("retiradas", {}) and ajuste_vigente(p, ajustes)


def cobertura(proyecto: Proyecto) -> Counter:
    """Preguntas activas por (categoría, subtema, nivel efectivo), sin contar las retiradas."""
    ajustes = proyecto.ajustes()
    c: Counter = Counter()
    for p in proyecto.banco():
        if not esta_retirada(p, ajustes):
            c[(p["categoria"], p["subtema"], nivel_efectivo(p, ajustes))] += 1
    return c


def huecos(proyecto: Proyecto, objetivo: int) -> list[tuple[str, str, int, int]]:
    """Celdas con menos de `objetivo` preguntas: (categoría, subtema, nivel, cuántas faltan)."""
    c = cobertura(proyecto)
    nmin, nmax = proyecto.config["niveles"]["min"], proyecto.config["niveles"]["max"]
    salida = []
    # Solo las del tablero: los temas tienen una por casilla a propósito y se piden de una en una (--celda).
    for cat in proyecto.config["categorias"]:
        if cat.get("tipo") == "mapa":
            continue  # las preguntas de mapa necesitan coordenadas: se escriben a mano
        for sub in cat["subtemas"]:
            for n in range(nmin, nmax + 1):
                falta = objetivo - c[(cat["id"], sub["id"], n)]
                if falta > 0:
                    salida.append((cat["id"], sub["id"], n, falta))
    return salida


def siguiente_id(cat_id: str, sub_id: str, usados: set[str]) -> str:
    prefijo = f"{cat_id[:3]}-{sub_id[:3]}-"
    numeros = [int(m.group(1)) for i in usados if (m := re.fullmatch(re.escape(prefijo) + r"(\d+)", i))]
    n = max(numeros, default=0) + 1
    nuevo = f"{prefijo}{n:02d}"
    usados.add(nuevo)
    return nuevo


def plural(n: int, singular: str, plural_: str | None = None) -> str:
    """«1 pregunta», «2 preguntas»."""
    return f"{n} {singular if n == 1 else (plural_ or singular + 's')}"


def es_duplicada(texto: str, otras: list[str]) -> str | None:
    """Devuelve la pregunta existente con la que choca, o None. Mismos umbrales que el validador."""
    t = vb.normalizar(texto)
    for o in otras:
        n = vb.normalizar(o)
        if t == n:
            return o
        if abs(len(t) - len(n)) > 0.4 * max(len(t), len(n)):
            continue
        if vb.SequenceMatcher(None, t, n).ratio() >= vb.SIMILITUD_AVISO and vb.jaccard(t, n) >= 0.6:
            return o
    return None
