"""Valida el banco de preguntas, las rondas divertidas y las preguntas finales.

Comprueba el esquema, ids, categorías y subtemas, casi duplicados, cobertura
por subtema y nivel, versiones (archivo de control) y calcula las respuestas
de mates a partir del campo `verificacion`. Las rondas (`rondas.json`) las
valida `validar_rondas.py`, y las finales propias (`finales.json`), `validar_finales.py`,
cada una con su propio archivo de control.

Uso:
    py herramientas/validar_banco.py                 # valida
    py herramientas/validar_banco.py --actualizar    # valida y actualiza los tres archivos de control
    py herramientas/validar_banco.py --candidatas generador/candidatas/lote.json

Sale con código 1 si hay errores.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import math
import re
import sys
import unicodedata
from difflib import SequenceMatcher
from fractions import Fraction
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
APP = RAIZ / "app"
CONFIG = APP / "data" / "config.json"
LOCK = APP / "data" / "preguntas.lock.json"

ORIGENES = {"semilla", "generada", "manual"}
SUBTEMAS_VERIFICABLES = {("mates", "calculo"), ("mates", "geometria"), ("mates", "probabilidad")}
PALABRAS_CADUCAN = [
    "actualmente", "hoy en día", "hoy en dia", "el actual", "la actual", "los actuales",
    "este año", "el último", "la última", "récord actual", "vigente",
]
PALABRAS_PROHIBIDAS = ["verdadero o falso", "cuál de estas", "cual de estas", "√"]
SIMILITUD_AVISO = 0.82
# Los temas (config.temas) tienen una pregunta por casilla a propósito: son muchos y solo le salen a quien
# los elige (unas 2 por jugador en la partida corta). Las categorías del tablero piden más (--min-celda).
MIN_CELDA_TEMA = 1


# ---------------------------------------------------------------- utilidades

def normalizar(texto: str) -> str:
    t = unicodedata.normalize("NFD", texto.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9ñ ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


PALABRAS_VACIAS = {
    "que", "cual", "cuál", "como", "cuantos", "cuantas", "cuanto", "para", "por", "con", "del", "los", "las",
    "una", "uno", "unos", "unas", "este", "esta", "sus", "son", "fue", "era", "esta", "hay", "tiene", "entre",
}


def jaccard(a: str, b: str) -> float:
    """Parecido entre las palabras con contenido (números incluidos) de dos textos normalizados."""
    ta = {w for w in a.split() if (len(w) > 2 or w.isdigit()) and w not in PALABRAS_VACIAS}
    tb = {w for w in b.split() if (len(w) > 2 or w.isdigit()) and w not in PALABRAS_VACIAS}
    return len(ta & tb) / len(ta | tb) if ta | tb else 1.0


def huella(p: dict) -> str:
    contenido = [p.get("pregunta"), p.get("respuesta"), p.get("tambien_vale"), p.get("criterio")]
    if p.get("tipo") == "mapa":
        # En una pregunta de mapa, mover el punto o cambiar la distancia también la cambia.
        contenido += [p.get("lat"), p.get("lon"), p.get("distancia_max_km")]
    return hashlib.sha1(json.dumps(contenido, ensure_ascii=False).encode("utf-8")).hexdigest()[:12]


# ---------------------------------------------------- evaluación de mates

NOMBRES_PERMITIDOS = {
    "pi": math.pi, "e": math.e, "sqrt": math.sqrt, "comb": math.comb, "perm": math.perm,
    "factorial": math.factorial, "gcd": math.gcd, "lcm": math.lcm, "Fraction": Fraction,
    "log": math.log, "log10": math.log10, "log2": math.log2, "abs": abs, "round": round,
    "min": min, "max": max, "sum": sum, "range": range, "len": len, "all": all, "any": any, "sin": math.sin,
    "cos": math.cos, "tan": math.tan, "radians": math.radians, "degrees": math.degrees,
}
NODOS_PERMITIDOS = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Load, ast.Call,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.FloorDiv, ast.USub, ast.UAdd,
    ast.Tuple, ast.List, ast.GeneratorExp, ast.comprehension, ast.Store, ast.Compare,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.IfExp, ast.BoolOp, ast.And, ast.Or,
    ast.Subscript, ast.Slice,
)


# Límites de tamaño: las verificaciones las puede escribir la IA y el generador las calcula
# solo; una fórmula desmesurada («9**9**9», «factorial(10**7)») colgaría el proceso. Las del
# banco se quedan muy por debajo (exponente 100, factorial de 25, rangos de decenas).
LIMITE_EXPONENTE = 10_000      # también: cifras del resultado de una potencia entera
LIMITE_N = 10_000              # factorial, comb y perm
LIMITE_PASOS = 2_000_000       # elementos recorridos con range, sumando los bucles anidados
LIMITE_REPETICION = 1_000_000  # longitud de una lista, tupla o texto repetidos con *


class _Calculo:
    """Versiones con límites de las operaciones que pueden crecer sin control."""

    def __init__(self):
        self.pasos = 0

    def potencia(self, a, b):
        if isinstance(b, (int, Fraction)) and abs(b) > LIMITE_EXPONENTE:
            raise ValueError("exponente demasiado grande")
        # También con fracciones: «Fraction(10**9999)**10000» se saltaba el límite y no acababa nunca.
        if isinstance(a, (int, Fraction)) and isinstance(b, (int, Fraction)) and abs(b) >= 1:
            mayor = max(abs(Fraction(a).numerator), Fraction(a).denominator)
            if mayor > 1 and abs(b) * math.log10(mayor) > LIMITE_EXPONENTE:
                raise ValueError("resultado demasiado grande")
        return a ** b

    def suma(self, iterable, inicio=0):
        # Solo números: con listas o tuplas («sum([[0]*1000]*3000, [])»), cada paso copia todo lo
        # anterior y la cuenta crece con el cuadrado; colgaba el validador.
        if not isinstance(inicio, (int, float, Fraction)):
            raise ValueError("sum solo suma números")
        return sum(iterable, inicio)

    def producto(self, a, b):
        for secuencia, veces in ((a, b), (b, a)):
            if isinstance(secuencia, (str, list, tuple)) and isinstance(veces, int) and len(secuencia) * veces > LIMITE_REPETICION:
                raise ValueError("repetición demasiado grande")
        return a * b

    def rango(self, *args):
        for x in range(*args):
            self.pasos += 1
            if self.pasos > LIMITE_PASOS:
                raise ValueError("la verificación hace demasiados cálculos")
            yield x

    def limitar_n(self, funcion):
        def f(n, *resto):
            if isinstance(n, int) and n > LIMITE_N:
                raise ValueError(f"{funcion.__name__} de un número demasiado grande")
            return funcion(n, *resto)
        return f


class _ConLimites(ast.NodeTransformer):
    """Cambia «a ** b» y «a * b» por llamadas a las versiones con límites."""

    def visit_BinOp(self, nodo):
        self.generic_visit(nodo)
        funcion = {ast.Pow: "_potencia", ast.Mult: "_producto"}.get(type(nodo.op))
        if not funcion:
            return nodo
        return ast.copy_location(ast.Call(func=ast.Name(id=funcion, ctx=ast.Load()), args=[nodo.left, nodo.right], keywords=[]), nodo)


def evaluar(expresion: str):
    arbol = ast.parse(expresion, mode="eval")
    variables_locales = set()
    for nodo in ast.walk(arbol):
        if not isinstance(nodo, NODOS_PERMITIDOS):
            raise ValueError(f"elemento no permitido: {type(nodo).__name__}")
        if isinstance(nodo, ast.comprehension) and isinstance(nodo.target, ast.Name):
            variables_locales.add(nodo.target.id)
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.Name) and nodo.id not in NOMBRES_PERMITIDOS and nodo.id not in variables_locales:
            raise ValueError(f"nombre no permitido: {nodo.id}")
    calculo = _Calculo()
    seguros = {
        **NOMBRES_PERMITIDOS,
        "range": calculo.rango,
        "sum": calculo.suma,
        "factorial": calculo.limitar_n(math.factorial),
        "comb": calculo.limitar_n(math.comb),
        "perm": calculo.limitar_n(math.perm),
        "_potencia": calculo.potencia,
        "_producto": calculo.producto,
    }
    arbol = ast.fix_missing_locations(_ConLimites().visit(arbol))
    # Los nombres van en globals para que se vean también dentro de los generadores.
    return eval(compile(arbol, "<verificacion>", "eval"), {"__builtins__": {}, **seguros})


RE_NUMERO = r"-?\d+(?:,\d+)?"
RE_MILES = r"-?\d{1,3}(?:[ .]\d{3})+(?:,\d+)?"


def a_float(texto: str) -> float:
    return float(texto.replace(" ", "").replace(".", "").replace(",", "."))


def valor_respuesta(respuesta: str):
    """Valor numérico de una respuesta como «36», «2,5», «1/36», «9π», «π/2», «10 000», «25 %», «Raíz de 3»."""
    r = respuesta.strip().replace("−", "-")
    m = re.match(rf"^(?P<coef>{RE_NUMERO})?\s*(?:√|ra[ií]z(?: cuadrada)? de\s*)(?P<rad>{RE_NUMERO})", r, re.IGNORECASE)
    if m:
        coef = float(m.group("coef").replace(",", ".")) if m.group("coef") else 1.0
        return coef * math.sqrt(float(m.group("rad").replace(",", ".")))
    m = re.match(rf"^(?P<coef>{RE_NUMERO}(?:/\d+)?)?\s*π(?:\s*/\s*(?P<div>\d+))?", r)
    if m and "π" in r:
        coef = m.group("coef")
        valor = float(Fraction(coef.replace(",", "."))) if coef else 1.0
        if m.group("div"):
            valor /= int(m.group("div"))
        return valor * math.pi
    m = re.match(rf"^({RE_NUMERO})\s*/\s*(\d+)", r)
    if m:
        return a_float(m.group(1)) / int(m.group(2))
    m = re.match(rf"^({RE_MILES})(?!\d)", r)
    if m:
        return a_float(m.group(1))
    m = re.match(rf"^({RE_NUMERO})(?!\d)", r)
    if m:
        return float(m.group(1).replace(",", "."))
    return None


# ------------------------------------------------------------- validación

class Informe:
    def __init__(self):
        self.errores: list[str] = []
        self.avisos: list[str] = []

    def error(self, donde: str, msg: str):
        self.errores.append(f"{donde}: {msg}")

    def aviso(self, donde: str, msg: str):
        self.avisos.append(f"{donde}: {msg}")


def cargar_config() -> dict:
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def categorias_del_banco(config: dict) -> list[dict]:
    """Las categorías del tablero y los temas que elige cada jugador, que tienen el mismo formato."""
    return config["categorias"] + config.get("temas", {}).get("lista", [])


def ids_temas(config: dict) -> set[str]:
    return {t["id"] for t in config.get("temas", {}).get("lista", [])}


def cargar_banco(config: dict, inf: Informe) -> list[dict]:
    preguntas = []
    for cat in categorias_del_banco(config):
        ruta = APP / cat["archivo"]
        if not ruta.exists():
            inf.error(str(ruta.relative_to(RAIZ)), "no existe")
            continue
        datos = json.loads(ruta.read_text(encoding="utf-8"))
        if datos.get("categoria") != cat["id"]:
            inf.error(ruta.name, f"el campo «categoria» debería ser «{cat['id']}»")
        for p in datos.get("preguntas", []):
            p["_archivo"] = ruta.name
            preguntas.append(p)
    return preguntas


def validar_pregunta(p: dict, config: dict, inf: Informe):
    donde = p.get("id") or f"{p.get('_archivo')}:(sin id)"
    cats = {c["id"]: c for c in categorias_del_banco(config)}
    nmin, nmax = config["niveles"]["min"], config["niveles"]["max"]

    for campo, tipo in [("id", str), ("v", int), ("categoria", str), ("subtema", str), ("nivel", int),
                        ("pregunta", str), ("respuesta", str), ("tambien_vale", list), ("origen", str)]:
        if not isinstance(p.get(campo), tipo) or isinstance(p.get(campo), bool):
            inf.error(donde, f"falta «{campo}» o no es {tipo.__name__}")
            return
    for campo in ("criterio", "explicacion", "verificacion"):
        if p.get(campo) is not None and not isinstance(p[campo], str):
            inf.error(donde, f"«{campo}» debe ser texto o null")

    cat = cats.get(p["categoria"])
    if not cat:
        inf.error(donde, f"categoría desconocida «{p['categoria']}»")
        return
    if p["_archivo"] != Path(cat["archivo"]).name:
        inf.error(donde, f"está en {p['_archivo']} pero su categoría es «{p['categoria']}»")
    if p["subtema"] not in {s["id"] for s in cat["subtemas"]}:
        inf.error(donde, f"subtema desconocido «{p['subtema']}»")
    prefijo = f"{p['categoria'][:3]}-{p['subtema'][:3]}-"
    if not re.fullmatch(re.escape(prefijo) + r"\d{2,4}", p["id"]):
        inf.error(donde, f"el id debería tener la forma {prefijo}NN")
    if p["v"] < 1:
        inf.error(donde, "«v» empieza en 1")
    if not nmin <= p["nivel"] <= nmax:
        inf.error(donde, f"nivel fuera de rango ({nmin}–{nmax})")
    if p["origen"] not in ORIGENES:
        inf.error(donde, f"origen desconocido «{p['origen']}»")

    texto = p["pregunta"].strip()
    if not re.search(r"¿[^¿?]+\?", texto):
        inf.error(donde, "la pregunta debe contener una interrogación completa, entre «¿» y «?»")
    if len(texto) > 220:
        inf.aviso(donde, f"pregunta larga para leer en voz alta ({len(texto)} caracteres)")
    respuesta = p["respuesta"].strip()
    if not respuesta:
        inf.error(donde, "respuesta vacía")
    elif len(respuesta) > 60:
        inf.error(donde, f"respuesta demasiado larga ({len(respuesta)} caracteres)")
    if any(not isinstance(x, str) or not x.strip() for x in p["tambien_vale"]):
        inf.error(donde, "«tambien_vale» solo admite textos no vacíos")
    if p.get("explicacion") and len(p["explicacion"]) > 240:
        inf.aviso(donde, "explicación larga")

    bajo = texto.lower()
    for palabra in PALABRAS_PROHIBIDAS:
        if palabra in bajo:
            inf.error(donde, f"contiene «{palabra}» (ver normas de redacción)")
    for palabra in PALABRAS_CADUCAN:
        if re.search(rf"\b{re.escape(palabra)}\b", bajo):
            inf.aviso(donde, f"«{palabra}»: ¿es un hecho que puede caducar?")
    if normalizar(respuesta) and len(normalizar(respuesta)) > 3 and normalizar(respuesta) in normalizar(texto):
        inf.aviso(donde, "la respuesta aparece dentro de la pregunta")

    validar_mapa(p, cat, config, donde, inf)

    clave = (p["categoria"], p["subtema"])
    if clave in SUBTEMAS_VERIFICABLES and not p.get("verificacion"):
        inf.error(donde, "falta «verificacion» (obligatoria en cálculo, geometría y probabilidad)")
    if p.get("verificacion"):
        verificar_mates(p, donde, inf)


def _numero(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def validar_mapa(p: dict, cat: dict, config: dict, donde: str, inf: Informe):
    """Preguntas de mapa (categorías con «tipo»: «mapa»): se señala un punto y puntúa la distancia."""
    es_mapa = cat.get("tipo") == "mapa"
    if not es_mapa:
        if p.get("tipo") == "mapa" or any(k in p for k in ("lat", "lon", "distancia_max_km")):
            inf.error(donde, f"las preguntas de mapa van en una categoría de mapa, no en «{cat['id']}»")
        return
    if p.get("tipo") != "mapa":
        inf.error(donde, "en esta categoría las preguntas son de mapa: falta «tipo»: «mapa»")
        return
    lat, lon = p.get("lat"), p.get("lon")
    if not (_numero(lat) and -80 <= lat <= 80):
        inf.error(donde, "«lat» debe ser un número entre −80 y 80 (el mapa no llega a los polos)")
    if not (_numero(lon) and -180 <= lon <= 180):
        inf.error(donde, "«lon» debe ser un número entre −180 y 180")
    distancias = config.get("mapa", {}).get("distancias_km", [])
    if p.get("distancia_max_km") not in distancias:
        inf.error(donde, f"«distancia_max_km» debe ser una de {distancias}")
    vista = p.get("vista")
    if vista is not None and vista not in config.get("mapa", {}).get("vistas", {}):
        inf.error(donde, f"vista desconocida «{vista}»")
    if p.get("verificacion"):
        inf.error(donde, "una pregunta de mapa no lleva «verificacion»")


def verificar_mates(p: dict, donde: str, inf: Informe):
    try:
        esperado = float(evaluar(p["verificacion"]))
    except Exception as exc:  # noqa: BLE001 — se informa cualquier fallo de la expresión
        inf.error(donde, f"no se puede calcular la verificación: {exc}")
        return
    valor = valor_respuesta(p["respuesta"])
    if valor is None:
        inf.error(donde, f"no entiendo el número de la respuesta «{p['respuesta']}»")
        return
    if not math.isclose(valor, esperado, rel_tol=1e-6, abs_tol=1e-9):
        pista = " ¿Decimales con punto? En el banco van con coma: 2,5." if re.search(r"\d\.\d{1,2}(?!\d)", p["respuesta"]) else ""
        inf.error(donde, f"la respuesta «{p['respuesta']}» ({valor:g}) no coincide con la verificación ({esperado:g}).{pista}")


def validar_duplicados(preguntas: list[dict], inf: Informe):
    ids = {}
    for p in preguntas:
        if p.get("id") in ids:
            inf.error(p["id"], "id repetido")
        ids[p.get("id")] = p
    por_cat: dict[str, list[dict]] = {}
    for p in preguntas:
        if isinstance(p.get("pregunta"), str):
            por_cat.setdefault(p.get("categoria"), []).append(p)
    for lista in por_cat.values():
        normal = [(p, normalizar(p["pregunta"])) for p in lista]
        for i, (a, ta) in enumerate(normal):
            for b, tb in normal[i + 1:]:
                if ta == tb:
                    inf.error(b["id"], f"pregunta idéntica a {a['id']}")
                    continue
                if abs(len(ta) - len(tb)) > 0.4 * max(len(ta), len(tb)):
                    continue
                if SequenceMatcher(None, ta, tb).ratio() >= SIMILITUD_AVISO and jaccard(ta, tb) >= 0.6:
                    inf.aviso(b["id"], f"muy parecida a {a['id']}")
        respuestas: dict[tuple, list[str]] = {}
        for p in lista:
            respuestas.setdefault((p["subtema"], normalizar(p["respuesta"])), []).append(p["id"])
        for (sub, resp), lista_ids in respuestas.items():
            if len(lista_ids) > 1 and not re.fullmatch(r"[0-9 ]+", resp):
                inf.aviso(", ".join(lista_ids), f"misma respuesta «{resp}» en el subtema {sub}")


def matriz_cobertura(preguntas: list[dict], config: dict) -> dict:
    nmin, nmax = config["niveles"]["min"], config["niveles"]["max"]
    matriz = {}
    for cat in categorias_del_banco(config):
        for sub in cat["subtemas"]:
            matriz[(cat["id"], sub["id"])] = {n: 0 for n in range(nmin, nmax + 1)}
    for p in preguntas:
        celda = matriz.get((p.get("categoria"), p.get("subtema")))
        if celda is not None and p.get("nivel") in celda:
            celda[p["nivel"]] += 1
    return matriz


def validar_lock(preguntas: list[dict], inf: Informe, ruta: Path | None = None, huella_de=None) -> dict:
    """Compara cada pregunta (o ronda, con su `ruta` y su `huella_de`) con su archivo de control."""
    ruta = ruta or LOCK
    huella_de = huella_de or huella
    lock = json.loads(ruta.read_text(encoding="utf-8")) if ruta.exists() else {}
    actuales = {}
    for p in preguntas:
        if not isinstance(p.get("id"), str) or not isinstance(p.get("v"), int):
            continue
        h = huella_de(p)
        actuales[p["id"]] = {"v": p["v"], "huella": h}
        previo = lock.get(p["id"])
        if not previo:
            continue
        if p["v"] < previo["v"]:
            inf.error(p["id"], f"la versión ha bajado ({previo['v']} → {p['v']})")
        elif p["v"] == previo["v"] and h != previo["huella"]:
            inf.error(p["id"], "el texto ha cambiado pero «v» no: súbela para no mezclar datos")
    # Las preguntas borradas se quedan en el control, marcadas, para que su id no se reutilice
    # (otra pregunta con el mismo id y la misma versión mezclaría sus datos en la calibración).
    for id_, previo in lock.items():
        if id_ not in actuales:
            if not previo.get("eliminada"):
                inf.aviso(id_, "ya no está; para quitar preguntas es mejor retirarlas en ajustes (su id no se reutilizará)")
            actuales[id_] = {**previo, "eliminada": True}
    return actuales


def imprimir_cobertura(matriz: dict, minimo: int, config: dict):
    temas = ids_temas(config)
    nmin, nmax = config["niveles"]["min"], config["niveles"]["max"]
    print("\nCobertura (preguntas por subtema y nivel):")
    print(f"{'':28}" + "".join(f"{n:>4}" for n in range(nmin, nmax + 1)) + "  total")
    for (cat, sub), celdas in matriz.items():
        tope = MIN_CELDA_TEMA if cat in temas else minimo
        fila = "".join(f"{celdas[n]:>4}" if celdas[n] >= tope else f"{'*' + str(celdas[n]):>4}" for n in range(nmin, nmax + 1))
        print(f"{cat + '/' + sub:28}{fila}  {sum(celdas.values()):>5}")
    print(f"(* = menos de {minimo}; en los temas, menos de {MIN_CELDA_TEMA})")


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--actualizar", action="store_true", help="actualiza preguntas.lock.json si no hay errores")
    ap.add_argument("--min-celda", type=int, default=2, help="mínimo de preguntas por subtema y nivel (2)")
    ap.add_argument("--candidatas", type=Path, help="valida un archivo de candidatas contra el banco")
    ap.add_argument("--silencioso", action="store_true", help="no muestra avisos ni la tabla de cobertura")
    ap.add_argument("--curvas", action="store_true", help="muestra lo difícil que es cada ronda divertida")
    args = ap.parse_args(argv)

    config = cargar_config()
    inf = Informe()
    banco = cargar_banco(config, inf)

    if args.candidatas:
        datos = json.loads(args.candidatas.read_text(encoding="utf-8"))
        candidatas = datos.get("preguntas", [])
        cats = {c["id"]: c for c in categorias_del_banco(config)}
        for p in candidatas:
            p["_archivo"] = Path(cats.get(p.get("categoria"), {}).get("archivo", "?")).name
            validar_pregunta(p, config, inf)
        validar_duplicados(banco + candidatas, inf)
        ids_cand = {p.get("id") for p in candidatas if p.get("id")}
        menciona = lambda texto: any(re.search(rf"(?<![\w-]){re.escape(i)}(?![\w-])", texto) for i in ids_cand)  # noqa: E731
        inf.errores = [e for e in inf.errores if e.split(":")[0] in ids_cand or e.startswith(":(sin id)") or "(sin id)" in e.split(":")[0]]
        inf.avisos = [a for a in inf.avisos if menciona(a)]
        print(f"Candidatas: {len(candidatas)}")
    else:
        for p in banco:
            validar_pregunta(p, config, inf)
        validar_duplicados(banco, inf)
        matriz = matriz_cobertura(banco, config)
        temas = ids_temas(config)
        for (cat, sub), celdas in matriz.items():
            minimo = MIN_CELDA_TEMA if cat in temas else args.min_celda
            vacias = [n for n, k in celdas.items() if k < minimo]
            if vacias:
                inf.error(f"{cat}/{sub}", f"menos de {minimo} preguntas en los niveles {vacias}")
        actuales = validar_lock(banco, inf)
        # Rondas divertidas: su propio formato y su propio archivo de control.
        import validar_finales as vf
        import validar_rondas as vr

        rondas = vr.cargar_rondas(inf)
        vr.validar_rondas(rondas, inf)
        actuales_rondas = validar_lock(rondas, inf, vr.LOCK_RONDAS, vr.huella_ronda)
        finales = vf.cargar_finales(inf)
        vf.validar_finales(finales, inf, banco, rondas)
        actuales_finales = validar_lock(finales, inf, vf.LOCK_FINALES, vf.huella_final)
        print(f"Preguntas en el banco: {len(banco)}")
        print(vr.resumen(rondas))
        if args.curvas:
            for linea in vr.curvas(rondas, config):
                print("  ·", linea)
        print(vf.resumen(finales))
        if not args.silencioso:
            imprimir_cobertura(matriz, args.min_celda, config)

    if inf.avisos and not args.silencioso:
        print(f"\nAvisos ({len(inf.avisos)}):")
        for a in inf.avisos:
            print("  ·", a)
    if inf.errores:
        print(f"\nErrores ({len(inf.errores)}):")
        for e in inf.errores:
            print("  ✗", e)
        return 1

    if args.actualizar and not args.candidatas:
        for ruta, datos in ((LOCK, actuales), (vr.LOCK_RONDAS, actuales_rondas), (vf.LOCK_FINALES, actuales_finales)):
            ruta.write_text(json.dumps(dict(sorted(datos.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            print(f"\nActualizado {ruta.relative_to(RAIZ)}")
    print("\nSin errores.")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(principal())
