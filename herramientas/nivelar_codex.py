"""Agente nivelador: Codex pone nivel a las preguntas de los temas sin ver el que tienen, con la prueba del casual
de la rúbrica (docs/rubrica_niveles.md), y las generadas se recolocan en su nivel estimado. Y, con el mismo molde,
el detector de relleno: en los niveles 1 a 3, las que se aciertan sin haber tenido contacto con el tema.

Uso:
    py herramientas/nivelar_codex.py estimar [--solo tema …] [--paralelo 6]   # dos pasadas independientes por tema
    py herramientas/nivelar_codex.py informe                                  # nivel que tienen frente al estimado
    py herramientas/nivelar_codex.py aplicar [--solo tema …]                  # cambia `nivel` en app/data/temas
    py herramientas/nivelar_codex.py relleno [--solo tema …]                  # dos pasadas: ¿hace falta conocer el tema?
    py herramientas/nivelar_codex.py informe-relleno [--suma 3]               # las que salen de relleno, para leerlas
    py herramientas/nivelar_codex.py retirar --lista ids.json                 # las quita del banco y de las opciones

Solo cambia el nivel de las preguntas generadas (`origen: "generada"`): las escritas a mano ya pasaron por el usuario
y sirven para ver si el nivelador acierta (el informe dice cuánto se aparta de ellas). El nivel no entra en la huella
de la pregunta, así que conservan su versión y sus opciones. Las estimaciones se guardan en
herramientas/banco_lotes/niveles/ (ignorado en git) y `estimar` retoma lo que falte. Después de `aplicar`:
`py herramientas/banco_codex.py lanzar --solo <temas>` rellena los huecos de los niveles bajos, y los validadores.

El relleno (14-11-2026): al rellenar esos huecos, cuatro de cada diez preguntas nuevas de nivel 1 se acertaban sin saber
nada del tema («¿Qué lleva Harry sobre la nariz para ver mejor?»). `relleno` pone a cada generada de nivel 1 a 3 una
nota (0, del tema; 1, se saca por una pista de fuera; 2, sentido común) en dos pasadas, en banco_lotes/relleno/.
`retirar` no decide: quita las de la lista que se le da (un JSON con ids), y deja cada una como lección para el
redactor de su subtema. Una pregunta ya publicada que se retire sigue en preguntas.lock.json como eliminada.
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, NamedTuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco_codex as bc  # noqa: E402
import opciones_codex as oc  # noqa: E402
import validar_banco as vb  # noqa: E402
import validar_opciones as vo  # noqa: E402

NIVELES = bc.LOTES / "niveles"
RELLENO = bc.LOTES / "relleno"
POR_LLAMADA = 60
PASADAS = 2
NIVEL_MAX_RELLENO = 3  # el relleno se busca donde las preguntas tienen que ser fáciles
SUMA_RELLENO = bc.SUMA_RELLENO  # de relleno: un 2 y al menos un 1 entre las dos pasadas
LECCION_RELLENO = "de relleno: se acierta sin haber tenido contacto con el tema"
bc.AGENTES.setdefault("nivelar", [bc.MODELO, "medium"])

INSTRUCCIONES = """# Tu trabajo: poner nivel a preguntas ya escritas

«¿Cuánto te arriesgas?» es un juego de preguntas en español de España: cada jugador elige del 1 al 10 cuánto se arriesga y recibe una pregunta de ese nivel. Abajo tienes preguntas de un tema que el jugador elige porque le gusta. Están escritas y revisadas: los datos son correctos. No sabes qué nivel tienen ahora; dinos cuál les corresponde.

Cómo decidir cada una:

1. Imagina a 100 personas con un **contacto casual** con el tema (lo conocen de pasada, sin seguirlo). Si la aciertan casi todas, nivel 1; si unas 80, nivel 2; si unas 70, nivel 3. Si la aciertan menos de dos tercios, no es de nivel 1 a 3.
2. Para las demás, imagina a 100 **aficionados** que siguen el tema por gusto: si la aciertan unos 60, nivel 4; la mitad, nivel 5; unos 40, nivel 6.
3. Y si los aficionados la fallan casi siempre, piensa en los **expertos**: nivel 7 u 8 si la sabe quien se lo toma en serio; 9 o 10 si es un dato que solo recuerda un especialista.

