"""Genera el calendario del reto del día (app/data/retos.json): las 10 preguntas de cada día, del nivel 1 al 10.

Uso:
    py herramientas/generar_retos.py                 # amplía el calendario hasta 42 días desde hoy
    py herramientas/generar_retos.py --dias 120      # o hasta otro horizonte
    py herramientas/generar_retos.py --seco          # enseña lo que haría, sin escribir
    py herramientas/generar_retos.py --comprobar     # solo comprueba el calendario (sale con 1 si hay errores)

Los días que ya están en el calendario no se tocan nunca: cada móvil tiene que ver el mismo reto. Los nuevos:
- Los días temáticos (config.solo.dias_tematicos: miércoles y domingo) son de una sola categoría o tema, por
  turnos (config.solo.temas_dia); si a uno no le quedan preguntas para los 10 escalones, se salta.
- Los demás mezclan categorías según config.solo.mezcla (2 de cada categoría del tablero, 1 de Localízalo y 1
  más de la categoría de texto menos usada), cada una en un escalón al azar.
- Cada escalón lleva una pregunta jugable a solas (de mapa, o con opciones para su versión) de su nivel, que
  no haya salido en ningún otro día, sin repetir subtema en el día y sin que una delate la respuesta de otra.
La práctica nunca usa preguntas de los retos de hoy en adelante: cuanto más largo el calendario, menos quedan
para practicar. El informe del final dice cuántas quedan libres por categoría y nivel.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validar_banco as vb  # noqa: E402
import validar_opciones as vo  # noqa: E402
from validar_banco import Informe  # noqa: E402

RETOS = vb.APP / "data" / "retos.json"
AJUSTES = vb.APP / "data" / "ajustes.json"
PASOS = 10
DIAS_POR_DEFECTO = 42
MINIMO_DIAS_AVISO = 14
# La elección de cada día es voraz (escalón a escalón): si se atasca, se reintenta con otra semilla antes de darlo
# por imposible. El primer intento es siempre el mismo, así que el calendario sigue siendo reproducible.
INTENTOS_DIA = 40


# ---------------------------------------------------------------- banco, como lo ve la app (banco.js)

def ajuste_vigente(p: dict, ajustes: dict) -> bool:
    v = (ajustes.get("versiones") or {}).get(p["id"])
    return v is None or v == p.get("v")


def nivel_efectivo(p: dict, ajustes: dict, config: dict) -> int:
    n = (ajustes.get("niveles") or {}).get(p["id"])
    nivel = n if isinstance(n, int) and ajuste_vigente(p, ajustes) else p["nivel"]
    return max(config["niveles"]["min"], min(config["niveles"]["max"], nivel))


def retirada(p: dict, ajustes: dict) -> bool:
    return bool((ajustes.get("retiradas") or {}).get(p["id"])) and ajuste_vigente(p, ajustes)


def normalizar_texto(texto: str) -> str:
    """Como normalizarTexto de banco.js."""
    t = unicodedata.normalize("NFD", str(texto))
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    return " ".join("".join(c if ("a" <= c <= "z" or "0" <= c <= "9" or c == "ñ") else " " for c in t).split())


GENERICAS = {"cero", "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
             "medio", "tercio", "cuarto", "sexto", "todos", "todas", "ninguno", "igual", "primero", "segundo"}


def claves_respuesta(p: dict) -> set[str]:
    claves = set()
    for r in [p["respuesta"], *(p.get("tambien_vale") or [])]:
        if p.get("tipo") == "mapa":
            r = str(r).split("(")[0].split(",")[0]
        k = normalizar_texto(r)
        for art in ("el ", "la ", "los ", "las ", "lo ", "un ", "una ", "en "):
            if k.startswith(art):
                k = k[len(art):]
                break
        if len(k) >= 4 and not k.replace(" ", "").isdigit() and k not in GENERICAS:
            claves.add(k)
    return claves


def texto_de(p: dict) -> str:
    return " " + normalizar_texto(" ".join(str(x) for x in [p["pregunta"], p["respuesta"], *(p.get("tambien_vale") or []), p.get("criterio") or "", p.get("explicacion") or ""])) + " "


def delata(a: dict, b: dict) -> bool:
    """Si el texto de una contiene la respuesta de la otra."""
    return any(f" {k} " in texto_de(b) for k in claves_respuesta(a)) or any(f" {k} " in texto_de(a) for k in claves_respuesta(b))


def cargar(config: dict) -> tuple[list[dict], dict, Informe]:
    inf = Informe()
    banco = vb.cargar_banco(config, inf)
    ajustes = json.loads(AJUSTES.read_text(encoding="utf-8")) if AJUSTES.exists() else {}
    opciones, _ = vo.cargar_opciones(config, inf)
    jugables = []
    for p in banco:
        if retirada(p, ajustes):
            continue
        if p.get("tipo") != "mapa":
            # Solo con opciones sin errores para su versión: las mismas que acepta la app.
            o = opciones.get(p["id"])
            propio = Informe()
            if o:
                vo.validar_entrada(p, o, propio)
            if not o or propio.errores:
                continue
        jugables.append({**p, "nivel_efectivo": nivel_efectivo(p, ajustes, config)})
    return jugables, ajustes, inf


# ---------------------------------------------------------------- calendario

def js_dia_semana(d: date) -> int:
    """Como getDay() de JavaScript: 0 el domingo."""
    return (d.weekday() + 1) % 7


def hoy(config: dict) -> date:
    """Hoy en la zona del reto. En Windows, Python no trae la base de zonas horarias (paquete `tzdata`): entonces,
    la fecha de este ordenador (que, en el de quien publica, es la de España)."""
    try:
        return datetime.now(ZoneInfo(config["solo"].get("zona_horaria") or "Europe/Madrid")).date()
    except Exception:  # noqa: BLE001 — ZoneInfoNotFoundError y, sin tzdata, ModuleNotFoundError
        return date.today()


def leer_calendario(ruta: Path = RETOS) -> dict:
    if not ruta.exists():
        return {"formato": 1, "dias": []}
    return json.loads(ruta.read_text(encoding="utf-8"))


def elegir_pregunta(candidatas: list[dict], elegidas: list[dict], rng: random.Random) -> dict | None:
    """Mejor de un subtema que aún no haya salido ese día y que no delate (ni la delaten) las ya elegidas."""
    sin_fuga = [q for q in candidatas if not any(delata(q, e) for e in elegidas)]
    subtemas = {e["subtema"] for e in elegidas if e["categoria"] == (candidatas[0]["categoria"] if candidatas else None)}
    for grupo in ([q for q in sin_fuga if q["subtema"] not in subtemas], sin_fuga):
        if grupo:
            return rng.choice(sorted(grupo, key=lambda q: q["id"]))
    return None


def armar_dia(cats: list[str], libres: list[dict], rng: random.Random, inf: Informe, fecha: str, tolerante: bool) -> list[dict] | None:
    elegidas: list[dict] = []
    for i, cat in enumerate(cats):
        nivel = i + 1
        q = None
        for d in ([0, 1] if tolerante else [0]):
            for l in ([nivel] if d == 0 else [nivel - 1, nivel + 1]):
                c = [x for x in libres if x["categoria"] == cat and x["nivel_efectivo"] == l and x not in elegidas]
                q = elegir_pregunta(c, elegidas, rng) if c else None
                if q:
                    if l != nivel:
                        inf.aviso(fecha, f"escalón {nivel} ({cat}): no quedaba de nivel {nivel}, va una de nivel {l}")
                    break
            if q:
                break
        if not q:
            return None
        elegidas.append(q)
    return elegidas


def armar_mezcla(cats: list[str], libres: list[dict], rng: random.Random, inf: Informe, fecha: str) -> tuple[list[str], list[dict]] | None:
    """Un día mezclado: reparte las categorías (con sus repeticiones) entre los escalones al azar, pero solo entre
    las que aún tienen preguntas de ese nivel; así cada escalón lleva una de su nivel exacto mientras se pueda."""
    quedan = list(cats)
    asignadas: list[str] = []
    elegidas: list[dict] = []
    for nivel in range(1, PASOS + 1):
        con = [c for c in dict.fromkeys(quedan) if any(x["categoria"] == c and x["nivel_efectivo"] == nivel and x not in elegidas for x in libres)]
        cat = rng.choice(sorted(con)) if con else rng.choice(sorted(set(quedan)))
        q = None
        for l in ([nivel] if con else [nivel - 1, nivel + 1]):
            c = [x for x in libres if x["categoria"] == cat and x["nivel_efectivo"] == l and x not in elegidas]
            q = elegir_pregunta(c, elegidas, rng) if c else None
            if q:
                if l != nivel:
                    inf.aviso(fecha, f"escalón {nivel} ({cat}): no quedaba de nivel {nivel}, va una de nivel {l}")
                break
        if not q:
            return None
        quedan.remove(cat)
        asignadas.append(cat)
        elegidas.append(q)
    return asignadas, elegidas


def ampliar(config: dict, calendario: dict, jugables: list[dict], desde: date, hasta: date, inf: Informe) -> dict:
    solo = config["solo"]
    dias = list(calendario.get("dias", []))
    usados = {id_ for d in dias for id_ in d["preguntas"]}
    libres = [q for q in jugables if q["id"] not in usados]
    temas = [t for t in solo["temas_dia"]]
    ids_temas = [t["id"] for t in temas]
    # El turno de los temas sigue donde lo dejó el último día temático.
    ultimo_tema = next((d["tema"] for d in reversed(dias) if d.get("tema")), None)
    turno = (ids_temas.index(ultimo_tema) + 1) % len(temas) if ultimo_tema in ids_temas else 0
    de_texto = [c["id"] for c in config["categorias"] if c.get("tipo") != "mapa"]
    usos_extra = {c: 0 for c in de_texto}
    for d in dias:
        for c in d.get("categorias", []):
            if c in usos_extra:
                usos_extra[c] += 1
    inicio = max(desde, date.fromisoformat(dias[-1]["fecha"]) + timedelta(days=1)) if dias else desde
    fecha = inicio
    agotado = False
    while fecha <= hasta:
        f = fecha.isoformat()
        rng = random.Random(f"reto|{f}")
        dia = None
        if js_dia_semana(fecha) in solo["dias_tematicos"]:
            for k in range(len(temas)):
                t = temas[(turno + k) % len(temas)]
                elegidas = None
                for intento in range(INTENTOS_DIA):
                    r = rng if intento == 0 else random.Random(f"reto|{f}|{t['id']}|{intento}")
                    elegidas = armar_dia([t["id"]] * PASOS, libres, r, Informe(), f, tolerante=False)
                    if elegidas:
                        break
                if elegidas:
                    dia = {"fecha": f, "tema": t["id"], "titulo": t["titulo"], "categorias": [t["id"]] * PASOS, "preguntas": [q["id"] for q in elegidas]}
                    turno = (turno + k + 1) % len(temas)
                    break
                inf.aviso(f, f"{t['titulo']}: no quedan preguntas para los {PASOS} escalones; se salta")
            if not dia:
                inf.aviso(f, "ningún tema tiene ya preguntas para los 10 escalones: este día temático va mezclado")
        if not dia:
            fijas = [c for c, n in solo["mezcla"].items() if c != "extra" for _ in range(n)]
            n_extra = solo["mezcla"].get("extra", 0)
            menos = min(usos_extra.values())
            preferidas = [rng.choice(sorted(c for c, n in usos_extra.items() if n == menos)) for _ in range(n_extra)]
            armado = None
            for intento in range(INTENTOS_DIA):
                r = rng if intento == 0 else random.Random(f"reto|{f}|mezcla|{intento}")
                # Primero, la categoría extra menos usada; si así no sale el día, otra cualquiera de texto.
                extras = preferidas if intento == 0 else [r.choice(sorted(usos_extra)) for _ in range(n_extra)]
                propio = Informe()
                armado = armar_mezcla((fijas + extras)[:PASOS], libres, r, propio, f)
                if armado:
                    inf.avisos += propio.avisos
                    for c in extras:
                        usos_extra[c] += 1
                    break
            if not armado:
                # Agotado: el calendario se queda en el día anterior, que es válido (y se puede escribir).
                inf.aviso(f, "no quedan preguntas para armar el reto: el calendario llega hasta el día anterior")
                agotado = True
                break
            asignadas, elegidas = armado
            dia = {"fecha": f, "tema": None, "titulo": None, "categorias": asignadas, "preguntas": [q["id"] for q in elegidas]}
        dias.append(dia)
        elegidos = set(dia["preguntas"])
        libres = [q for q in libres if q["id"] not in elegidos]
        fecha += timedelta(days=1)
    return {"formato": 1, "generado": datetime.now().isoformat(timespec="seconds"), "dias": dias, **({"agotado": True} if agotado else {})}


def comprobar(config: dict, calendario: dict, jugables: list[dict], inf: Informe, desde: date | None = None):
    por_id = {q["id"]: q for q in jugables}
    vistos: dict[str, str] = {}
    fechas = [d["fecha"] for d in calendario.get("dias", [])]
    if fechas != sorted(fechas) or len(set(fechas)) != len(fechas):
        inf.error("retos.json", "las fechas tienen que ir en orden y sin repetirse")
    temas = {t["id"] for t in config["solo"]["temas_dia"]}
    for d in calendario.get("dias", []):
        f = d["fecha"]
        if len(d.get("preguntas", [])) != PASOS:
            inf.error(f, f"tiene que tener {PASOS} preguntas")
        if d.get("tema") and d["tema"] not in temas:
            inf.error(f, f"tema desconocido «{d['tema']}»")
        for i, id_ in enumerate(d.get("preguntas", [])):
            if id_ in vistos:
                inf.error(f, f"{id_} ya salió el {vistos[id_]}")
            vistos[id_] = f
            q = por_id.get(id_)
            if not q:
                # Retirada, sin opciones o borrada: la app la sustituye sola por otra de su categoría y nivel.
                inf.aviso(f, f"{id_} ya no se puede jugar a solas (retirada, sin opciones o borrada): la app pondrá otra")
            elif q["nivel_efectivo"] != i + 1:
                inf.aviso(f, f"{id_} está en el escalón {i + 1} y ahora es de nivel {q['nivel_efectivo']}")
    if desde and fechas:
        quedan = (date.fromisoformat(fechas[-1]) - desde).days
        if quedan < MINIMO_DIAS_AVISO:
            inf.aviso("retos.json", f"el calendario solo llega hasta el {fechas[-1]} ({max(0, quedan)} días): amplíalo con  py herramientas/generar_retos.py")


def informe_libres(config: dict, calendario: dict, jugables: list[dict], desde: date) -> str:
    reservadas = {id_ for d in calendario["dias"] if d["fecha"] >= desde.isoformat() for id_ in d["preguntas"]}
    filas = []
    for cat in vb.categorias_del_banco(config):
        fila = [sum(1 for q in jugables if q["categoria"] == cat["id"] and q["nivel_efectivo"] == n and q["id"] not in reservadas) for n in range(1, PASOS + 1)]
        filas.append("  " + " ".join(f"{x:>3}" for x in fila) + f"  {sum(fila):>5}  {cat['id']}")
    return "Libres para practicar (no reservadas para un reto de hoy en adelante), por nivel:\n" + "\n".join(filas)


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dias", type=int, default=DIAS_POR_DEFECTO, help="horizonte desde hoy (por defecto, %(default)s)")
    ap.add_argument("--desde", help="primer día si el calendario está vacío (AAAA-MM-DD; por defecto, hoy)")
    ap.add_argument("--seco", action="store_true", help="no escribe nada")
    ap.add_argument("--comprobar", action="store_true", help="solo comprueba el calendario")
    args = ap.parse_args(argv)
    config = vb.cargar_config()
    jugables, _, inf = cargar(config)
    calendario = leer_calendario()
    hoy_ = hoy(config)
    if args.comprobar:
        comprobar(config, calendario, jugables, inf, desde=hoy_)
        errores_opciones, _ = vo.validar(config)
        inf.errores += [f"opciones: {e}" for e in errores_opciones.errores]
    else:
        desde = date.fromisoformat(args.desde) if args.desde else hoy_
        antes = len(calendario.get("dias", []))
        calendario = ampliar(config, calendario, jugables, desde, hoy_ + timedelta(days=args.dias - 1), inf)
        comprobar(config, calendario, jugables, inf)
        nuevos = len(calendario["dias"]) - antes
        dias = calendario["dias"]
        print(f"{nuevos} días nuevos; el calendario va del {dias[0]['fecha']} al {dias[-1]['fecha']}." if dias else "Calendario vacío.")
        agotado = calendario.pop("agotado", False)
        if agotado:
            print("Se han agotado las preguntas: el calendario llega hasta donde se ha podido.")
        errores_opciones, _ = vo.validar(config)
        if errores_opciones.errores:
            inf.errores += [f"opciones: {e}" for e in errores_opciones.errores]
            print("Las opciones tienen errores (py herramientas/validar_opciones.py): no se escribe el calendario.")
        if not args.seco and nuevos and not inf.errores:
            RETOS.write_text(json.dumps(calendario, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            print(f"Escrito {RETOS.relative_to(vb.RAIZ)}.")
    print(informe_libres(config, calendario, jugables, hoy_))
    for e in inf.errores:
        print("ERROR  " + e)
    for a in inf.avisos:
        print("aviso  " + a)
    return 1 if inf.errores else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(principal())
