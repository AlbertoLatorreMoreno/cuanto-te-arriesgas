"""Valida las rondas divertidas (`app/data/rondas.json`).

Dos tipos:
- «lista»: nombrar todos los que se pueda («los doce apóstoles»). Cerrada (solo cuentan los de la
  lista, con sus variantes en «tambien_vale») o abierta (decide el grupo; la lista es una ayuda).
- «rafaga»: descripciones seguidas, cada una con su respuesta («roja con una cruz blanca» → Suiza).

Lo usa `validar_banco.py`, que valida a la vez el banco y las rondas, y su archivo de control
(`rondas.lock.json`) para que una ronda que cambia suba su versión.
"""

from __future__ import annotations

import hashlib
import json
import math
import re

from validar_banco import APP, Informe, evaluar, normalizar, valor_respuesta

RONDAS = APP / "data" / "rondas.json"
LOCK_RONDAS = APP / "data" / "rondas.lock.json"

TIPOS = {"lista", "rafaga"}
# Límites: lo que se lee en voz alta tiene que ser corto, y el tiempo, razonable.
SEGUNDOS = (10, 180)
ELEMENTOS = {"lista": (5, 30), "rafaga": (6, 15)}
LARGO = {"titulo": 50, "enunciado": 220, "texto": 40, "pista": 170, "respuesta": 40}
# Segundos por elemento fuera de este margen: probablemente demasiado fácil o imposible de acabar.
SEGUNDOS_POR_ELEMENTO = {"lista": (1.5, 8), "rafaga": (3, 10)}


def cargar_rondas(inf: Informe, ruta=None) -> list[dict]:
    ruta = ruta or RONDAS
    if not ruta.exists():
        inf.error(ruta.name, "no existe")
        return []
    datos = json.loads(ruta.read_text(encoding="utf-8"))
    if datos.get("formato") != 1 or not isinstance(datos.get("rondas"), list):
        inf.error(ruta.name, "debe tener «formato»: 1 y una lista «rondas»")
        return []
    return datos["rondas"]


def huella_ronda(r: dict) -> str:
    """Lo que, si cambia, cambia la ronda: entonces hay que subir su «v» para no mezclar estadísticas."""
    contenido = [r.get("tipo"), r.get("enunciado"), r.get("segundos"), r.get("cerrada"), r.get("elementos")]
    return hashlib.sha1(json.dumps(contenido, ensure_ascii=False).encode("utf-8")).hexdigest()[:12]


def _texto(r: dict, campo: str, donde: str, inf: Informe, obligatorio: bool = True) -> str | None:
    valor = r.get(campo)
    if valor is None and not obligatorio:
        return None
    if not isinstance(valor, str) or not valor.strip():
        inf.error(donde, f"falta «{campo}» o está vacío")
        return None
    if campo in LARGO and len(valor) > LARGO[campo]:
        inf.error(donde, f"«{campo}» demasiado largo para leerlo en voz alta ({len(valor)} caracteres, máximo {LARGO[campo]})")
    return valor


def verificar(e: dict, respuesta: str | None, donde: str, inf: Informe):
    """Una descripción con cálculo («siete por ocho») lleva su fórmula: se calcula y se compara con la respuesta."""
    formula = e.get("verificacion")
    if not isinstance(formula, str) or not formula.strip():
        inf.error(donde, "«verificacion» debe ser una fórmula")
        return
    try:
        valor = float(evaluar(formula))
    except Exception as exc:  # noqa: BLE001 — cualquier fallo de la fórmula es un error de la ronda
        inf.error(donde, f"no se puede calcular «{formula}»: {exc}")
        return
    esperado = valor_respuesta(respuesta or "")
    if esperado is None or not math.isclose(valor, esperado, rel_tol=1e-9, abs_tol=1e-9):
        inf.error(donde, f"«{formula}» da {valor:g}, pero la respuesta dice «{respuesta}»")