Cuidado con los engaños: una pregunta larga puede ser fácil y una corta, de experto. Vocabulario técnico, nombres propios de segunda fila, fechas, cifras y datos de producción no son de nivel 1 a 3, por muy básicos que le parezcan a quien domina el tema. Una pregunta cuyo enunciado da la respuesta casi hecha baja de nivel.

No repartas los niveles por igual: si casi todas son de aficionado o de experto, dilo así. Juzga cada pregunta por sí misma.

Responde con un JSON: `niveles`, con un objeto `{"n": número de la pregunta, "nivel": del 1 al 10}` por cada pregunta del lote, todas."""

INSTRUCCIONES_RELLENO = """# Tu trabajo: separar las preguntas de relleno

«¿Cuánto te arriesgas?» es un juego de preguntas en español de España. Abajo tienes preguntas fáciles de un tema que el jugador elige porque le gusta. Tienen que ser fáciles para quien conoce el tema de pasada, pero tienen que ser **del tema**: quien lo elige quiere que le pregunten por él. Algunas son de relleno: las acierta cualquiera sin haber tenido nunca contacto con el tema.

Para cada pregunta, imagina a una persona con una cultura general normal que **jamás** ha tenido contacto con el tema (no ha jugado, no ha visto ni leído nada de él, no le interesa) y ponle una nota:

- `0`: **es del tema.** Esa persona no la acierta, o solo de oídas: la respuesta es un dato del tema (un personaje, una pieza, una regla, una escena, un lugar, un hecho, un nombre), por muy famoso que sea. «¿Qué pieza de ajedrez se mueve en forma de L?» → El caballo. «¿En qué casa de Hogwarts está Harry?» → Gryffindor. «¿Qué base naval atacó Japón por sorpresa en 1941?» → Pearl Harbor. «¿Qué sustancia del café quita el sueño?» → La cafeína.
- `1`: **se saca por una pista de fuera del tema.** El enunciado da un dato de cultura general que basta para responder, y lo del tema es decorado: «¿Qué río de Londres sobrevuelan Harry y sus amigos?» → El Támesis. «¿En qué ciudad está el Santiago Bernabéu, donde actuó Taylor Swift?» → Madrid. «¿Qué cervatillo de Disney dio nombre a un dinosaurio?» → Bambi.
- `2`: **de relleno.** La respuesta es sentido común o vocabulario de todos los días, y la pregunta valdría igual cambiando el tema por otro: «¿Qué lleva Harry sobre la nariz para ver mejor?» → Las gafas. «¿Con qué aparato se graban las imágenes de una película de Star Wars?» → Una cámara. «¿Qué documento se compra para viajar en tren?» → El billete. «¿Qué parte del cuerpo se estrechan dos ajedrecistas al saludarse?» → La mano.

Que una pregunta sea muy fácil o muy famosa no la hace de relleno: lo que cuenta es si hace falta haber tenido algún contacto con el tema. En los temas que son cultura general (una guerra, los trenes, el café, los dinosaurios), los hechos del tema son del tema aunque se aprendan en el colegio. Ante la duda entre dos notas, la más baja. Juzga cada pregunta por sí misma.

