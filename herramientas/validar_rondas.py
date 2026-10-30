"""Valida las rondas divertidas (`app/data/rondas.json`).

Tres tipos:
- «lista»: nombrar todos los que se pueda («los doce apóstoles»). Cerrada (solo cuentan los de la
  lista, con sus variantes en «tambien_vale») o abierta (decide el grupo; la lista es una ayuda).
- «rafaga»: descripciones seguidas, cada una con su respuesta («roja con una cruz blanca» → Suiza).
- «ordenar»: el primer elemento se da colocado y cada uno de los siguientes hay que ponerlo en su sitio
  entre los ya colocados (por altura, por año…). Cada uno bien colocado es un acierto; al primer fallo,
  se acaba.

Cada elemento lleva su «nivel» (1-10): lo difícil que es acertarlo dentro del tiempo de la ronda para el
jugador medio, con la misma vara que las preguntas (la tabla de aciertos objetivo). Con esos niveles se
calcula lo difícil que es llegar a k aciertos, que tiene que parecerse a acertar una pregunta de nivel k
(fase 25): sacar 5 la mitad de las veces, 7 un 31 %, 9 un 11 %.

Lo usa `validar_banco.py`, que valida a la vez el banco y las rondas, y su archivo de control
(`rondas.lock.json`) para que una ronda que cambia suba su versión.
"""

from __future__ import annotations

import hashlib
import json
import math
import re

from validar_banco import APP, Informe, cargar_config, evaluar, normalizar, valor_respuesta

RONDAS = APP / "data" / "rondas.json"
LOCK_RONDAS = APP / "data" / "rondas.lock.json"

TIPOS = {"lista", "rafaga", "ordenar"}
# Límites: lo que se lee en voz alta tiene que ser corto, y el tiempo, razonable.
SEGUNDOS = (10, 180)
ELEMENTOS = {"lista": (5, 30), "rafaga": (6, 15), "ordenar": (6, 13)}
LARGO = {"titulo": 50, "enunciado": 220, "texto": 40, "pista": 170, "respuesta": 40, "etiqueta": 30}
# Segundos por elemento fuera de este margen: probablemente demasiado fácil o imposible de acabar.
# En «ordenar» cuentan los que hay que colocar (todos menos el primero).
SEGUNDOS_POR_ELEMENTO = {"lista": (1.5, 8), "rafaga": (3, 10), "ordenar": (3, 12)}
# Si config.rondas no dice otra cosa: desviación de la habilidad de quien juega la ronda (en la escala
# logit, como `modelo.sd_habilidad`, pero mayor: saber de banderas o de Pokémon va por barrios) y cuántos
# niveles se puede separar la dificultad de llegar a k aciertos de la de una pregunta de nivel k.
CURVA = {"sd": 1.5, "margen": 1.5}


# ---------------------------------------------------------------- dificultad de la ronda

def _logit(p: float) -> float:
    return math.log(p / (1 - p))