def validar_ronda(r: dict, inf: Informe):
    donde = r.get("id") if isinstance(r.get("id"), str) else "(ronda sin id)"
    if not isinstance(r.get("id"), str) or not re.fullmatch(r"ron-[a-z0-9]+(-[a-z0-9]+)*", r["id"]):
        inf.error(donde, "el id debe tener la forma ron-palabras-con-guiones (minúsculas, sin tildes)")
    if not isinstance(r.get("v"), int) or isinstance(r.get("v"), bool) or r["v"] < 1:
        inf.error(donde, "«v» debe ser un entero desde 1")
    tipo = r.get("tipo")
    if tipo not in TIPOS:
        inf.error(donde, f"tipo desconocido «{tipo}» (lista o rafaga)")
        return
    _texto(r, "titulo", donde, inf)
    _texto(r, "enunciado", donde, inf)
    _texto(r, "fuente", donde, inf)
    _texto(r, "nota", donde, inf, obligatorio=False)

    segundos = r.get("segundos")
    if not isinstance(segundos, int) or isinstance(segundos, bool) or not SEGUNDOS[0] <= segundos <= SEGUNDOS[1]:
        inf.error(donde, f"«segundos» debe ser un entero entre {SEGUNDOS[0]} y {SEGUNDOS[1]}")
        segundos = None
    elif segundos % 5:
        inf.aviso(donde, "«segundos» mejor en múltiplos de 5")

    if tipo == "lista" and not isinstance(r.get("cerrada"), bool):
        inf.error(donde, "una lista debe decir si es cerrada (true) o abierta (false)")
    if tipo == "rafaga" and r.get("cerrada") is not None:
        inf.error(donde, "«cerrada» solo tiene sentido en las listas")

    elementos = r.get("elementos")
    minimo, maximo = ELEMENTOS[tipo]
    if not isinstance(elementos, list) or not minimo <= len(elementos) <= maximo:
        inf.error(donde, f"una {tipo} lleva entre {minimo} y {maximo} elementos")
        return

    # Cada nombre (y cada variante) solo puede valer para un elemento: si no, ¿cuál se marca?
    vistos: dict[str, int] = {}
    principal = "texto" if tipo == "lista" else "respuesta"
    for i, e in enumerate(elementos):
        de = f"{donde} · elemento {i + 1}"
        if not isinstance(e, dict):
            inf.error(de, "debe ser un objeto")
            continue
        nombre = _texto(e, principal, de, inf)
        if tipo == "rafaga":
            pista = _texto(e, "pista", de, inf)
            clave_nombre = normalizar(nombre) if nombre else ""
            if pista and clave_nombre and (len(clave_nombre) > 2 or clave_nombre.isdigit()) and re.search(rf"\b{re.escape(clave_nombre)}\b", normalizar(pista)):
                inf.error(de, f"la descripción contiene la respuesta («{nombre}»)")
            if e.get("verificacion") is not None:
                verificar(e, nombre, de, inf)
        tambien = e.get("tambien_vale", [])
        if not isinstance(tambien, list) or any(not isinstance(x, str) or not x.strip() for x in tambien):
            inf.error(de, "«tambien_vale» solo admite textos no vacíos")
            tambien = []
        for variante in ([nombre] if nombre else []) + tambien:
            clave = normalizar(variante)
            if clave in vistos and vistos[clave] != i:
                inf.error(de, f"«{variante}» ya vale para el elemento {vistos[clave] + 1}")
            vistos.setdefault(clave, i)

    if segundos:
        lo, hi = SEGUNDOS_POR_ELEMENTO[tipo]
        por_elemento = segundos / len(elementos)
        if not lo <= por_elemento <= hi:
            inf.aviso(donde, f"{segundos} s para {len(elementos)} elementos ({por_elemento:.1f} s cada uno): ¿demasiado fácil o imposible?")


def validar_rondas(rondas: list[dict], inf: Informe):
    for r in rondas:
        if not isinstance(r, dict):
            inf.error("rondas.json", "cada ronda debe ser un objeto")
            continue
        validar_ronda(r, inf)
    ids = [r.get("id") for r in rondas if isinstance(r, dict)]
    for id_ in sorted({i for i in ids if ids.count(i) > 1}, key=str):
        inf.error(str(id_), "id repetido")
    titulos = [normalizar(r.get("titulo", "")) for r in rondas if isinstance(r, dict) and isinstance(r.get("titulo"), str)]
    for t in sorted({t for t in titulos if titulos.count(t) > 1}):
        inf.aviso("rondas.json", f"título repetido: «{t}»")


def resumen(rondas: list[dict]) -> str:
    listas = [r for r in rondas if r.get("tipo") == "lista"]
    abiertas = sum(1 for r in listas if r.get("cerrada") is False)
    rafagas = sum(1 for r in rondas if r.get("tipo") == "rafaga")
    return f"Rondas: {len(rondas)} ({len(listas)} listas, {abiertas} de ellas abiertas, y {rafagas} ráfagas)"
