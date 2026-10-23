"""Incorpora al banco las candidatas de un lote, después de revisarlas.

Uso:
    py generador/incorporar.py generador/candidatas/lote-20261020-210500.json
    py generador/incorporar.py LOTE --excluir mat-cal-21,mat-cal-23     # sin las que no te gusten
    py generador/incorporar.py LOTE --seco                              # solo comprueba

Vuelve a validar cada candidata contra el banco actual (esquema, mates, duplicados, ids),
las añade a su archivo de categoría y actualiza el archivo de control de versiones.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from comun import Proyecto, es_duplicada, limpiar, plural, vb
from generar import errores_validacion


def incorporar(proyecto: Proyecto, lote: dict, excluir: set[str] = frozenset(), seco: bool = False) -> tuple[list[dict], list[str]]:
    """Devuelve (añadidas, problemas). Si hay problemas, no escribe nada."""
    banco = proyecto.banco()
    usados = proyecto.ids_usados()
    problemas = []
    nuevas = []
    for p in lote.get("preguntas", []):
        p = limpiar(p)  # quita campos internos como _motivo_filtro
        if p["id"] in excluir:
            continue
        if p["id"] in usados:
            problemas.append(f"{p['id']}: ese id ya existe en el banco")
            continue
        errores = errores_validacion(p, proyecto)
        if errores:
            problemas.append(f"{p['id']}: " + "; ".join(errores))
            continue
        choca = es_duplicada(p["pregunta"], [q["pregunta"] for q in banco + nuevas if q["categoria"] == p["categoria"]])
        if choca:
            problemas.append(f"{p['id']}: se parece a «{choca}»")
            continue
        nuevas.append(p)
        usados.add(p["id"])
    if problemas or seco:
        return nuevas, problemas

    for cat in {p["categoria"] for p in nuevas}:
        actuales = [q for q in banco if q["categoria"] == cat]
        proyecto.guardar_categoria(cat, actuales + [p for p in nuevas if p["categoria"] == cat])

    ruta_lock = proyecto.app / "data" / "preguntas.lock.json"
    lock = json.loads(ruta_lock.read_text(encoding="utf-8")) if ruta_lock.exists() else {}
    for p in nuevas:
        lock[p["id"]] = {"v": p["v"], "huella": vb.huella(p)}
    ruta_lock.write_text(json.dumps(dict(sorted(lock.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return nuevas, []


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("lote", type=Path)
    ap.add_argument("--excluir", default="", help="ids separados por comas que no se incorporan")
    ap.add_argument("--seco", action="store_true", help="solo comprueba; no escribe nada")
    args = ap.parse_args(argv)

    proyecto = Proyecto()
    lote = json.loads(args.lote.read_text(encoding="utf-8"))
    excluir = {x.strip() for x in args.excluir.split(",") if x.strip()}
    nuevas, problemas = incorporar(proyecto, lote, excluir, args.seco)
    if problemas:
        print("No se ha incorporado nada. Problemas:")
        for x in problemas:
            print("  ✗", x)
        print("Corrige el lote o excluye esas preguntas con --excluir.")
        return 1
    if args.seco:
        print(f"Todo correcto: se incorporarían {plural(len(nuevas), 'pregunta')}.")
        return 0
    print(f"Incorporadas: {plural(len(nuevas), 'pregunta')}")
    for p in nuevas:
        print(f"  + {p['id']} (nivel {p['nivel']}): {p['pregunta']}")
    print("\nComprueba el banco con:  py herramientas/validar_banco.py")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(principal())
