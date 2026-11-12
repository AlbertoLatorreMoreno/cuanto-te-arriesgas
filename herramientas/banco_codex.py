"""Ampliar el banco con Codex (la CLI de OpenAI, con la cuenta del usuario). Tres agentes, cada uno una llamada
distinta a Codex, sin memoria de las otras, y entre ellos las comprobaciones de este script:

    temas     propone temas nuevos, masivos y de nicho, con sus subtemas y rincones (banco_temas.md); el usuario
              aprueba los que quiera en banco_temas.json («aprobado»: true) y desde entonces son un flujo más.
    redactor  escribe un lote de preguntas de un subtema, con sus 7 opciones del modo solo (banco_generar.md).
    revisor   las audita sin contexto: responde por su cuenta, pone nivel y notas, y arregla opciones flojas
              (banco_auditar.md). Lo que descarta vuelve al redactor del lote siguiente como lecciones.

Uso:
    py herramientas/banco_codex.py temas [--masivos 8] [--nicho 8] [--pista "…"]
    py herramientas/banco_codex.py estado                         # cuántas hay y cuántas faltan
    py herramientas/banco_codex.py lanzar [--paralelo 6] [--solo ciencias/biologia ...] [--rondas 8]
    py herramientas/banco_codex.py medir                          # tokens gastados, por agente y por pregunta aceptada
    py herramientas/banco_codex.py muestra [--n 8] [--solo ...]   # aceptadas al azar, para leerlas
    py herramientas/banco_codex.py incorporar                     # pasa las aceptadas al banco (y sus opciones), con ids nuevos
    py herramientas/validar_banco.py --actualizar                 # y después, siempre, el validador
    py herramientas/opciones_codex.py preparar | lanzar | incorporar   # opciones de las que se quedaron sin ellas

Cada subtema es un «flujo» de rondas: el redactor escribe un lote; aquí se comprueba (formato, cálculo de mates,
palabras que caducan, duplicados con todo el banco y con lo nuevo, datos de las finales, opciones…); y el revisor lo
audita. En mates, el revisor resuelve cada pregunta sin ver la respuesta, y en Localízalo da las coordenadas sin ver
las propuestas: si no coincide, se descarta. Solo entra lo que aprueba el revisor; lo que corrige vuelve a auditarse
una vez. Los flujos van en paralelo y las rondas de un flujo, una detrás de otra, para que cada lote vea lo anterior.
Todo queda en herramientas/banco_lotes (en .gitignore) y se puede retomar.

Gasto (medido el 10-11-2026 sobre 145 llamadas del flujo anterior: 5 millones de tokens, unos 2900 por pregunta
aceptada, el 60 % de razonamiento). Lo que lo baja aquí: cada mensaje lleva solo las secciones de las instrucciones
y de la rúbrica que le tocan; en vez de la lista de preguntas que ya existen, solo sus respuestas (los duplicados
los detecta este script); el revisor no recibe esa lista y contesta en corto (los detalles, solo de las que fallan);
las opciones del modo solo salen en la misma pasada; y el razonamiento es «medium» salvo donde el revisor tiene que
resolver o situar por su cuenta (mates y mapa). Cada llamada apunta sus tokens en banco_lotes/tokens.jsonl.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import opciones_codex as oc  # noqa: E402
import validar_banco as vb  # noqa: E402
import validar_finales as vf  # noqa: E402
import validar_opciones as vo  # noqa: E402

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
LOTES = AQUI / "banco_lotes"
GENERAR = AQUI / "banco_generar.md"
AUDITAR = AQUI / "banco_auditar.md"
PROPONER = AQUI / "banco_temas.md"
RUBRICA = RAIZ / "docs" / "rubrica_niveles.md"
NICHOS = AQUI / "banco_nichos.json"
TEMAS_PROPUESTOS = AQUI / "banco_temas.json"
RINCONES_POR_LOTE = 3

# Con qué modelo y cuánto razonamiento trabaja cada agente (se cambian con --modelo-… y --esfuerzo-…). El revisor
# «difícil» es el de mates y mapa: ahí resuelve o sitúa por su cuenta, y es lo que decide si la pregunta entra.
MODELO = "gpt-6.1-sol"
AGENTES = {"temas": [MODELO, "medium"], "generar": [MODELO, "medium"], "auditar": [MODELO, "medium"], "auditar_dificil": [MODELO, "high"]}
# Cada llamada a Codex arrastra sus instrucciones de agente de programación y la descripción de sus herramientas: unos
# 16 000 tokens fijos por turno del modelo (medido el 10-11-2026 con un mensaje de una línea), que aquí no sirven de
# nada. Con unas instrucciones mínimas y sin las herramientas se quedan en unos 7500.
INSTRUCCIONES_BASE = ("Escribes y revisas preguntas para un juego de preguntas en español de España. Todo lo que necesitas está en el "
                      "mensaje: no uses herramientas ni archivos. Responde solo con lo que se te pide.\n")
SIN_HERRAMIENTAS = ["apps", "browser_use", "browser_use_external", "computer_use", "image_generation", "multi_agent", "plugins",
                    "shell_tool", "unified_exec", "sleep_tool", "view_image", "goals", "skill_search", "tool_suggest",
                    "collaboration_modes", "hooks"]
SUBTEMAS_TEMA = 4       # los de un tema propuesto
MAX_LECCIONES = 8       # motivos de descarte que se le cuentan al redactor del lote siguiente

# Cuántas preguntas tendrá cada archivo, repartidas por igual entre sus subtemas y niveles.
OBJETIVO = {"ciencias": 850, "historia": 850, "entretenimiento": 850, "mates": 850, "geohistoria": 390}
OBJETIVO_TEMA = 200
# Y además, en cada subtema y nivel, estas de rincones nicho (banco_nichos.json). Las pidió el usuario el 9-11-2026,
# con la mitad de la ampliación hecha, para que también los subtemas ya completos tuvieran preguntas de nicho.
EXTRA_NICHO, EXTRA_NICHO_TEMA = 3, 1
POR_LLAMADA = 40
MIN_LOTE = 12       # nunca se pide menos: una llamada pequeña gasta casi lo mismo que una grande
MARGEN = 1.15       # se pide algo más de lo que falta, porque la comprobación y el auditor descartan
MAX_RONDAS = 15
TIEMPO_MAX = 20 * 60  # por llamada a Codex: las buenas tardan de 1 a 13 min; alguna se cuelga

ZONAS = {"espana": 200, "europa": 1000, "resto": 3000}
CAJAS_ESPANA = [(35.1, 44.0, -9.6, 4.6), (27.4, 29.6, -18.4, -13.2)]  # (lat mín, lat máx, lon mín, lon máx)
CAJA_EUROPA = (20.0, 72.0, -32.0, 63.0)
CON_VERIFICACION = vb.SUBTEMAS_VERIFICABLES | {("mates", "series_num")}
UMBRAL_REVELA_TEMA = 4   # preguntas del mismo tema que nombran la respuesta (ver la rúbrica)
UMBRAL_REVELA = 8
RE_LIMITE = re.compile(r"usage limit|rate limit|\b429\b|quota|too many requests|try again later", re.I)
# Mates: los números del enunciado van en cifras (pedido por el usuario el 10-11-2026). «Un» y «uno» no cuentan:
# casi siempre son artículo o pronombre («un dado», «cada uno»).
RE_NUMERO_EN_LETRA = re.compile(r"\b(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|diecisiete|"
                                r"dieciocho|diecinueve|veinte|veinti\w+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|"
                                r"(?<!por )ciento|doscient[oa]s|trescient[oa]s|quinient[oa]s|mil)\b", re.I)  # «por ciento» sí vale
RE_SECCION = re.compile(r"^<!-- seccion: (\w+) -->\s*$", re.M)

# Como clavesRespuesta() de app/js/banco.js: lo que la app busca en otros textos para no delatar una respuesta.
GENERICAS = {"cero", "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
             "medio", "tercio", "cuarto", "sexto", "todos", "todas", "ninguno", "igual", "primero", "segundo"}
ZONA_SITIO = re.compile(r"^(norte|sur|este|oeste|noreste|noroeste|sureste|suroeste|centro|frontera|junto|cerca|entre|frente|mar|"
                        r"oceano|pacifico|atlantico|indico|artico)\b")
ARTICULO = re.compile(r"^(el|la|los|las|lo|un|una|en) ")

_imprimir = threading.Lock()


def avisar(texto: str):
    linea = f"{time.strftime('%H:%M:%S')} {texto}"
    with _imprimir:
        print(linea, flush=True)
        LOTES.mkdir(parents=True, exist_ok=True)
        with (LOTES / "progreso.log").open("a", encoding="utf-8") as f:
            f.write(linea + "\n")


# ------------------------------------------------------------------ Codex

def codex() -> str:
    for c in (shutil.which("codex"), Path(os.environ.get("USERPROFILE", "")) / ".codex" / ".sandbox-bin" / "codex.exe"):
        if c and Path(c).exists():
            return str(c)
    sys.exit("No encuentro la CLI de Codex (codex). Instálala o añádela al PATH.")


def extraer_json(texto: str) -> dict:
    texto = re.sub(r"^```(?:json)?\s*|\s*```$", "", texto.strip())
    return json.loads(texto[texto.find("{"): texto.rfind("}") + 1])


MESES = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def segundos_hasta_reintento(registro: str, ahora: float | None = None) -> float:
    """Con un límite de uso, Codex dice cuándo volver («try again at 9:03 PM», a veces con la fecha:
    «at Nov 8th, 2026 9:03 PM»). Hasta entonces (y dos minutos más); si no lo entiende, 20 minutos."""
    ahora = time.time() if ahora is None else ahora
    m = re.search(r"try again at (?:(?P<mes>[A-Za-z]{3})[a-z]* (?P<dia>\d{1,2})(?:st|nd|rd|th)?,? (?:(?P<anyo>\d{4}),? )?)?"
                  r"(?P<h>\d{1,2}):(?P<min>\d{2})\s*(?P<ampm>[AP]M)", registro, re.I)
    if not m:
        return 20 * 60
    h = int(m["h"]) % 12 + (12 if m["ampm"].upper() == "PM" else 0)
    t = time.localtime(ahora)
    anyo = int(m["anyo"]) if m["anyo"] else t.tm_year
    mes = MESES.get((m["mes"] or "").lower()[:3], t.tm_mon)
    dia = int(m["dia"]) if m["dia"] else t.tm_mday
    objetivo = time.mktime((anyo, mes, dia, h, int(m["min"]), 0, 0, 0, -1))
    if not m["dia"] and objetivo < ahora - 60:
        objetivo += 24 * 3600
    return max(60.0, objetivo - ahora + 120)


def corta(ruta: Path):
    """La ruta dentro del proyecto, para enseñarla."""
    try:
        return ruta.relative_to(RAIZ)
    except ValueError:
        return ruta


def mil(n) -> str:
    return f"{round(n):,}".replace(",", ".")


def uso_de(eventos: str) -> dict | None:
    """Los tokens de una llamada, del último «turn.completed» de `codex exec --json`: entrada (con la parte que
    salió de la caché), salida (que incluye el razonamiento) y gasto = entrada sin caché + salida."""
    for linea in reversed(eventos.splitlines()):
        if '"turn.completed"' not in linea:
            continue
        try:
            u = json.loads(linea).get("usage") or {}
        except ValueError:
            continue
        entrada, cache, salida = (int(u.get(k) or 0) for k in ("input_tokens", "cached_input_tokens", "output_tokens"))
        return {"entrada": entrada, "cache": cache, "salida": salida, "razonamiento": int(u.get("reasoning_output_tokens") or 0),
                "gasto": entrada - cache + salida}
    return None


def apuntar_tokens(fila: dict):
    with _imprimir:
        LOTES.mkdir(parents=True, exist_ok=True)
        with (LOTES / "tokens.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(fila, ensure_ascii=False) + "\n")


def llamar_codex(prompt: str, esquema: dict, nombre: str, agente: str = "generar", esperar: bool = True) -> dict:
    """Una llamada a `codex exec`, sin herramientas útiles (sandbox de solo lectura en una carpeta vacía) y sin la
    configuración del usuario (sus plugins añaden unos 2000 tokens a cada llamada), con el mensaje por la entrada
    estándar y la respuesta ajustada a `esquema`. El modelo y el razonamiento son los del agente (AGENTES). Reintenta;
    si es el límite de uso de la cuenta, espera a la hora que da Codex sin gastar intentos (o falla, sin `esperar`)."""
    for carpeta in ("crudo", "esquemas", "vacia"):
        (LOTES / carpeta).mkdir(parents=True, exist_ok=True)
    ruta_esq = LOTES / "esquemas" / f"{nombre}.json"
    ruta_esq.write_text(json.dumps(esquema, ensure_ascii=False), encoding="utf-8")
    (LOTES / "crudo" / f"{nombre}.prompt.txt").write_text(prompt, encoding="utf-8")
    salida = LOTES / "crudo" / f"{nombre}.txt"
    modelo, esfuerzo = AGENTES[agente]
    ruta_base = LOTES / "instrucciones_base.txt"
    ruta_base.write_text(INSTRUCCIONES_BASE, encoding="utf-8")
    orden = [codex(), "exec", "-s", "read-only", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--json",
             "-C", str(LOTES / "vacia"), "-m", modelo, "-c", f'model_reasoning_effort="{esfuerzo}"',
             "-c", f'model_instructions_file="{ruta_base.as_posix()}"', *[x for f in SIN_HERRAMIENTAS for x in ("--disable", f)],
             "--output-schema", str(ruta_esq), "-o", str(salida)]
    ultimo, intento, esperas = "", 0, 0
    while intento < 6:
        salida.unlink(missing_ok=True)
        t0 = time.time()
        eventos = ""
        try:
            r = subprocess.run(orden + ["-"], input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace",
                               timeout=TIEMPO_MAX)
            eventos = r.stdout or ""
            registro = eventos[-4000:] + "\n" + (r.stderr or "")[-4000:]
        except subprocess.TimeoutExpired:
            registro = "tiempo agotado"
        try:
            texto = salida.read_text(encoding="utf-8")
            datos = extraer_json(texto)
            uso = uso_de(eventos) or {}
            apuntar_tokens({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "nombre": nombre, "agente": agente, "modelo": modelo,
                            "esfuerzo": esfuerzo, "segundos": round(time.time() - t0), "car_prompt": len(prompt), "car_salida": len(texto), **uso})
            detalle = (f"{mil(uso['gasto'])} tokens (entrada {mil(uso['entrada'])}, de caché {mil(uso['cache'])}; salida "
                       f"{mil(uso['salida'])}, de razonamiento {mil(uso['razonamiento'])})") if uso else "? tokens"
            avisar(f"  codex {nombre} [{modelo}, {esfuerzo}]: {time.time() - t0:.0f} s, {detalle}")
            return datos
        except Exception as exc:  # noqa: BLE001
            ultimo = f"{exc}\n{registro}"
            if RE_LIMITE.search(registro) and not esperar:
                raise RuntimeError(f"Codex está en el límite de uso ({nombre})") from exc
            if RE_LIMITE.search(registro) and esperas < 40:
                esperas += 1
                espera = segundos_hasta_reintento(registro)
                avisar(f"  codex {nombre}: límite de uso; espero hasta las {time.strftime('%H:%M', time.localtime(time.time() + espera))}")
                # A trozos y mirando el reloj: en Windows, time.sleep no cuenta el tiempo con el equipo suspendido
                # (el 8-11-2026, una suspensión de casi dos horas retrasó otro tanto la vuelta al trabajo).
                fin = time.time() + espera
                while time.time() < fin:
                    time.sleep(min(60.0, max(0.0, fin - time.time())))
                continue
            intento += 1
            (LOTES / "crudo" / f"{nombre}.error{intento}.txt").write_text(ultimo, encoding="utf-8")
            avisar(f"  codex {nombre}: fallo en el intento {intento} ({str(exc)[:80]}); espero {30 * intento} s")
            time.sleep(30 * intento)
    raise RuntimeError(f"Codex no respondió bien a {nombre}: {ultimo[:300]}")


# ------------------------------------------------------------- textos

def norm(texto) -> str:
    return vb.normalizar(str(texto or ""))


def palabras(texto_norm: str) -> set[str]:
    return {w for w in texto_norm.split() if (len(w) > 2 or w.isdigit()) and w not in vb.PALABRAS_VACIAS}


def jac(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a | b else 1.0


def nombre_del_sitio(respuesta: str) -> str:
    nombre = re.split(r"[(,]", str(respuesta))[0]
    return "" if ZONA_SITIO.match(norm(nombre)) else nombre


def claves_respuesta(p: dict) -> list[str]:
    mapa = p.get("tipo") == "mapa" or "lat" in p
    salida = []
    for r in [p.get("respuesta"), *(p.get("tambien_vale") or [])]:
        k = ARTICULO.sub("", norm(nombre_del_sitio(r) if mapa else r))
        if len(k) >= 4 and not re.fullmatch(r"[0-9 ]+", k) and k not in GENERICAS and k not in salida:
            salida.append(k)
    return salida


def texto_completo(p: dict) -> str:
    return " ".join(str(x) for x in [p.get("pregunta"), p.get("respuesta"), *(p.get("tambien_vale") or []), p.get("criterio"),
                                       p.get("explicacion")] if x)


class Ficha:
    """Lo que hace falta para comparar una pregunta con otras."""
    __slots__ = ("id", "cat", "sub", "np", "pal", "resp", "claves", "texto")

    def __init__(self, p: dict, id_: str):
        self.id = id_
        self.cat, self.sub = p.get("categoria"), p.get("subtema")
        self.np = norm(p.get("pregunta"))
        self.pal = palabras(self.np)
        self.resp = ARTICULO.sub("", norm(p.get("respuesta")))
        self.claves = claves_respuesta(p)
        self.texto = f" {norm(texto_completo(p))} "


# ----------------------------------------------------------- contexto

def cargar_propuestos() -> dict:
    if not TEMAS_PROPUESTOS.exists():
        return {"temas": []}
    datos = json.loads(TEMAS_PROPUESTOS.read_text(encoding="utf-8"))
    datos["temas"] = [t for t in datos.get("temas") or [] if isinstance(t, dict) and t.get("id") and t.get("subtemas")]
    return datos


class Contexto:
    def __init__(self):
        self.config = vb.cargar_config()
        self.cats = {c["id"]: c for c in vb.categorias_del_banco(self.config)}
        self.temas = set(vb.ids_temas(self.config))
        self.esperar = True
        # Los temas propuestos por el agente de temas y aprobados por el usuario: un flujo más, aunque la app aún
        # no los tenga (no se pueden incorporar hasta añadirlos a config.json).
        self.rincones = {k: v for k, v in json.loads(NICHOS.read_text(encoding="utf-8")).items() if isinstance(v, list)}
        for t in cargar_propuestos()["temas"]:
            if t.get("aprobado") and t["id"] not in self.cats:
                self.cats[t["id"]] = {"id": t["id"], "nombre": t["nombre"], "referencia": t.get("referencia"), "propuesto": True,
                                      "subtemas": [{"id": s["id"], "nombre": s["nombre"]} for s in t["subtemas"]]}
                self.temas.add(t["id"])
                for s in t["subtemas"]:
                    self.rincones[f"{t['id']}/{s['id']}"] = list(s.get("rincones") or [])
        self.banco = vb.cargar_banco(self.config, vb.Informe())
        self.finales = vf.cargar_finales(vb.Informe())
        self.fichas_banco = defaultdict(list)
        self.por_respuesta = defaultdict(list)
        for p in self.banco:
            f = Ficha(p, p["id"])
            self.fichas_banco[p["categoria"]].append(f)
            if f.resp:
                self.por_respuesta[f.resp].append(f)
        for f in self.finales:
            if isinstance(f, dict) and f.get("pregunta") and f.get("respuesta"):
                fi = Ficha({**f, "categoria": "finales", "subtema": "finales"}, f.get("id", "fin"))
                if fi.resp:
                    self.por_respuesta[fi.resp].append(fi)
        self.lock = threading.Lock()
        self.nuevas: dict[tuple, list[dict]] = {}
        self._cache: dict[tuple, Ficha] = {}

    def es_mapa(self, cat: str) -> bool:
        return self.cats[cat].get("tipo") == "mapa"

    def subtema(self, cat: str, sub: str) -> dict:
        return next(s for s in self.cats[cat]["subtemas"] if s["id"] == sub)

    def objetivo_celda(self, cat: str) -> int:
        celdas = len(self.cats[cat]["subtemas"]) * 10
        if cat in self.temas:
            return OBJETIVO_TEMA // celdas + EXTRA_NICHO_TEMA
        return OBJETIVO[cat] // celdas + EXTRA_NICHO

    def flujos(self) -> list[tuple[str, str]]:
        return [(c, s["id"]) for c in self.cats for s in self.cats[c]["subtemas"]]

    def actualizar(self, cat: str, sub: str, st: dict):
        with self.lock:
            self.nuevas[(cat, sub)] = [dict(q, categoria=cat, subtema=sub) for q in st["aceptadas"] + st["pendientes"]]

    def ficha_nueva(self, q: dict) -> Ficha:
        clave = (q["_clave"], q["pregunta"], q["respuesta"], tuple(q.get("tambien_vale") or []), q.get("explicacion"))
        if clave not in self._cache:
            self._cache[clave] = Ficha(q, q["_clave"])
        return self._cache[clave]

    def fichas_nuevas(self, excepto: str) -> list[Ficha]:
        with self.lock:
            todas = [q for lista in self.nuevas.values() for q in lista if q["_clave"] != excepto]
        return [self.ficha_nueva(q) for q in todas]


# ------------------------------------------------------------- estado

def ruta_estado(cat: str, sub: str) -> Path:
    return LOTES / "estado" / f"{cat}__{sub}.json"


def cargar_estado(cat: str, sub: str) -> dict:
    ruta = ruta_estado(cat, sub)
    base = {"aceptadas": [], "pendientes": [], "incorporadas": [], "descartadas": 0, "rondas": 0, "contador": 0}
    return {**base, **json.loads(ruta.read_text(encoding="utf-8"))} if ruta.exists() else base


def guardar_estado(cat: str, sub: str, st: dict):
    ruta = ruta_estado(cat, sub)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, ruta)


def registrar(cat: str, sub: str, evento: str, q: dict, **extra):
    (LOTES / "registro").mkdir(parents=True, exist_ok=True)
    fila = {"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "evento": evento, "clave": q.get("_clave"), "nivel": q.get("nivel"),
            "pregunta": q.get("pregunta"), "respuesta": q.get("respuesta"), **extra}
    with (LOTES / "registro" / f"{cat}__{sub}.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(fila, ensure_ascii=False) + "\n")


def huecos(ctx: Contexto, cat: str, sub: str, st: dict) -> dict[int, int]:
    obj = ctx.objetivo_celda(cat)
    c = Counter(p["nivel"] for p in ctx.banco if p["categoria"] == cat and p["subtema"] == sub)
    c.update(q["nivel"] for q in st["aceptadas"] + st["pendientes"])
    return {n: obj - c[n] for n in range(1, 11) if obj - c[n] > 0}


def pedir(faltan: dict[int, int]) -> dict[int, int]:
    """Lo que se pide en una ronda: lo que falta con margen, al menos MIN_LOTE y como mucho POR_LLAMADA. Lo que
    sobre al final (más de lo que cabe en una casilla) se guarda como reserva al incorporar."""
    inflado = {n: math.ceil(k * MARGEN) for n, k in faltan.items()}
    niveles, i = sorted(faltan), 0
    while sum(inflado.values()) < MIN_LOTE:
        inflado[niveles[i % len(niveles)]] += 1
        i += 1
    return repartir(inflado, POR_LLAMADA)


def repartir(faltan: dict[int, int], tope: int) -> dict[int, int]:
    pedido, total = Counter(), 0
    while total < tope and any(faltan[n] > pedido[n] for n in faltan):
        for n in sorted(faltan):
            if faltan[n] > pedido[n] and total < tope:
                pedido[n] += 1
                total += 1
    return dict(pedido)


# ------------------------------------------------------- comprobación

def texto_limpio(x) -> str:
    return re.sub(r"\s+", " ", str(x or "")).strip()


def limpiar(c: dict, mapa: bool, mates: bool = False) -> dict:
    def entero(x):
        try:
            return int(x)
        except (TypeError, ValueError):
            return 0
    respuesta = texto_limpio(c.get("respuesta")).rstrip(".").strip()
    # En mates, si la respuesta es un número, sus variantes en letra se quitan («Treinta», «La mitad», «Tres cuartos»):
    # el grupo las acepta sin que se lo digan, y como clave de la respuesta coinciden con decenas de enunciados (la app
    # daría la pregunta por delatada, y duplicado() la descartaba: unas 60 de mates en el flujo anterior, ya pagadas).
    numerica = mates and vb.valor_respuesta(respuesta) is not None
    variantes = []
    for v in c.get("tambien_vale") or []:
        v = texto_limpio(v).rstrip(".").strip()
        if numerica and not re.search(r"\d", v):
            continue
        if v and norm(v) != norm(respuesta) and norm(v) not in {norm(x) for x in variantes}:
            variantes.append(v)
    q = {"nivel": entero(c.get("nivel")), "pregunta": texto_limpio(c.get("pregunta")), "respuesta": respuesta, "tambien_vale": variantes,
         "criterio": texto_limpio(c.get("criterio")) or None, "explicacion": texto_limpio(c.get("explicacion")) or None,
         "verificacion": texto_limpio(c.get("verificacion")) or None, "nivel_generador": entero(c.get("nivel_estimado")),
         "rincon": texto_limpio(c.get("rincon")) or None}
    if mapa:
        q.pop("verificacion")
        try:
            q["lat"], q["lon"] = round(float(c.get("lat")), 4), round(float(c.get("lon")), 4)
        except (TypeError, ValueError):
            q["lat"] = q["lon"] = None
        q["zona"] = c.get("zona")
    else:
        incorrectas = [texto_limpio(x) for x in c.get("incorrectas") or [] if texto_limpio(x)]
        if incorrectas:
            q["incorrectas"] = incorrectas
        boton = texto_limpio(c.get("boton"))
        if boton and norm(boton) != norm(respuesta):
            q["boton"] = boton
    return q


def comprobar_opciones(q: dict) -> str | None:
    """Motivo por el que las opciones de la candidata no valen, o None. Unas opciones malas no tiran la pregunta: se
    queda sin ellas (quitar_opciones) y se le harán aparte, con opciones_codex.py."""
    if not q.get("incorrectas"):
        return "no trae opciones"
    p = {"id": q["_clave"], "v": 1, "respuesta": q["respuesta"], "tambien_vale": q["tambien_vale"], "criterio": q.get("criterio"),
         "verificacion": q.get("verificacion")}
    inf = vb.Informe()
    vo.validar_entrada(p, {"v": 1, "incorrectas": q["incorrectas"], **({"correcta": q["boton"]} if q.get("boton") else {})}, inf)
    return inf.errores[0].split(": ", 1)[-1] if inf.errores else None


def quitar_opciones(cat: str, sub: str, q: dict, motivo: str):
    q.pop("incorrectas", None)
    q.pop("boton", None)
    q["_sin_opciones"] = motivo
    registrar(cat, sub, "sin_opciones", q, motivo=motivo)


def arreglar_opciones(q: dict, v: dict) -> str | None:
    """Cambia las opciones que el revisor da por malas por las que propone. Devuelve el motivo si no se puede."""
    malas = {vo.clave(x) for x in v.get("opciones_mal") or [] if texto_limpio(x)}
    if not malas or not q.get("incorrectas"):
        return None
    quedan = [x for x in q["incorrectas"] if vo.clave(x) not in malas]
    if len(q["incorrectas"]) - len(quedan) != len(malas):
        return "el revisor da por mala una opción que no está entre las incorrectas"
    claves = {vo.clave(x) for x in quedan}
    for x in (texto_limpio(x) for x in v.get("opciones_nuevas") or []):
        if x and len(quedan) < vo.INCORRECTAS and vo.clave(x) not in claves:
            quedan.append(x)
            claves.add(vo.clave(x))
    if len(quedan) != vo.INCORRECTAS:
        return "el revisor da por malas unas opciones y no propone bastantes sustitutas"
    q["incorrectas"], q["_opciones_cambiadas"] = quedan, len(malas)
    return None


def en_caja(lat: float, lon: float, caja) -> bool:
    return caja[0] <= lat <= caja[1] and caja[2] <= lon <= caja[3]


def comprobar(ctx: Contexto, cat: str, sub: str, q: dict) -> str | None:
    """Motivo para rechazar la candidata, o None si pasa."""
    mapa = ctx.es_mapa(cat)
    if not 1 <= q.get("nivel", 0) <= 10:
        return "nivel fuera de rango"
    t, r = q["pregunta"], q["respuesta"]
    if not re.search(r"¿[^¿?]+\?", t):
        return "sin interrogación completa"
    if len(t) > 220:
        return "pregunta demasiado larga"
    if not r:
        return "respuesta vacía"
    if len(r) > (60 if mapa else 50):
        return "respuesta demasiado larga"
    if any(len(v) > 60 for v in q["tambien_vale"]):
        return "variante demasiado larga"
    if not q.get("explicacion"):
        return "sin explicación"
    if len(q["explicacion"]) > 240:
        return "explicación demasiado larga"
    bajo = t.lower()
    for palabra in vb.PALABRAS_PROHIBIDAS:
        if palabra in bajo:
            return f"contiene «{palabra}»"
    for palabra in vb.PALABRAS_CADUCAN:
        if re.search(rf"\b{re.escape(palabra)}\b", bajo):
            return f"«{palabra}» puede caducar"
    if cat == "mates":
        letra = RE_NUMERO_EN_LETRA.search(t)
        if letra:
            return f"número en letra («{letra.group(0)}»): en mates van en cifras"
    for k in [norm(r), *([norm(nombre_del_sitio(r))] if mapa else [])]:
        if len(k) > 3 and k in norm(t):
            return "la respuesta está en la pregunta"
    if mapa:
        lat, lon, zona = q.get("lat"), q.get("lon"), q.get("zona")
        if not isinstance(lat, float) or not isinstance(lon, float) or not -80 <= lat <= 80 or not -180 <= lon <= 180:
            return "coordenadas fuera del mapa"
        if zona not in ZONAS:
            return "zona desconocida"
        if (sub == "espana") != (zona == "espana"):
            return "zona que no es la del subtema"
        if zona == "espana" and not any(en_caja(lat, lon, c) for c in CAJAS_ESPANA):
            return "el punto no está en España"
        if zona == "europa" and not en_caja(lat, lon, CAJA_EUROPA):
            return "el punto no está en Europa ni Oriente Próximo"
    if cat == "mates":
        if (cat, sub) in CON_VERIFICACION and not q.get("verificacion"):
            return "falta la verificación"
        if q.get("verificacion"):
            inf = vb.Informe()
            vb.verificar_mates({**q, "id": "x"}, "x", inf)
            if inf.errores:
                return inf.errores[0].split(": ", 1)[-1]
    elif q.get("verificacion"):
        q["verificacion"] = None
    motivo = duplicado(ctx, cat, sub, q)
    if motivo:
        return motivo
    inf = vb.Informe()
    vf.datos_repetidos([f for f in ctx.finales if isinstance(f, dict)], [{**q, "id": q["_clave"]}], [], inf)
    if inf.avisos:
        return "da por sabido algo de una final: " + inf.avisos[0][:120]
    return None


def duplicado(ctx: Contexto, cat: str, sub: str, q: dict) -> str | None:
    f = Ficha({**q, "categoria": cat, "subtema": sub, **({"tipo": "mapa"} if ctx.es_mapa(cat) else {})}, q["_clave"])
    nuevas = ctx.fichas_nuevas(q["_clave"])
    misma_cat = ctx.fichas_banco[cat] + [o for o in nuevas if o.cat == cat]
    numerica = bool(re.fullmatch(r"[0-9 ]+", f.resp))
    for o in misma_cat:
        if o.np == f.np:
            return f"idéntica a {o.id}"
        j = jac(o.pal, f.pal)
        if j >= 0.6 and abs(len(o.np) - len(f.np)) <= 0.4 * max(len(o.np), len(f.np)) and SequenceMatcher(None, o.np, f.np).ratio() >= vb.SIMILITUD_AVISO:
            return f"muy parecida a {o.id}"
        if j >= 0.75:
            return f"casi las mismas palabras que {o.id}"
        if f.resp and o.resp == f.resp:
            if o.sub == sub and not numerica:
                return f"misma respuesta que {o.id}, del mismo subtema"
            if j >= 0.3:
                return f"mismo dato que {o.id}"
    if f.resp:
        for o in ctx.por_respuesta.get(f.resp, []) + [o for o in nuevas if o.cat != cat and o.resp == f.resp]:
            if o.cat != cat and jac(o.pal, f.pal) >= 0.4:
                return f"mismo dato que {o.id}"
    if f.claves:
        cuenta = sum(1 for o in misma_cat if any(f" {k} " in o.texto for k in f.claves))
        if cuenta >= (UMBRAL_REVELA_TEMA if cat in ctx.temas else UMBRAL_REVELA):
            return f"su respuesta sale en {cuenta} preguntas de la categoría"
    return None


# ------------------------------------------------------------ mensajes

TEXTO, ENTERO, LISTA = {"type": "string"}, {"type": "integer"}, {"type": "array", "items": {"type": "string"}}


def objeto(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def esquema_generacion(mapa: bool, mates: bool = False, con_rincon: bool = True) -> dict:
    """Solo los campos que le tocan al lote: cada campo de más se paga en las 40 preguntas."""
    props = {"nivel": ENTERO, "pregunta": TEXTO, "respuesta": TEXTO, "tambien_vale": LISTA, "criterio": TEXTO, "explicacion": TEXTO}
    if mates:
        props["verificacion"] = TEXTO
    if mapa:
        props |= {"lat": {"type": "number"}, "lon": {"type": "number"}, "zona": {"type": "string", "enum": list(ZONAS)}}
    else:
        props |= {"incorrectas": LISTA, "boton": TEXTO}
    if con_rincon:
        props["rincon"] = TEXTO
    return objeto({"preguntas": {"type": "array", "items": objeto(props)}})


def esquema_auditoria(mapa: bool, opciones: bool = False) -> dict:
    """Una revisión corta por pregunta y los detalles solo de las que los necesitan."""
    revision = {"n": ENTERO, "propia": TEXTO, "veredicto": {"type": "string", "enum": ["ok", "corregir", "descartar"]}, "nivel": ENTERO,
                "notas": {"type": "array", "items": ENTERO}}
    if mapa:
        revision |= {"lat": {"type": "number"}, "lon": {"type": "number"}, "zona": {"type": "string", "enum": list(ZONAS)}}
    detalle = {"n": ENTERO, "motivo": TEXTO, "tambien_vale_anadir": LISTA, "pregunta": TEXTO, "respuesta": TEXTO, "criterio": TEXTO,
               "explicacion": TEXTO}
    if opciones:
        detalle |= {"opciones_mal": LISTA, "opciones_nuevas": LISTA}
    return objeto({"revisiones": {"type": "array", "items": objeto(revision)}, "detalles": {"type": "array", "items": objeto(detalle)}})


def revisiones_por_clave(datos: dict, pendientes: list[dict]) -> dict[str, dict]:
    """La respuesta corta del revisor, pregunta a pregunta (por su número en el lote) y con los nombres que usa decidir()."""
    detalles = {d.get("n"): d for d in datos.get("detalles") or [] if isinstance(d, dict)}
    salida = {}
    for r in datos.get("revisiones") or []:
        n = r.get("n") if isinstance(r, dict) else None
        if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= len(pendientes):
            continue
        d = detalles.get(n) or {}
        notas = [x if isinstance(x, int) else None for x in (r.get("notas") if isinstance(r.get("notas"), list) else [])]
        exactitud, ambiguedad, claridad = (notas + [None] * 3)[:3]
        salida[pendientes[n - 1]["_clave"]] = {
            "veredicto": r.get("veredicto"), "respuesta_propia": r.get("propia") or "", "nivel_estimado": r.get("nivel"),
            # Sin nota, la peor: una revisión a medias no aprueba nada.
            "exactitud": exactitud or 0, "ambiguedad": ambiguedad or 5, "claridad": claridad or 0,
            "motivo": d.get("motivo") or "", "tambien_vale_anadir": d.get("tambien_vale_anadir") or [],
            "correccion": {k: d.get(k) or "" for k in ("pregunta", "respuesta", "criterio", "explicacion")},
            "opciones_mal": d.get("opciones_mal") or [], "opciones_nuevas": d.get("opciones_nuevas") or [],
            **({k: r.get(k) for k in ("lat", "lon", "zona")} if mapa_en(r) else {}),
        }
    return salida


def mapa_en(revision: dict) -> bool:
    return "lat" in revision or "lon" in revision


# Instrucciones a trozos: cada mensaje lleva solo las secciones que le tocan.

def secciones(ruta: Path, incluir: set[str]) -> str:
    """Las secciones de unas instrucciones (marcadas con «<!-- seccion: nombre -->») que están en `incluir`, en su orden."""
    trozos = RE_SECCION.split(ruta.read_text(encoding="utf-8"))
    return "\n\n".join(texto.strip() for nombre, texto in zip(trozos[1::2], trozos[2::2]) if nombre in incluir)


MARCAS_RUBRICA = {"mates": "En **Mates y lógica**", "mapa": "En **Localízalo**", "tema": "En los **temas**"}


def rubrica_para(ctx: Contexto, cat: str) -> str:
    """De la rúbrica, la tabla general y el bloque de la categoría (mates, mapa o temas). Las normas de redacción no:
    ya van en las instrucciones."""
    texto = RUBRICA.read_text(encoding="utf-8").split("## Normas de redacción")[0]
    cortes = sorted((texto.index(marca), tipo) for tipo, marca in MARCAS_RUBRICA.items())
    bloques = {tipo: texto[i: cortes[j + 1][0] if j + 1 < len(cortes) else len(texto)] for j, (i, tipo) in enumerate(cortes)}
    tipo = "mates" if cat == "mates" else "mapa" if ctx.es_mapa(cat) else "tema" if cat in ctx.temas else None
    return (texto[: cortes[0][0]] + bloques.get(tipo, "")).strip()


def partes(ctx: Contexto, cat: str, opciones: bool) -> set[str]:
    return {"base", "final"} | ({"mates"} if cat == "mates" else set()) | ({"mapa"} if ctx.es_mapa(cat) else set()) | ({"opciones"} if opciones else set())


def referencia(ctx: Contexto, cat: str) -> str:
    c = ctx.cats[cat]
    if cat not in ctx.temas:
        return "Jugador de referencia: el medio de la rúbrica (adulto joven español con estudios)."
    if c.get("referencia") == "fan":
        return (f"Es un tema que elige el jugador porque le gusta: el nivel es para un fan de «{c['nombre']}» (lo sigue de verdad: ha "
                "visto las películas o series, leído los libros o jugado al juego, sin ser experto), no para el jugador medio. Una de "
                "nivel 5 la acierta la mitad de los fans.")
    return f"Es el tema «{c['nombre']}»: se elige por variedad o curiosidad, así que el nivel es el del jugador medio."


def notas_lote(ctx: Contexto, cat: str, sub: str) -> list[str]:
    lineas = [referencia(ctx, cat)]
    if cat == "mates":
        crono = ctx.config["cronometro"]
        segs = crono.get("por_subtema", {}).get(sub) or crono["segundos_por_nivel"]
        lineas.append("Cronómetro por nivel (segundos, del 1 al 10): " + ", ".join(str(s) for s in segs) + ".")
        if (cat, sub) in CON_VERIFICACION:
            lineas.append("En este subtema `verificacion` es obligatoria.")
    if ctx.es_mapa(cat):
        lineas.append("Es Localízalo (preguntas de mapa). " + ("Todas en España (zona «espana»)." if sub == "espana"
                                                               else "Todas fuera de España (zona «europa» o «resto»)."))
    if cat in ctx.temas:
        lineas.append("En un tema, la respuesta no debería ser un nombre que salga en muchas otras preguntas del tema (Harry, Voldemort, "
                      "Darth Vader…), y sus datos no pueden repetir los del banco general.")
    return lineas


def ya_usadas(ctx: Contexto, cat: str, sub: str) -> list[str]:
    """Las respuestas del subtema (de todo el tema, en los temas) que ya están en el banco o en lo nuevo: lo único
    que el redactor necesita para no repetirse. Antes iba cada pregunta entera, y era el trozo más grande del mensaje;
    los duplicados de verdad los caza duplicado(). En mates no hay lista: sus respuestas son números. En Localízalo
    van los sitios de toda la categoría: en el piloto del 10-11-2026, el redactor de un subtema repetía los sitios
    famosos de otro (Agra, Pearl Harbor, Copenhague) y se descartaban aquí, ya pagados."""
    if cat == "mates":
        return []
    mapa = ctx.es_mapa(cat)
    todo = mapa or cat in ctx.temas
    del_banco = [p for p in ctx.banco if p["categoria"] == cat and (todo or p["subtema"] == sub)]
    with ctx.lock:
        nuevas = [q for (c, s), lista in ctx.nuevas.items() if c == cat and (todo or s == sub) for q in lista]
    vistas, lista = set(), []
    for p in del_banco + nuevas:
        r = (nombre_del_sitio(p["respuesta"]) if mapa else str(p["respuesta"])).strip()
        if r and norm(r) not in vistas and not re.fullmatch(r"[0-9 .,/%π-]+", r):
            vistas.add(norm(r))
            lista.append(r)
    return lista


def ejemplos(ctx: Contexto, cat: str, sub: str, niveles, semilla: int) -> list[str]:
    rnd = random.Random(semilla)
    lineas = []
    for n in sorted(niveles):
        otros = [p for p in ctx.banco if p["categoria"] == cat and p["subtema"] != sub and p["nivel"] == n]
        if otros:
            p = rnd.choice(otros)
            lineas.append(f"- nivel {n}: {p['pregunta']} → {p['respuesta']}")
    return lineas


def rincones(ctx: Contexto, cat: str, sub: str, ronda: int) -> list[str]:
    """Los rincones poco trillados del subtema (banco_nichos.json, o los del tema propuesto) en que se centra la
    ronda: RINCONES_POR_LOTE seguidos, rotando de una ronda a otra, en un orden propio de cada subtema."""
    lista = list(ctx.rincones.get(f"{cat}/{sub}") or [])
    if not lista:
        return []
    random.Random(f"{cat}/{sub}").shuffle(lista)
    i = (max(ronda, 1) - 1) * RINCONES_POR_LOTE
    return [lista[(i + k) % len(lista)] for k in range(min(RINCONES_POR_LOTE, len(lista)))]


def texto_rincones(cat: str, elegidos: list[str]) -> list[str]:
    que = "tipos de problema" if cat == "mates" else "rincones"
    lista = ", ".join(f"«{r}»" for r in elegidos[:-1]) + f" y «{elegidos[-1]}»" if len(elegidos) > 1 else f"«{elegidos[0]}»"
    return [f"**Este lote se centra en {que} menos trillados del subtema: {lista}.** Lo típico del subtema ya está muy preguntado. "
            "Escribe al menos tres de cada cuatro preguntas sobre ellos, repartidas entre todos y entre todos los niveles: en los "
            "bajos, lo más conocido de cada uno; en los altos, lo de especialista. Nicho no quiere decir más difícil: cada pregunta "
            "tiene el nivel que se pide. Las demás, de otros " + que + " poco tratados del subtema, nunca de lo más manido. En "
            "`rincon` pon de cuál es cada pregunta (uno de estos u otro, con pocas palabras)."]


def prompt_generar(ctx: Contexto, cat: str, sub: str, pedido: dict[int, int], st: dict) -> str:
    c, s = ctx.cats[cat], ctx.subtema(cat, sub)
    total = sum(pedido.values())
    lineas = [f"Categoría: «{c['nombre']}». Subtema: «{s['nombre']}».", *notas_lote(ctx, cat, sub), ""]
    elegidos = rincones(ctx, cat, sub, st["rondas"])
    if elegidos:
        lineas += [*texto_rincones(cat, elegidos), ""]
    lineas += [f"Escribe {total} preguntas nuevas, con estos niveles:", *[f"- nivel {n}: {k}" for n, k in sorted(pedido.items())]]
    ej = ejemplos(ctx, cat, sub, pedido, st["rondas"])
    if ej:
        lineas += ["", "Una pregunta del banco de cada nivel, de otros subtemas, para calibrar:", *ej]
    if st.get("lecciones"):
        lineas += ["", "El revisor descartó estas en lotes anteriores del subtema; no repitas el error:",
                   *[f"- {x}" for x in st["lecciones"][-MAX_LECCIONES:]]]
    usadas = ya_usadas(ctx, cat, sub)
    if usadas:
        donde = "todo el tema" if cat in ctx.temas else "toda la categoría" if ctx.es_mapa(cat) else "el subtema"
        lineas += ["", f"Respuestas ya usadas en {donde} ({len(usadas)}): ninguna puede "
                   "ser tu respuesta, y no preguntes por el mismo dato con otras palabras.", " · ".join(usadas)]
    lineas += ["", "Responde solo con el JSON."]
    return "\n\n---\n\n".join([secciones(GENERAR, partes(ctx, cat, not ctx.es_mapa(cat))), rubrica_para(ctx, cat),
                               "# Este lote\n\n" + "\n".join(lineas)])


def texto_lote(pendientes: list[dict], mates: bool) -> str:
    """El lote para el revisor, en texto y numerado: menos tokens que el JSON, y él contesta con el número. En mates
    solo va el enunciado: la respuesta la saca él."""
    bloques = []
    for n, q in enumerate(pendientes, 1):
        lineas = [f"### {n} · nivel {q['nivel']}", f"Pregunta: {q['pregunta']}"]
        if not mates:
            lineas.append(f"Respuesta: {q['respuesta']}" + (f" (también valen: {'; '.join(q['tambien_vale'])})" if q["tambien_vale"] else ""))
            if q.get("criterio"):
                lineas.append(f"Criterio: {q['criterio']}")
            lineas.append(f"Explicación: {q.get('explicacion')}")
            if q.get("incorrectas"):
                lineas.append("Opciones incorrectas: " + " | ".join(q["incorrectas"]))
        bloques.append("\n".join(lineas))
    return "\n\n".join(bloques)


def con_opciones(cat: str, pendientes: list[dict]) -> bool:
    """Si el revisor mira las opciones: en mates no las ve (delatarían la respuesta, que tiene que sacar él)."""
    return cat != "mates" and any(q.get("incorrectas") for q in pendientes)


def prompt_auditar(ctx: Contexto, cat: str, sub: str, pendientes: list[dict]) -> str:
    c, s = ctx.cats[cat], ctx.subtema(cat, sub)
    lineas = [f"Categoría: «{c['nombre']}». Subtema: «{s['nombre']}».", *notas_lote(ctx, cat, sub), "",
              f"El lote ({len(pendientes)} preguntas):", "", texto_lote(pendientes, cat == "mates"), "",
              "Responde solo con el JSON, con una revisión por cada número."]
    return "\n\n---\n\n".join([secciones(AUDITAR, partes(ctx, cat, con_opciones(cat, pendientes))), rubrica_para(ctx, cat),
                               "# Este lote\n\n" + "\n".join(lineas)])


# ------------------------------------------------------------- decidir

def coincide(propia: str, q: dict, mates: bool) -> bool:
    propia = texto_limpio(propia).rstrip(".")
    if not propia:
        return not mates
    candidatas = [q["respuesta"], *q.get("tambien_vale", [])]
    vp = vb.valor_respuesta(propia.replace("pi", "π"))
    for c in candidatas:
        vc = vb.valor_respuesta(c.replace("pi", "π"))
        if vp is not None and vc is not None:
            if math.isclose(vp, vc, rel_tol=1e-3, abs_tol=1e-9):
                return True
            continue
        a, b = ARTICULO.sub("", norm(propia)), ARTICULO.sub("", norm(c))
        if a == b:
            return True
        pa, pb = {w for w in a.split() if len(w) > 2}, {w for w in b.split() if len(w) > 2}
        if pa and pb and (pa <= pb or pb <= pa):
            return True
        if SequenceMatcher(None, a, b).ratio() >= 0.85:
            return True
    return False


def haversine(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def decidir(ctx: Contexto, cat: str, q: dict, v: dict) -> tuple[str, str]:
    """('aceptar' | 'corregir' | 'descartar', motivo). Cambia q (nivel, variantes, coordenadas, corrección)."""
    mates, mapa = cat == "mates", ctx.es_mapa(cat)
    veredicto, motivo = v.get("veredicto"), texto_limpio(v.get("motivo"))
    if veredicto == "descartar":
        return "descartar", f"auditor: {motivo}"
    if mates and not coincide(v.get("respuesta_propia", ""), q, True):
        return "descartar", f"el auditor obtiene «{v.get('respuesta_propia')}»"
    if mates and veredicto != "ok":
        return "descartar", f"auditor ({veredicto}): {motivo}"
    nueva = texto_limpio((v.get("correccion") or {}).get("respuesta"))
    if mapa and veredicto == "corregir" and nueva and norm(nueva) != norm(q["respuesta"]):
        return "descartar", f"auditor: cambia el sitio ({motivo})"
    if mapa:
        try:
            d = haversine(q["lat"], q["lon"], float(v["lat"]), float(v["lon"]))
        except (TypeError, ValueError, KeyError):
            return "descartar", "el auditor no da coordenadas"
        tolerancia = max(15.0, 0.06 * ZONAS[q["zona"]])
        if v.get("zona") != q["zona"]:
            return "descartar", f"zona: {q['zona']} frente a {v.get('zona')}"
        if d > tolerancia:
            return "descartar", f"coordenadas: {d:.0f} km entre las dos estimaciones"
        q["lat"], q["lon"] = round((q["lat"] + float(v["lat"])) / 2, 4), round((q["lon"] + float(v["lon"])) / 2, 4)
        q["_dif_km"] = round(d, 1)
    if veredicto == "ok":
        if not mates and not coincide(v.get("respuesta_propia", ""), q, False):
            return "descartar", f"el auditor respondería «{v.get('respuesta_propia')}»"
        if v.get("exactitud", 0) < 4 or v.get("ambiguedad", 5) > 2 or v.get("claridad", 0) < 3:
            return "descartar", f"notas bajas (exactitud {v.get('exactitud')}, ambigüedad {v.get('ambiguedad')}, claridad {v.get('claridad')})"
    est = v.get("nivel_estimado")
    if isinstance(est, int) and 1 <= est <= 10:
        dif = est - q["nivel"]
        if abs(dif) >= 4:
            return "descartar", f"nivel {q['nivel']} y el auditor dice {est}"
        if abs(dif) >= 2:
            q["_nivel_pedido"] = q["nivel"]
            q["nivel"] = (q["nivel"] + est) // 2
    if veredicto == "corregir":
        if q.get("_revision", 0) >= 1:
            return "descartar", f"segunda corrección: {motivo}"
        corr = v.get("correccion") or {}
        for campo in ("pregunta", "respuesta", "criterio", "explicacion"):
            if texto_limpio(corr.get(campo)):
                q[campo] = texto_limpio(corr[campo]).rstrip(".") if campo == "respuesta" else texto_limpio(corr[campo])
        if corr.get("tambien_vale"):
            q["tambien_vale"] = [texto_limpio(x).rstrip(".") for x in corr["tambien_vale"] if texto_limpio(x)]
        q["_revision"] = q.get("_revision", 0) + 1
        q["_correccion"] = motivo
        anadir_variantes(q, v)
        return "corregir", motivo
    anadir_variantes(q, v)
    q["_auditoria"] = {k: v.get(k) for k in ("exactitud", "ambiguedad", "claridad", "nivel_estimado")}
    return "aceptar", ""


def anadir_variantes(q: dict, v: dict):
    vistas = {norm(q["respuesta"]), *(norm(x) for x in q["tambien_vale"])}
    for x in v.get("tambien_vale_anadir") or []:
        x = texto_limpio(x).rstrip(".")
        if x and norm(x) not in vistas and len(x) <= 60:
            q["tambien_vale"].append(x)
            vistas.add(norm(x))


# ------------------------------------------------------------- un flujo

def leccion(st: dict, q: dict, motivo: str):
    """Lo que el revisor descarta se le cuenta al redactor del lote siguiente: así los agentes cooperan sin compartir
    contexto, y un error típico del subtema no se paga en cada ronda."""
    corta = q["pregunta"] if len(q["pregunta"]) <= 90 else q["pregunta"][:89] + "…"
    st["lecciones"] = [*st.get("lecciones", []), f"{corta} → {q['respuesta']}: {motivo[:160]}"][-MAX_LECCIONES:]


def generar(ctx: Contexto, cat: str, sub: str, st: dict, pedido: dict[int, int]) -> bool:
    mapa = ctx.es_mapa(cat)
    nombre = f"{cat}__{sub}__r{st['rondas']:02d}_gen"
    try:
        esquema = esquema_generacion(mapa, cat == "mates", bool(rincones(ctx, cat, sub, st["rondas"])))
        datos = llamar_codex(prompt_generar(ctx, cat, sub, pedido, st), esquema, nombre, "generar", ctx.esperar)
    except RuntimeError as exc:
        avisar(f"{cat}/{sub}: {exc}")
        return False
    quedan = Counter(pedido)
    buenas = malas = sin_opciones = 0
    for crudo in datos.get("preguntas") or []:
        q = limpiar(crudo, mapa, cat == "mates")
        st["contador"] += 1
        q["_clave"] = f"{cat[:3]}-{sub[:3]}-n{st['contador']:04d}"
        q["_ronda"], q["_revision"], q["_flujo"] = st["rondas"], 0, 2
        if quedan[q["nivel"]] <= 0:
            motivo = "nivel no pedido o sobrante"
        else:
            motivo = comprobar(ctx, cat, sub, q)
        if motivo:
            st["descartadas"] += 1
            malas += 1
            registrar(cat, sub, "descartada_local", q, motivo=motivo)
        else:
            quedan[q["nivel"]] -= 1
            if not mapa:
                sin = comprobar_opciones(q)
                if sin:
                    quitar_opciones(cat, sub, q, sin)
                    sin_opciones += 1
            st["pendientes"].append(q)
            ctx.actualizar(cat, sub, st)
            buenas += 1
            registrar(cat, sub, "generada", q)
    avisar(f"{cat}/{sub} ronda {st['rondas']}: {buenas} pasan la comprobación, {malas} no"
           + (f"; {sin_opciones} se quedan sin opciones" if sin_opciones else ""))
    return True


def auditar(ctx: Contexto, cat: str, sub: str, st: dict):
    mates, mapa = cat == "mates", ctx.es_mapa(cat)
    pendientes = list(st["pendientes"])
    nombre = f"{cat}__{sub}__r{st['rondas']:02d}_aud{st.get('auditorias', 0) + 1}"
    st["auditorias"] = st.get("auditorias", 0) + 1
    try:
        datos = llamar_codex(prompt_auditar(ctx, cat, sub, pendientes), esquema_auditoria(mapa, con_opciones(cat, pendientes)), nombre,
                             "auditar_dificil" if mates or mapa else "auditar", ctx.esperar)
    except RuntimeError as exc:
        # Si Codex no responde, las pendientes siguen pendientes: no se descarta nada por un fallo de la llamada.
        avisar(f"{cat}/{sub}: {exc}")
        return False
    por_clave = revisiones_por_clave(datos, pendientes)
    siguen, cuenta = [], Counter()
    for q in st["pendientes"]:
        v = por_clave.get(q["_clave"])
        if not v:
            q["_sin_revision"] = q.get("_sin_revision", 0) + 1
            if q["_sin_revision"] >= 2:
                st["descartadas"] += 1
                cuenta["descartar"] += 1
                registrar(cat, sub, "descartada", q, motivo="el auditor no la revisó")
            else:
                siguen.append(q)
            continue
        accion, motivo = decidir(ctx, cat, q, v)
        cuenta[accion] += 1
        if accion != "descartar" and q.get("incorrectas"):
            sin = arreglar_opciones(q, v) or comprobar_opciones(q)
            if sin:
                quitar_opciones(cat, sub, q, sin)
        if accion == "descartar":
            leccion(st, q, motivo)
        if accion == "aceptar":
            st["aceptadas"].append(q)
            registrar(cat, sub, "aceptada", q, auditoria=q.get("_auditoria"), nivel_pedido=q.get("_nivel_pedido"))
        elif accion == "corregir":
            otra = comprobar(ctx, cat, sub, q)
            if otra:
                st["descartadas"] += 1
                registrar(cat, sub, "descartada", q, motivo=f"tras corregirla: {otra}")
            else:
                siguen.append(q)
                registrar(cat, sub, "corregida", q, motivo=motivo)
        else:
            st["descartadas"] += 1
            registrar(cat, sub, "descartada", q, motivo=motivo)
    st["pendientes"] = siguen
    avisar(f"{cat}/{sub} auditoría: {cuenta['aceptar']} aceptadas, {cuenta['corregir']} a corregir, {cuenta['descartar']} descartadas")
    return True


def flujo(ctx: Contexto, cat: str, sub: str, max_rondas: int) -> str:
    st = cargar_estado(cat, sub)
    nombre = f"{cat}/{sub}"
    fallos = 0
    try:
        while True:
            if fallos >= 3:
                return f"{nombre}: parado, el auditor no responde ({len(st['pendientes'])} pendientes guardadas)"
            faltan = huecos(ctx, cat, sub, st)
            if not faltan and not st["pendientes"]:
                return f"{nombre}: completo ({len(st['aceptadas'])} aceptadas, {st['descartadas']} descartadas)"
            if st["rondas"] >= max_rondas and not st["pendientes"]:
                return f"{nombre}: parado tras {st['rondas']} rondas; faltan {sum(faltan.values())} ({faltan})"
            if faltan and st["rondas"] < max_rondas:
                st["rondas"] += 1
                hecho = generar(ctx, cat, sub, st, pedir(faltan))
                if not hecho:
                    st["rondas"] -= 1  # una llamada fallida no gasta ronda
                guardar_estado(cat, sub, st)
                ctx.actualizar(cat, sub, st)
                if not hecho:
                    return f"{nombre}: parado, el redactor no responde ({len(st['pendientes'])} pendientes guardadas)"
            if st["pendientes"]:
                fallos = 0 if auditar(ctx, cat, sub, st) else fallos + 1
                guardar_estado(cat, sub, st)
                ctx.actualizar(cat, sub, st)
    except Exception as exc:  # noqa: BLE001 — un flujo roto no para los demás
        guardar_estado(cat, sub, st)
        return f"{nombre}: ERROR {type(exc).__name__}: {exc}"


# --------------------------------------------------------- incorporar

def escribir_banco(categoria: str, preguntas: list[dict]) -> str:
    """Una pregunta por línea y una línea en blanco entre subtemas, como el banco escrito a mano."""
    lineas = ["{", f'  "categoria": {json.dumps(categoria, ensure_ascii=False)},', '  "preguntas": [']
    for i, p in enumerate(preguntas):
        if i and p["subtema"] != preguntas[i - 1]["subtema"]:
            lineas.append("")
        lineas.append("    " + json.dumps(p, ensure_ascii=False) + ("," if i < len(preguntas) - 1 else ""))
    lineas += ["  ]", "}"]
    return "\n".join(lineas) + "\n"


def pregunta_final(cat: str, sub: str, q: dict, id_: str, mapa: bool) -> dict:
    p = {"id": id_, "v": 1, "categoria": cat, "subtema": sub, "nivel": q["nivel"]}
    if mapa:
        p["tipo"] = "mapa"
    p |= {"pregunta": q["pregunta"], "respuesta": q["respuesta"], "tambien_vale": q["tambien_vale"]}
    if q.get("criterio"):
        p["criterio"] = q["criterio"]
    if mapa:
        p |= {"lat": q["lat"], "lon": q["lon"], "distancia_max_km": ZONAS[q["zona"]]}
    if q.get("explicacion"):
        p["explicacion"] = q["explicacion"]
    if q.get("verificacion"):
        p["verificacion"] = q["verificacion"]
    p["origen"] = "generada"
    return p


def incorporar(ctx: Contexto, solo: list[str]) -> int:
    lock = json.loads(vb.LOCK.read_text(encoding="utf-8"))
    total = 0
    for cat, c in ctx.cats.items():
        if c.get("propuesto"):
            n = sum(len(cargar_estado(cat, s["id"])["aceptadas"]) for s in c["subtemas"])
            if n:
                print(f"{cat}: {n} aceptadas esperan a que el tema esté en config.json (temas.lista, con «en_preparacion»: true) y tenga su archivo")
            continue
        ruta = vb.APP / c["archivo"]
        datos = json.loads(ruta.read_text(encoding="utf-8"))
        preguntas = datos["preguntas"]
        opciones_nuevas = {}
        usados = defaultdict(set)
        for id_ in list(lock) + [p["id"] for p in preguntas]:
            m = re.fullmatch(r"(.+-)(\d+)", id_)
            if m:
                usados[m.group(1)].add(int(m.group(2)))
        orden_sub = {s["id"]: i for i, s in enumerate(c["subtemas"])}
        nuevas_cat = 0
        for s in c["subtemas"]:
            sub = s["id"]
            if solo and cat not in solo and f"{cat}/{sub}" not in solo:
                continue
            st = cargar_estado(cat, sub)
            if not st["aceptadas"]:
                continue
            # Cada casilla, hasta su objetivo: entran las de mejores notas del auditor; las demás, a la reserva.
            obj = ctx.objetivo_celda(cat)
            en_banco = Counter(p["nivel"] for p in preguntas if p["subtema"] == sub)
            nota = lambda q: (sum((q.get("_auditoria") or {}).get(k) or 0 for k in ("exactitud", "claridad"))  # noqa: E731
                              - ((q.get("_auditoria") or {}).get("ambiguedad") or 5), -q.get("_revision", 0))
            entran = []
            for nivel in range(1, 11):
                de_nivel = sorted((q for q in st["aceptadas"] if q["nivel"] == nivel), key=nota, reverse=True)
                cabe = max(0, obj - en_banco[nivel])
                entran += de_nivel[:cabe]
                st.setdefault("reserva", []).extend(de_nivel[cabe:])
            prefijo = f"{cat[:3]}-{sub[:3]}-"
            siguiente = max(usados[prefijo], default=0) + 1
            for q in sorted(entran, key=lambda x: (x["nivel"], x["_clave"])):
                id_ = f"{prefijo}{siguiente:02d}"
                siguiente += 1
                preguntas.append(pregunta_final(cat, sub, q, id_, ctx.es_mapa(cat)))
                st["incorporadas"].append({**q, "id": id_})
                nuevas_cat += 1
                if q.get("incorrectas"):
                    opciones_nuevas[id_] = {"v": 1, **({"correcta": q["boton"]} if q.get("boton") else {}), "incorrectas": q["incorrectas"]}
            st["aceptadas"] = []
            guardar_estado(cat, sub, st)
        if nuevas_cat:
            preguntas.sort(key=lambda p: (orden_sub[p["subtema"]], p["nivel"]))  # estable: lo nuevo, detrás en su casilla
            ruta.write_text(escribir_banco(datos["categoria"], preguntas), encoding="utf-8")
            print(f"{corta(ruta)}: +{nuevas_cat} (ahora {len(preguntas)})")
            total += nuevas_cat
        if opciones_nuevas:
            # Las opciones que escribió el redactor y miró el revisor, al archivo del modo solo (como opciones_codex.py).
            ruta_op = vo.archivo_opciones(ctx.config, c)
            actual = json.loads(ruta_op.read_text(encoding="utf-8")) if ruta_op.exists() else {"formato": 1, "opciones": {}, "no_aptas": {}}
            actual["opciones"] = dict(sorted({**actual.get("opciones", {}), **opciones_nuevas}.items()))
            ruta_op.parent.mkdir(parents=True, exist_ok=True)
            ruta_op.write_text(oc.escribir(actual), encoding="utf-8")
            print(f"{corta(ruta_op)}: +{len(opciones_nuevas)} con opciones")
    return total


# ---------------------------------------------------------------- otros

def estado(ctx: Contexto):
    filas, tot = [], Counter()
    for cat, sub in ctx.flujos():
        st = cargar_estado(cat, sub)
        banco = sum(1 for p in ctx.banco if p["categoria"] == cat and p["subtema"] == sub)
        obj = ctx.objetivo_celda(cat) * 10
        faltan = sum(huecos(ctx, cat, sub, st).values())
        fila = {"banco": banco, "aceptadas": len(st["aceptadas"]), "pendientes": len(st["pendientes"]), "descartadas": st["descartadas"],
                "faltan": faltan, "objetivo": obj, "nicho": sum(1 for q in st["aceptadas"] if q.get("rincon")),
                "opciones": sum(1 for q in st["aceptadas"] if q.get("incorrectas") or "lat" in q)}
        tot.update(fila)
        filas.append(f"{cat + '/' + sub:<34} banco {banco:>4}  aceptadas {fila['aceptadas']:>4} (nicho {fila['nicho']:>3})  "
                     f"pendientes {fila['pendientes']:>3}  descartadas {fila['descartadas']:>4}  faltan {faltan:>4}  (rondas {st['rondas']})")
    print("\n".join(filas))
    print(f"\nTOTAL: banco {tot['banco']}, aceptadas {tot['aceptadas']} (de nicho {tot['nicho']}; listas para jugar a solas "
          f"{tot['opciones']}), pendientes {tot['pendientes']}, descartadas {tot['descartadas']}, faltan {tot['faltan']} "
          f"(objetivo {tot['objetivo']})")


# Lo que costaba una pregunta aceptada con el flujo anterior (medido el 10-11-2026 en banco_lotes/progreso.log, con el
# razonamiento en «high» y sin opciones): la referencia de `medir`.
TOKENS_ANTES = 2900


def medir(ctx: Contexto):
    ruta = LOTES / "tokens.jsonl"
    filas = [json.loads(x) for x in ruta.read_text(encoding="utf-8").splitlines() if x.strip()] if ruta.exists() else []
    filas = [f for f in filas if "gasto" in f]
    if not filas:
        print("Todavía no hay llamadas apuntadas (banco_lotes/tokens.jsonl).")
        return
    print(f"{'agente':<16} {'llamadas':>8} {'gasto':>10} {'por llamada':>12} {'entrada':>10} {'de caché':>10} {'salida':>10} {'razonam.':>10}")
    for agente in sorted({f["agente"] for f in filas}):
        g = [f for f in filas if f["agente"] == agente]
        suma = {k: sum(f[k] for f in g) for k in ("gasto", "entrada", "cache", "salida", "razonamiento")}
        print(f"{agente:<16} {len(g):>8} {mil(suma['gasto']):>10} {mil(suma['gasto'] / len(g)):>12} {mil(suma['entrada']):>10} "
              f"{mil(suma['cache']):>10} {mil(suma['salida']):>10} {mil(suma['razonamiento']):>10}")
    # Por pregunta aceptada: solo cuentan las rondas ya auditadas del todo (sin pendientes) de este flujo.
    gasto = aceptadas = con_opciones_ = 0
    for cat, sub in ctx.flujos():
        st = cargar_estado(cat, sub)
        nuevas = [q for q in st["aceptadas"] + st["incorporadas"] if q.get("_flujo") == 2]
        llamadas = [f for f in filas if f["nombre"].startswith(f"{cat}__{sub}__") and f["agente"] != "temas"]
        if not llamadas or st["pendientes"]:
            continue
        gasto += sum(f["gasto"] for f in llamadas)
        aceptadas += len(nuevas)
        con_opciones_ += sum(1 for q in nuevas if q.get("incorrectas") or "lat" in q)
    if aceptadas:
        print(f"\nPor pregunta aceptada: {mil(gasto / aceptadas)} tokens ({aceptadas} aceptadas, {con_opciones_} listas para jugar a "
              f"solas). Antes: unos {mil(TOKENS_ANTES)}, sin opciones.")


# ---------------------------------------------------------- agente de temas

PISTA = ("Masivos como League of Legends o Taylor Swift; de nicho como tanques, aeronáutica, reguetón español o lingüística "
         "(por ejemplo, dar una palabra y adivinar el idioma).")


def identificador(texto, largo: int = 30) -> str:
    return re.sub(r"[^a-z0-9]+", "_", norm(texto)).strip("_")[:largo]


def esquema_temas() -> dict:
    subtema = objeto({"id": TEXTO, "nombre": TEXTO, "rincones": LISTA})
    tema = objeto({"id": TEXTO, "nombre": TEXTO, "corto": TEXTO, "publico": {"type": "string", "enum": ["masivo", "nicho"]},
                   "referencia": {"type": "string", "enum": ["fan", "medio"]}, "por_que": TEXTO, "riesgo": TEXTO,
                   "subtemas": {"type": "array", "items": subtema}})
    return objeto({"temas": {"type": "array", "items": tema}})


def prompt_temas(ctx: Contexto, masivos: int, nicho: int, pista: str, propuestos: list[dict]) -> str:
    generales = [c for id_, c in ctx.cats.items() if id_ not in ctx.temas]
    temas = [c["nombre"] for id_, c in ctx.cats.items() if id_ in ctx.temas] + [t["nombre"] for t in propuestos if t["id"] not in ctx.cats]
    lineas = [f"Propón {masivos} temas de público masivo y {nicho} de nicho."]
    if pista:
        lineas += ["", "Lo que ha pedido el dueño del juego, como orientación (puedes incluir estos, si cumplen todo, y otros de tu cosecha):", pista]
    lineas += ["", "Categorías generales que ya existen, con sus subtemas:",
               *[f"- {c['nombre']}: {', '.join(s['nombre'] for s in c['subtemas'])}" for c in generales],
               "", "Temas que ya existen o ya se han propuesto (no los repitas):", *[f"- {t}" for t in temas],
               "", "Responde solo con el JSON."]
    return PROPONER.read_text(encoding="utf-8").strip() + "\n\n---\n\n# Este encargo\n\n" + "\n".join(lineas)


def tema_limpio(t: dict, ocupados: set[str]) -> dict | None:
    """Un tema propuesto, con ids válidos y sus 4 subtemas, o None si no sirve o ya existe."""
    id_ = identificador(t.get("id") or t.get("nombre"))
    nombre = texto_limpio(t.get("nombre"))
    subtemas, vistos = [], set()
    for s in t.get("subtemas") or []:
        sid = identificador(s.get("id") or s.get("nombre"), 20)
        if sid and sid not in vistos and texto_limpio(s.get("nombre")):
            vistos.add(sid)
            subtemas.append({"id": sid, "nombre": texto_limpio(s["nombre"]), "rincones": [texto_limpio(r) for r in s.get("rincones") or [] if texto_limpio(r)]})
    if not id_ or not nombre or id_ in ocupados or len(subtemas) != SUBTEMAS_TEMA:
        return None
    return {"id": id_, "nombre": nombre, "corto": texto_limpio(t.get("corto"))[:14] or nombre[:14], "publico": t.get("publico"),
            "referencia": t.get("referencia") if t.get("referencia") in ("fan", "medio") else "fan", "por_que": texto_limpio(t.get("por_que")),
            "riesgo": texto_limpio(t.get("riesgo")), "aprobado": False, "subtemas": subtemas}


def escribir_propuestos(datos: dict):
    datos = {"_nota": "Temas propuestos por el agente de temas (py herramientas/banco_codex.py temas). Pon «aprobado»: true en los que "
                      "quieras: desde entonces `lanzar` escribe y revisa sus preguntas como las de cualquier subtema. Se pueden "
                      "retocar nombres, subtemas y rincones antes de aprobar; después, mejor no cambiar los ids.",
             "temas": datos["temas"]}
    TEMAS_PROPUESTOS.write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def proponer_temas(ctx: Contexto, masivos: int, nicho: int, pista: str) -> int:
    datos = cargar_propuestos()
    nombre = f"temas_{time.strftime('%Y%m%d_%H%M%S')}"
    respuesta = llamar_codex(prompt_temas(ctx, masivos, nicho, pista, datos["temas"]), esquema_temas(), nombre, "temas", ctx.esperar)
    ocupados = set(ctx.cats) | {t["id"] for t in datos["temas"]}
    nuevos = []
    for crudo in respuesta.get("temas") or []:
        t = tema_limpio(crudo, ocupados)
        if t:
            ocupados.add(t["id"])
            nuevos.append(t)
    datos["temas"] += nuevos
    escribir_propuestos(datos)
    for t in nuevos:
        print(f"- [{t['publico']}] {t['nombre']} ({t['id']}): {t['por_que']}" + (f"  Riesgo: {t['riesgo']}" if t["riesgo"] else ""))
        print("    " + " · ".join(s["nombre"] for s in t["subtemas"]))
    print(f"\n{len(nuevos)} temas nuevos en {corta(TEMAS_PROPUESTOS)}. Pon «aprobado»: true en los que quieras.")
    return len(nuevos)


def muestra(ctx: Contexto, solo: list[str], n: int):
    rnd = random.Random()
    lineas = ["# Muestra de aceptadas", ""]
    for cat, sub in ctx.flujos():
        if solo and cat not in solo and f"{cat}/{sub}" not in solo:
            continue
        st = cargar_estado(cat, sub)
        if not st["aceptadas"]:
            continue
        lineas.append(f"## {cat}/{sub} ({len(st['aceptadas'])})")
        for q in sorted(rnd.sample(st["aceptadas"], min(n, len(st["aceptadas"]))), key=lambda x: x["nivel"]):
            extra = f" [{q['lat']}, {q['lon']}, {q['zona']}, ±{q.get('_dif_km')} km]" if "lat" in q else ""
            tv = f" · también: {', '.join(q['tambien_vale'])}" if q["tambien_vale"] else ""
            cr = f" · criterio: {q['criterio']}" if q.get("criterio") else ""
            ri = f" ({q['rincon']})" if q.get("rincon") else ""
            lineas.append(f"- **{q['nivel']}**{ri} {q['pregunta']} → **{q['respuesta']}**{tv}{cr}{extra}  \n  _{q.get('explicacion')}_")
        lineas.append("")
    (LOTES / "muestra.md").write_text("\n".join(lineas), encoding="utf-8")
    print(f"Muestra en {LOTES / 'muestra.md'}")


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("accion", choices=["temas", "estado", "lanzar", "medir", "muestra", "incorporar"])
    ap.add_argument("--solo", nargs="*", default=[], help="categorías o categoria/subtema")
    ap.add_argument("--paralelo", type=int, default=6)
    ap.add_argument("--rondas", type=int, default=MAX_RONDAS, help="máximo de rondas por subtema")
    ap.add_argument("--n", type=int, default=8, help="muestra: cuántas por subtema")
    ap.add_argument("--masivos", type=int, default=8, help="temas: cuántos de público masivo")
    ap.add_argument("--nicho", type=int, default=8, help="temas: cuántos de nicho")
    ap.add_argument("--pista", default=PISTA, help="temas: lo que se busca, con palabras")
    ap.add_argument("--sin-esperar", action="store_true", help="si Codex está en su límite de uso, parar en vez de esperar")
    for agente, (modelo, esfuerzo) in AGENTES.items():
        ap.add_argument(f"--modelo-{agente.replace('_', '-')}", default=modelo, help=f"modelo del agente «{agente}» (por defecto, {modelo})")
        ap.add_argument(f"--esfuerzo-{agente.replace('_', '-')}", default=esfuerzo,
                        help=f"razonamiento del agente «{agente}»: low, medium, high… (por defecto, {esfuerzo})")
    args = ap.parse_args(argv)
    for agente in AGENTES:
        AGENTES[agente] = [getattr(args, f"modelo_{agente}"), getattr(args, f"esfuerzo_{agente}")]
    ctx = Contexto()
    ctx.esperar = not args.sin_esperar
    if args.accion == "estado":
        estado(ctx)
    elif args.accion == "temas":
        proponer_temas(ctx, args.masivos, args.nicho, args.pista)
    elif args.accion == "medir":
        medir(ctx)
    elif args.accion == "muestra":
        muestra(ctx, args.solo, args.n)
    elif args.accion == "incorporar":
        n = incorporar(ctx, args.solo)
        print(f"Incorporadas: {n}. Ahora: py herramientas/validar_banco.py --actualizar")
    else:
        for cat, sub in ctx.flujos():
            ctx.actualizar(cat, sub, cargar_estado(cat, sub))
        flujos = [(c, s) for c, s in ctx.flujos() if not args.solo or c in args.solo or f"{c}/{s}" in args.solo]
        # Intercala categorías para que todas avancen a la vez.
        por_cat = defaultdict(list)
        for c, s in flujos:
            por_cat[c].append((c, s))
        orden = [x for grupo in zip(*[l + [None] * (max(map(len, por_cat.values())) - len(l)) for l in por_cat.values()]) for x in grupo if x]
        avisar(f"Lanzo {len(orden)} flujos, {args.paralelo} a la vez")
        with ThreadPoolExecutor(args.paralelo) as ex:
            for linea in ex.map(lambda f: flujo(ctx, f[0], f[1], args.rondas), orden):
                avisar(linea)
        avisar("Terminado.")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(principal())
