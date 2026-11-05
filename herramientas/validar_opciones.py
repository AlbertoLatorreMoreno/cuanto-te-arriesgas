"""Valida las opciones del modo solo (app/data/opciones/*.json): las 7 incorrectas de cada pregunta de texto.

Uso:
    py herramientas/validar_opciones.py              # errores, avisos y cobertura por categoría y nivel
    py herramientas/validar_opciones.py --avisos     # además, lista todos los avisos

Comprueba la forma (7 textos cortos, distintos entre sí y de la respuesta y de lo que también vale), que las
opciones sean de la versión actual de la pregunta, y las trampas típicas: una incorrecta que es la respuesta en
otro formato (2,25 y 2.25), una cifra dentro del margen que da el criterio («Vale entre 7 y 7,3»), o la
trampa del criterio («No vale Guayaquil») que no está entre las incorrectas. Formato: docs/modo_solo.md.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validar_banco as vb  # noqa: E402
from validar_banco import Informe  # noqa: E402

INCORRECTAS = 7
MAX_LARGO = 60
LARGO_AVISO = 45
PROHIBIDAS = ["ninguna de las anteriores", "todas las anteriores", "ninguna", "todas", "no se sabe", "ns/nc"]
RE_ENTRE = re.compile(rf"[Vv]ale (?:cualquier (?:valor|cifra|número) )?entre ({vb.RE_NUMERO}) y ({vb.RE_NUMERO})")
RE_NO_VALE = re.compile(r"No vale ([^:.;(]+)")
ARTICULOS = re.compile(r"^(el|la|los|las|lo|un|una|unos|unas) ")


def carpeta_opciones(config: dict) -> Path:
    return vb.APP / config["solo"]["opciones"]


def archivo_opciones(config: dict, cat: dict) -> Path:
    return carpeta_opciones(config) / Path(cat["archivo"]).name


def clave(texto: str) -> str:
    """Para comparar opciones sin tildes, mayúsculas ni artículo, pero sin perder lo que distingue fórmulas y cifras:
    los subíndices («CO₂» no es «CO»), el signo y la barra («−1/4» no es «1/4»)."""
    t = unicodedata.normalize("NFKD", str(texto).replace("−", "-")).lower()
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9ñ/,.%-]+", " ", t)
    t = re.sub(r"(?<![0-9])[.,]|[.,](?![0-9])", " ", t)  # puntos y comas, solo dentro de una cifra
    return ARTICULOS.sub("", re.sub(r"\s+", " ", t).strip())


def numero(texto: str):
    t = str(texto).strip()
    # «2.25» con punto decimal (a la inglesa) es 2,25; «2.250», en cambio, son miles.
    if re.fullmatch(r"-?\d+\.(\d{1,2}|\d{4,})", t):
        t = t.replace(".", ",")
    try:
        v = vb.valor_respuesta(t)
    except (ValueError, ZeroDivisionError):
        return None
    return v if v is not None and math.isfinite(v) else None


def resto(texto: str) -> str:
    """Lo que acompaña a la cifra inicial («0 negativo» → «negativo»; «2,25» → «»)."""
    t = re.sub(rf"^\s*(?:{vb.RE_MILES}|{vb.RE_NUMERO})(?:\s*/\s*\d+)?", "", str(texto).replace("−", "-"))
    return vb.normalizar(t)


def valor_correcto(p: dict):
    if p.get("verificacion"):
        try:
            v = vb.evaluar(p["verificacion"])
            return float(v)
        except Exception:  # noqa: BLE001 — una verificación que no se evalúa ya la señala validar_banco
            pass
    return numero(p["respuesta"])


def cargar_opciones(config: dict, inf: Informe) -> tuple[dict, dict]:
    """{id: entrada} con las opciones de todos los archivos, y {id: motivo} con las no aptas."""
    opciones, no_aptas = {}, {}
    for cat in vb.categorias_del_banco(config):
        if cat.get("tipo") == "mapa":
            continue
        ruta = archivo_opciones(config, cat)
        if not ruta.exists():
            inf.aviso(ruta.name, "no hay archivo de opciones: sus preguntas no salen en el modo solo")
            continue
        try:
            datos = json.loads(ruta.read_text(encoding="utf-8"))
        except ValueError as e:
            inf.error(ruta.name, f"no es JSON válido: {e}")
            continue
        if datos.get("formato") != 1:
            inf.error(ruta.name, "falta «formato»: 1")
        for id_, o in (datos.get("opciones") or {}).items():
            if id_ in opciones or id_ in no_aptas:
                inf.error(id_, "aparece en dos sitios")
            opciones[id_] = {**o, "_archivo": ruta.name, "_categoria": cat["id"]}
        for id_, motivo in (datos.get("no_aptas") or {}).items():
            if id_ in opciones or id_ in no_aptas:
                inf.error(id_, "aparece en dos sitios")
            no_aptas[id_] = motivo
    return opciones, no_aptas


def validar_entrada(p: dict, o: dict, inf: Informe):
    id_ = p["id"]
    if o.get("v") != p.get("v"):
        inf.error(id_, f"las opciones son de la versión {o.get('v')} y la pregunta va por la {p.get('v')}: rehazlas")
    inc = o.get("incorrectas")
    if not isinstance(inc, list) or len(inc) != INCORRECTAS or not all(isinstance(x, str) and x.strip() for x in inc):
        inf.error(id_, f"tiene que tener exactamente {INCORRECTAS} incorrectas de texto")
        return
    correcta = o.get("correcta")
    if correcta is not None and (not isinstance(correcta, str) or not correcta.strip()):
        inf.error(id_, "«correcta», si está, es un texto")
        return
    textos = [correcta or p["respuesta"], *inc]
    for t in textos:
        if t != t.strip() or "  " in t:
            inf.error(id_, f"espacios de más en «{t}»")
        if len(t) > MAX_LARGO:
            inf.error(id_, f"«{t}» es demasiado larga para un botón ({len(t)} caracteres; máximo {MAX_LARGO})")
        elif len(t) > LARGO_AVISO:
            inf.aviso(id_, f"«{t}» es larga ({len(t)} caracteres)")
    claves = [clave(t) for t in inc]
    if len(set(claves)) != len(claves):
        inf.error(id_, "hay incorrectas repetidas (sin contar tildes ni mayúsculas)")
    validas = {clave(x) for x in [p["respuesta"], *(p.get("tambien_vale") or []), correcta] if x}
    for t, k in zip(inc, claves):
        if k in validas:
            inf.error(id_, f"«{t}» es una forma de la respuesta correcta")
        if k in PROHIBIDAS:
            inf.error(id_, f"«{t}» no vale como opción")
    # La respuesta metida dentro de una incorrecta («Quito Viejo» si es «Quito»), o al revés.
    for t, k in zip(inc, claves):
        for v in validas:
            if len(v) >= 4 and k != v and (re.search(rf"\b{re.escape(v)}\b", k) or (len(k) >= 4 and re.search(rf"\b{re.escape(k)}\b", v))):
                inf.aviso(id_, f"«{t}» contiene la respuesta, o está contenida en ella («{v}»)")
                break
    # Cifras: ninguna incorrecta puede valer lo mismo que la correcta, ni caer en el margen del criterio.
    # Solo si lo que acompaña a la cifra es lo mismo, o falta en una de las dos («20» y «20 m»): «0 positivo» y
    # «0 negativo» son grupos sanguíneos distintos, no el mismo número.
    correcto = valor_correcto(p)
    if correcto is not None:
        for t in inc:
            n = numero(t)
            r1, r2 = resto(t), resto(correcta or p["respuesta"])
            if n is not None and (not r1 or not r2 or r1 == r2) and math.isclose(n, correcto, rel_tol=1e-9, abs_tol=1e-9):
                inf.error(id_, f"«{t}» vale lo mismo que la respuesta ({p['respuesta']})")
    criterio = p.get("criterio") or ""
    m = RE_ENTRE.search(criterio)
    if m:
        a, b = sorted((vb.a_float(m.group(1)), vb.a_float(m.group(2))))
        for t in inc:
            n = numero(t)
            if n is not None and a <= n <= b:
                inf.error(id_, f"«{t}» cae dentro del margen del criterio ({criterio})")
    # La trampa del criterio («No vale Guayaquil») debería ser una de las incorrectas.
    # «No vale Sídney ni Melbourne»: cada una por separado.
    for trampas in RE_NO_VALE.findall(criterio):
        for trampa in re.split(r"\s+ni\s+|\s+o\s+|,\s*", trampas):
            k = clave(re.sub(r"\ba secas\b|\bsolo\b", "", trampa))
            if 0 < len(k.split()) <= 4 and not any(k == c or re.search(rf"\b{re.escape(k)}\b", c) for c in claves):
                inf.aviso(id_, f"la trampa del criterio («{trampa.strip()}») no está entre las incorrectas")


def validar(config: dict | None = None) -> tuple[Informe, dict]:
    config = config or vb.cargar_config()
    inf = Informe()
    banco = vb.cargar_banco(config, inf)
    por_id = {p["id"]: p for p in banco}
    opciones, no_aptas = cargar_opciones(config, inf)
    for id_, o in opciones.items():
        p = por_id.get(id_)
        if not p:
            inf.error(id_, f"tiene opciones en {o['_archivo']} pero no está en el banco")
            continue
        if p.get("categoria") != o["_categoria"]:
            inf.error(id_, f"sus opciones están en {o['_archivo']}, que no es el archivo de su categoría")
        if p.get("tipo") == "mapa":
            inf.error(id_, "es de mapa: no lleva opciones")
            continue
        validar_entrada(p, o, inf)
    for id_ in no_aptas:
        if id_ not in por_id:
            inf.error(id_, "está en «no_aptas» pero no está en el banco")
    # Cobertura: cuántas se pueden jugar a solas en cada categoría y nivel (las de mapa, todas).
    nmin, nmax = config["niveles"]["min"], config["niveles"]["max"]
    cobertura = {}
    for cat in vb.categorias_del_banco(config):
        fila = {n: 0 for n in range(nmin, nmax + 1)}
        for p in banco:
            if p.get("categoria") != cat["id"] or p.get("nivel") not in fila:
                continue
            if p.get("tipo") == "mapa" or (p["id"] in opciones and opciones[p["id"]].get("v") == p.get("v")):
                fila[p["nivel"]] += 1
        cobertura[cat["id"]] = fila
    sin_nada = [p["id"] for p in banco if p.get("tipo") != "mapa" and p["id"] not in opciones and p["id"] not in no_aptas]
    if sin_nada:
        inf.aviso(f"{len(sin_nada)} preguntas", "sin opciones ni marcadas como no aptas (no salen a solas): " + ", ".join(sin_nada[:12]) + ("…" if len(sin_nada) > 12 else ""))
    return inf, cobertura


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--avisos", action="store_true", help="lista todos los avisos")
    args = ap.parse_args(argv)
    config = vb.cargar_config()
    inf, cobertura = validar(config)
    print("Preguntas que se pueden jugar a solas, por nivel:")
    print("  " + " ".join(f"{n:>3}" for n in range(config["niveles"]["min"], config["niveles"]["max"] + 1)) + "  total")
    for cat, fila in cobertura.items():
        print("  " + " ".join(f"{x:>3}" for x in fila.values()) + f"  {sum(fila.values()):>5}  {cat}")
    for e in inf.errores:
        print("ERROR  " + e)
    if args.avisos:
        for a in inf.avisos:
            print("aviso  " + a)
    print(f"\n{len(inf.errores)} errores, {len(inf.avisos)} avisos" + ("" if args.avisos or not inf.avisos else " (--avisos para verlos)"))
    return 1 if inf.errores else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(principal())