Responde con un JSON: `notas`, con un objeto `{"n": número de la pregunta, "nota": 0, 1 o 2}` por cada pregunta del lote, todas."""


class Tarea(NamedTuple):
    """Una pasada de Codex por las preguntas de los temas que deja un número por pregunta."""
    nombre: str
    carpeta: Path
    instrucciones: str
    lista: str      # la lista del JSON de respuesta…
    campo: str      # …y el campo de cada elemento que lleva el número
    minimo: int
    maximo: int
    rubrica: bool   # si el mensaje lleva la rúbrica del tema
    entra: Callable[[dict], bool]

    @property
    def esquema(self) -> dict:
        return bc.objeto({self.lista: {"type": "array", "items": bc.objeto({"n": bc.ENTERO, self.campo: bc.ENTERO})}})


NIVELAR = Tarea("nivelar", NIVELES, INSTRUCCIONES, "niveles", "nivel", 1, 10, True, lambda p: True)
DETECTAR = Tarea("relleno", RELLENO, INSTRUCCIONES_RELLENO, "notas", "nota", 0, 2, False,
                 lambda p: p.get("origen") == "generada" and p["nivel"] <= NIVEL_MAX_RELLENO)


def temas_fan(ctx: bc.Contexto, solo: list[str]) -> list[str]:
    return [t for t in ctx.cats if t in ctx.temas and ctx.cats[t].get("referencia") == "fan" and (not solo or t in solo)]


def ruta_de(tema: str, tarea: Tarea = NIVELAR) -> Path:
    return tarea.carpeta / f"{tema}.json"


def cargar(tema: str, tarea: Tarea = NIVELAR) -> dict[str, list[int]]:
    ruta = ruta_de(tema, tarea)
    return json.loads(ruta.read_text(encoding="utf-8")) if ruta.exists() else {}


def prompt(ctx: bc.Contexto, tema: str, lote: list[dict], tarea: Tarea = NIVELAR) -> str:
    c = ctx.cats[tema]
    nombres = {s["id"]: s["nombre"] for s in c["subtemas"]}
    lineas = [f"Tema: «{c['nombre']}».", "", f"El lote ({len(lote)} preguntas):", ""]
    lineas += [f"{i}. [{nombres.get(p['subtema'], p['subtema'])}] {p['pregunta']} → {p['respuesta']}" for i, p in enumerate(lote, 1)]
    lineas += ["", f"Responde solo con el JSON, con {'un nivel' if tarea is NIVELAR else 'una nota'} por cada número."]
    trozos = [tarea.instrucciones, *([bc.rubrica_para(ctx, tema)] if tarea.rubrica else []), "# Este lote\n\n" + "\n".join(lineas)]
    return "\n\n---\n\n".join(trozos)


def lotes_de(ctx: bc.Contexto, tema: str, pasada: int, tarea: Tarea = NIVELAR) -> list[list[dict]]:
    """Las preguntas del tema, barajadas de una forma distinta en cada pasada y sin ordenar por nivel ni por subtema."""
    ps = sorted((p for p in ctx.banco if p["categoria"] == tema and tarea.entra(p)), key=lambda p: p["id"])
    random.Random(f"{tema}|{pasada}").shuffle(ps)
    n = max(1, round(len(ps) / POR_LLAMADA))
    return [ps[i::n] for i in range(n)]


def estimar_lote(ctx: bc.Contexto, tarea: Tarea, tema: str, pasada: int, k: int, lote: list[dict]) -> tuple[str, int, dict[str, int]]:
    datos = bc.llamar_codex(prompt(ctx, tema, lote, tarea), tarea.esquema, f"{tarea.nombre}__{tema}__p{pasada}_l{k:02d}", "nivelar", ctx.esperar)
    salida = {}
    for x in datos.get(tarea.lista) or []:
        if isinstance(x.get("n"), int) and 1 <= x["n"] <= len(lote) and isinstance(x.get(tarea.campo), int):
            salida[lote[x["n"] - 1]["id"]] = min(tarea.maximo, max(tarea.minimo, x[tarea.campo]))
    return tema, pasada, salida


def estimar(ctx: bc.Contexto, solo: list[str], paralelo: int, tarea: Tarea = NIVELAR):
    tarea.carpeta.mkdir(parents=True, exist_ok=True)
    hechos = {t: cargar(t, tarea) for t in temas_fan(ctx, solo)}
    tareas = []
    for tema, ya in hechos.items():
        for pasada in range(1, PASADAS + 1):
            for k, lote in enumerate(lotes_de(ctx, tema, pasada, tarea), 1):
                falta = [p for p in lote if len(ya.get(p["id"], [])) < pasada]
                if falta:
                    tareas.append((tema, pasada, k, lote))
    bc.avisar(f"{tarea.nombre}: {len(tareas)} llamadas para {len(hechos)} temas")
    with ThreadPoolExecutor(paralelo) as ex:
        for futuro in [ex.submit(estimar_lote, ctx, tarea, *t) for t in tareas]:
            try:
                tema, pasada, salida = futuro.result()
            except Exception as exc:  # noqa: BLE001
                bc.avisar(f"{tarea.nombre}: una llamada ha fallado ({str(exc)[:120]})")
                continue
            ya = hechos[tema]
            for id_, nivel in salida.items():
                lista = ya.setdefault(id_, [])
                while len(lista) < pasada:
                    lista.append(nivel)
                lista[pasada - 1] = nivel
            ruta_de(tema, tarea).write_text(json.dumps(ya, ensure_ascii=False, indent=0), encoding="utf-8")
            bc.avisar(f"{tarea.nombre}: {tema}, pasada {pasada}: {len(salida)} {tarea.lista}")


def estimado(niveles: list[int]) -> int | None:
    """El nivel estimado: la media de las pasadas, redondeada (la mitad, hacia arriba)."""
    return int(statistics.mean(niveles) + 0.5) if len(niveles) >= PASADAS else None


def informe(ctx: bc.Contexto, solo: list[str]):
    print(f"{'tema':<20} {'preg.':>5} {'sin est.':>8} {'dif. media':>10} {'pasadas':>8} {'a mano':>7}   generadas por nivel: ahora → estimado")
    for tema in temas_fan(ctx, solo):
        est = cargar(tema)
        ps = [p for p in ctx.banco if p["categoria"] == tema]
        con = [(p, estimado(est.get(p["id"], []))) for p in ps]
        gen = [(p, e) for p, e in con if e is not None and p.get("origen") == "generada"]
        mano = [(p, e) for p, e in con if e is not None and p.get("origen") != "generada"]
        entre = [abs(v[0] - v[1]) for v in est.values() if len(v) >= 2]
        ahora, despues = Counter(p["nivel"] for p, _ in gen), Counter(e for _, e in gen)
        dif = statistics.mean(e - p["nivel"] for p, e in gen) if gen else 0
        dm = statistics.mean(abs(e - p["nivel"]) for p, e in mano) if mano else float("nan")
        print(f"{tema:<20} {len(ps):>5} {sum(1 for _, e in con if e is None):>8} {dif:>+10.2f} {statistics.mean(entre) if entre else 0:>8.2f} {dm:>7.2f}   "
              + " ".join(f"{n}:{ahora[n]}→{despues[n]}" for n in range(1, 11)))
    print("\n«dif. media»: cuánto suben de media las generadas. «pasadas»: diferencia media entre las dos pasadas. "
          "«a mano»: cuánto se aparta el nivelador del nivel de las escritas a mano.")


def aplicar(ctx: bc.Contexto, solo: list[str]) -> int:
    total = 0
    for tema in temas_fan(ctx, solo):
        est = cargar(tema)
        c = ctx.cats[tema]
        ruta = vb.APP / c["archivo"]
        datos = json.loads(ruta.read_text(encoding="utf-8"))
        cambios = Counter()
        for p in datos["preguntas"]:
            e = estimado(est.get(p["id"], []))
            if p.get("origen") == "generada" and e is not None and e != p["nivel"]:
                cambios[e - p["nivel"]] += 1
                p["nivel"] = e
        if cambios:
            orden = {s["id"]: i for i, s in enumerate(c["subtemas"])}
            datos["preguntas"].sort(key=lambda p: (orden[p["subtema"]], p["nivel"]))
            ruta.write_text(bc.escribir_banco(datos["categoria"], datos["preguntas"]), encoding="utf-8")
            n = sum(cambios.values())
            total += n
            print(f"{tema}: {n} cambian de nivel (suben {sum(k for d, k in cambios.items() if d > 0)}, bajan {sum(k for d, k in cambios.items() if d < 0)})")
    return total


# ------------------------------------------------------------- relleno

def de_relleno(ctx: bc.Contexto, solo: list[str], suma: int = SUMA_RELLENO) -> list[tuple[dict, list[int]]]:
    """Las generadas de nivel 1 a 3 cuyas dos notas suman `suma` o más, con sus notas."""
    salida = []
    for tema in temas_fan(ctx, solo):
        notas = cargar(tema, DETECTAR)
        for p in ctx.banco:
            n = notas.get(p["id"], [])
            if p["categoria"] == tema and DETECTAR.entra(p) and len(n) >= PASADAS and sum(n) >= suma:
                salida.append((p, n))
    return salida


def informe_relleno(ctx: bc.Contexto, solo: list[str], suma: int):
    marcadas = de_relleno(ctx, solo, suma)
    por_tema = Counter(p["categoria"] for p, _ in marcadas)
    for tema in temas_fan(ctx, solo):
        notas = cargar(tema, DETECTAR)
        miradas = [p for p in ctx.banco if p["categoria"] == tema and DETECTAR.entra(p)]
        sin = sum(1 for p in miradas if len(notas.get(p["id"], [])) < PASADAS)
        print(f"\n== {tema}: {por_tema[tema]} de {len(miradas)} suman {suma} o más" + (f" ({sin} sin nota)" if sin else ""))
        for p, n in marcadas:
            if p["categoria"] == tema:
                print(f"[{p['id']}] n{p['nivel']} {n} {p['pregunta']} → {p['respuesta']}")
    print(f"\nTotal: {len(marcadas)}")


def retirar(ctx: bc.Contexto, ids: set[str], motivo: str = LECCION_RELLENO) -> int:
    """Quita del banco las generadas de los temas que están en `ids`, y sus opciones; cada una queda como lección
    para el redactor de su subtema (con el `motivo`) y apuntada en banco_lotes/relleno/retiradas.jsonl."""
    total = 0
    RELLENO.mkdir(parents=True, exist_ok=True)
    tocados = {p["categoria"] for p in ctx.banco if p["id"] in ids}
    for tema in temas_fan(ctx, []):
        if tema not in tocados:
            continue
        c = ctx.cats[tema]
        ruta = vb.APP / c["archivo"]
        datos = json.loads(ruta.read_text(encoding="utf-8"))
        fuera = [p for p in datos["preguntas"] if p["id"] in ids and p.get("origen") == "generada"]
        if not fuera:
            continue
        quitadas = {p["id"] for p in fuera}
        datos["preguntas"] = [p for p in datos["preguntas"] if p["id"] not in quitadas]
        ruta.write_text(bc.escribir_banco(datos["categoria"], datos["preguntas"]), encoding="utf-8")
        ruta_op = vo.archivo_opciones(ctx.config, c)
        if ruta_op.exists():
            op = json.loads(ruta_op.read_text(encoding="utf-8"))
            for id_ in quitadas:
                op.get("opciones", {}).pop(id_, None)
                op.get("no_aptas", {}).pop(id_, None)
            ruta_op.write_text(oc.escribir(op), encoding="utf-8")
        for sub in {p["subtema"] for p in fuera}:
            st = bc.cargar_estado(tema, sub)
            for p in fuera:
                if p["subtema"] == sub:
                    bc.leccion(st, p, motivo)
            bc.guardar_estado(tema, sub, st)
        with (RELLENO / "retiradas.jsonl").open("a", encoding="utf-8") as f:
            for p in fuera:
                f.write(json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "motivo": motivo, **p}, ensure_ascii=False) + "\n")
        total += len(fuera)
        print(f"{tema}: {len(fuera)} retiradas")
    return total


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("accion", choices=["estimar", "informe", "aplicar", "relleno", "informe-relleno", "retirar"])
    ap.add_argument("--solo", nargs="*", default=[], help="temas")
    ap.add_argument("--paralelo", type=int, default=6)
    ap.add_argument("--suma", type=int, default=SUMA_RELLENO, help="informe-relleno: suma mínima de las dos notas")
    ap.add_argument("--lista", help="retirar: un JSON con la lista de ids")
    ap.add_argument("--motivo", default=LECCION_RELLENO, help="retirar: por qué, para el redactor del lote siguiente")
    ap.add_argument("--sin-esperar", action="store_true", help="si Codex está en su límite de uso, parar en vez de esperar")
    args = ap.parse_args(argv)
    ctx = bc.Contexto()
    ctx.esperar = not args.sin_esperar
    if args.accion == "estimar":
        estimar(ctx, args.solo, args.paralelo)
    elif args.accion == "informe":
        informe(ctx, args.solo)
    elif args.accion == "relleno":
        estimar(ctx, args.solo, args.paralelo, DETECTAR)
    elif args.accion == "informe-relleno":
        informe_relleno(ctx, args.solo, args.suma)
    elif args.accion == "retirar":
        if not args.lista:
            ap.error("retirar necesita --lista")
        ids = set(json.loads(Path(args.lista).read_text(encoding="utf-8")))
        print(f"Retiradas: {retirar(ctx, ids, args.motivo)}. Ahora: py herramientas/banco_codex.py lanzar --solo <temas> y py herramientas/validar_banco.py --actualizar")
    else:
        print(f"Cambiadas: {aplicar(ctx, args.solo)}. Ahora: py herramientas/validar_banco.py --actualizar")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(principal())