def _expit(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def _nodos(sd: float, n: int = 41) -> list[tuple[float, float]]:
    """Habilidades de quien juega (de -4 a 4 desviaciones) con su peso en una normal."""
    xs = [-4 + 8 * i / (n - 1) for i in range(n)]
    ws = [math.exp(-x * x / 2) for x in xs]
    total = sum(ws)
    return [(x * sd, w / total) for x, w in zip(xs, ws)]


def puntuables(r: dict) -> list[dict]:
    """Los elementos que pueden dar un acierto: en «ordenar», todos menos el primero, que se da colocado."""
    elementos = r.get("elementos") or []
    return elementos[1:] if r.get("tipo") == "ordenar" else elementos


def curva(niveles: list[int], objetivo: list[float], sd: float, escalera: bool = False) -> list[float]:
    """Probabilidad de llegar a k aciertos (k = 1, 2…) con el modelo de la calibración: quien juega acierta
    un elemento de nivel L con logit P = h + logit(objetivo[L]), con la misma habilidad h para toda la
    ronda. En una lista o una ráfaga cuentan todos los aciertos; en una escalera («ordenar»), se para al
    primer fallo."""
    n = len(niveles)
    c = [0.0] * n
    for h, w in _nodos(sd):
        ps = [_expit(h + _logit(objetivo[nivel - 1])) for nivel in niveles]
        if escalera:
            seguido = 1.0
            for k, p in enumerate(ps):
                seguido *= p
                c[k] += w * seguido
        else:
            dist = [1.0]  # dist[i]: probabilidad de llevar i aciertos
            for p in ps:
                nueva = [0.0] * (len(dist) + 1)
                for i, q in enumerate(dist):
                    nueva[i] += q * (1 - p)
                    nueva[i + 1] += q * p
                dist = nueva
            for k in range(1, n + 1):
                c[k - 1] += w * sum(dist[k:])
    return c


def nivel_equivalente(p: float, objetivo: list[float]) -> float:
    """El nivel de pregunta que se acierta con probabilidad p (la tabla, interpolada; fuera, prolongada)."""
    if p >= objetivo[0]:
        return 1 - (p - objetivo[0]) / (objetivo[0] - objetivo[1])
    for i in range(len(objetivo) - 1):
        if objetivo[i] >= p >= objetivo[i + 1]:
            return i + 1 + (objetivo[i] - p) / (objetivo[i] - objetivo[i + 1])
    return len(objetivo) + (objetivo[-1] - p) / (objetivo[-2] - objetivo[-1])


def curva_de_ronda(r: dict, config: dict) -> list[float] | None:
    """La curva de una ronda bien formada (None si a algún elemento le falta el nivel)."""
    niveles = [e.get("nivel") for e in puntuables(r) if isinstance(e, dict)]
    nmax = config["niveles"]["max"]
    if not niveles or any(not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= nmax for n in niveles):
        return None
    ajustes = {**CURVA, **(config.get("rondas", {}).get("curva") or {})}
    return curva(niveles, config["objetivo_acierto"], ajustes["sd"], escalera=r.get("tipo") == "ordenar")


def descripcion_curva(c: list[float], objetivo: list[float]) -> str:
    """«media 4,7 · 5 aciertos ≈ nivel 4,9 · 7 ≈ 7,6 · 9 ≈ 9,7»: para leerla de un vistazo."""
    trozos = [f"media {sum(c):.1f}".replace(".", ",")]
    for k in (3, 5, 7, 9):
        if k <= len(c):
            trozos.append(f"{k} ≈ nivel {nivel_equivalente(c[k - 1], objetivo):.1f}".replace(".", ","))
    return " · ".join(trozos)


def validar_curva(r: dict, config: dict, donde: str, inf: Informe):
    """Llegar a k aciertos tiene que costar como una pregunta de nivel k (con un margen), y pasar de 10
    aciertos, al menos como la más difícil. Más fácil es un error (la ronda regala casillas); más difícil,
    un aviso (da menos casillas, pero no rompe la partida). Las ráfagas y las de ordenar van de más fácil
    a más difícil."""
    elementos = [e for e in puntuables(r) if isinstance(e, dict)]
    nmax = config["niveles"]["max"]
    niveles = [e.get("nivel") for e in elementos]
    if any(not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= nmax for n in niveles):
        inf.error(donde, f"cada elemento{' (menos el primero)' if r.get('tipo') == 'ordenar' else ''} lleva «nivel», de 1 a {nmax}: "
                         "lo difícil que es acertarlo dentro del tiempo")
        return
    if r.get("tipo") in ("rafaga", "ordenar") and any(b < a for a, b in zip(niveles, niveles[1:])):
        inf.error(donde, f"los elementos se leen en orden: tienen que ir de más fácil a más difícil (niveles {niveles})")
    objetivo = config["objetivo_acierto"]
    margen = {**CURVA, **(config.get("rondas", {}).get("curva") or {})}["margen"]
    c = curva_de_ronda(r, config)
    faciles, dificiles = [], []
    for k, p in enumerate(c, 1):
        eq = nivel_equivalente(p, objetivo)
        texto = f"{k} aciertos ≈ nivel {eq:.1f}".replace(".", ",")
        # Pasar de 10 cuenta como un nivel 11 (la tabla, prolongada): con el margen, como poco un 9,5.
        if eq < min(k, nmax + 1) - margen:
            faciles.append(texto)
        elif k <= nmax and eq > k + margen:
            dificiles.append(texto)
    if faciles:
        inf.error(donde, f"llegar a k aciertos es más fácil que acertar una pregunta de nivel k ({'; '.join(faciles)}): "
                         "baja el tiempo o pon elementos más difíciles")
    if dificiles:
        inf.aviso(donde, f"llegar a k aciertos es más difícil que acertar una pregunta de nivel k ({'; '.join(dificiles)})")


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
    """Lo que, si cambia, cambia la ronda: entonces hay que subir su «v» para no mezclar estadísticas.
    El nivel de los elementos no: es lo que se cree de ellos, no lo que se juega."""
    elementos = r.get("elementos")
    if isinstance(elementos, list):
        elementos = [{k: v for k, v in e.items() if k != "nivel"} if isinstance(e, dict) else e for e in elementos]
    contenido = [r.get("tipo"), r.get("enunciado"), r.get("segundos"), r.get("cerrada"), elementos]
    if r.get("tipo") == "ordenar":
        contenido.append(r.get("orden"))
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


def validar_ronda(r: dict, inf: Informe, config: dict | None = None):
    config = config or cargar_config()
    donde = r.get("id") if isinstance(r.get("id"), str) else "(ronda sin id)"
    if not isinstance(r.get("id"), str) or not re.fullmatch(r"ron-[a-z0-9]+(-[a-z0-9]+)*", r["id"]):
        inf.error(donde, "el id debe tener la forma ron-palabras-con-guiones (minúsculas, sin tildes)")
    if not isinstance(r.get("v"), int) or isinstance(r.get("v"), bool) or r["v"] < 1:
        inf.error(donde, "«v» debe ser un entero desde 1")
    tipo = r.get("tipo")
    if tipo not in TIPOS:
        inf.error(donde, f"tipo desconocido «{tipo}» (lista, rafaga u ordenar)")
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
    if tipo != "lista" and r.get("cerrada") is not None:
        inf.error(donde, "«cerrada» solo tiene sentido en las listas")
    if tipo == "ordenar" and r.get("orden") not in ("asc", "desc"):
        inf.error(donde, "«orden» dice cómo se ve la fila: «asc» (de menor a mayor) o «desc» (de mayor a menor)")
    if tipo != "ordenar" and r.get("orden") is not None:
        inf.error(donde, "«orden» solo tiene sentido en las de ordenar")

    elementos = r.get("elementos")
    minimo, maximo = ELEMENTOS[tipo]
    if not isinstance(elementos, list) or not minimo <= len(elementos) <= maximo:
        inf.error(donde, f"una {tipo} lleva entre {minimo} y {maximo} elementos")
        return

    if tipo == "ordenar":
        validar_ordenar(elementos, donde, inf)
        if all(isinstance(e, dict) for e in elementos):
            validar_curva(r, config, donde, inf)
        if segundos:
            lo, hi = SEGUNDOS_POR_ELEMENTO[tipo]
            por_elemento = segundos / (len(elementos) - 1)
            if not lo <= por_elemento <= hi:
                inf.aviso(donde, f"{segundos} s para colocar {len(elementos) - 1} ({por_elemento:.1f} s cada uno): ¿demasiado fácil o imposible?")
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

    # En una lista abierta, la de referencia no es el tope: no tiene sentido repartir el tiempo entre ella.
    if segundos and r.get("cerrada") is not False:
        lo, hi = SEGUNDOS_POR_ELEMENTO[tipo]
        por_elemento = segundos / len(elementos)
        if not lo <= por_elemento <= hi:
            inf.aviso(donde, f"{segundos} s para {len(elementos)} elementos ({por_elemento:.1f} s cada uno): ¿demasiado fácil o imposible?")
    if all(isinstance(e, dict) for e in elementos):
        validar_curva(r, config, donde, inf)


def validar_ordenar(elementos: list, donde: str, inf: Informe):
    """Cada elemento: un nombre corto, su valor (un número: la altura, el año…) y cómo se dice ese valor
    («8849 m»), que quien lee ve para juzgar. Dos con el mismo valor no se pueden ordenar."""
    nombres: dict[str, int] = {}
    valores: dict[float, int] = {}
    for i, e in enumerate(elementos):
        de = f"{donde} · elemento {i + 1}"
        if not isinstance(e, dict):
            inf.error(de, "debe ser un objeto")
            continue
        nombre = _texto(e, "texto", de, inf)
        _texto(e, "etiqueta", de, inf)
        valor = e.get("valor")
        if not isinstance(valor, (int, float)) or isinstance(valor, bool) or not math.isfinite(valor):
            inf.error(de, "«valor» debe ser un número")
        elif valor in valores:
            inf.error(de, f"tiene el mismo valor que el elemento {valores[valor] + 1}: no se pueden ordenar")
        else:
            valores[valor] = i
        if nombre:
            clave = normalizar(nombre)
            if clave in nombres:
                inf.error(de, f"«{nombre}» ya es el elemento {nombres[clave] + 1}")
            nombres.setdefault(clave, i)
        for campo in ("pista", "respuesta", "tambien_vale"):
            if campo in e:
                inf.error(de, f"«{campo}» no va en las de ordenar (cada elemento es «texto», «valor» y «etiqueta»)")


def validar_rondas(rondas: list[dict], inf: Informe, config: dict | None = None):
    config = config or cargar_config()
    for r in rondas:
        if not isinstance(r, dict):
            inf.error("rondas.json", "cada ronda debe ser un objeto")
            continue
        validar_ronda(r, inf, config)
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
    ordenar = sum(1 for r in rondas if r.get("tipo") == "ordenar")
    return f"Rondas: {len(rondas)} ({len(listas)} listas, {abiertas} de ellas abiertas, {rafagas} ráfagas y {ordenar} de ordenar)"


def curvas(rondas: list[dict], config: dict) -> list[str]:
    """Una línea por ronda con su dificultad: los aciertos que da de media y a qué nivel equivale sacar 3, 5, 7 y 9."""
    lineas = []
    for r in rondas:
        c = curva_de_ronda(r, config) if isinstance(r, dict) else None
        if c:
            lineas.append(f"{r.get('id')}: {descripcion_curva(c, config['objetivo_acierto'])}")
    return lineas
