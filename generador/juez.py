"""Juez: una segunda llamada al modelo puntúa exactitud, ambigüedad, claridad y nivel de cada pregunta.

Uso para puntuar el banco (así el modelo filtro tiene datos también de las preguntas semilla):
    py generador/juez.py --banco                 # solo las que aún no tienen puntuación
    py generador/juez.py --banco --categoria mates --limite 40
    py generador/juez.py --banco --seco          # dice cuántas llamadas haría, sin hacerlas

Las puntuaciones se guardan en el campo `juez` de cada pregunta. No cambian su versión,
porque no tocan el texto.
"""

from __future__ import annotations

import argparse
import logging
import sys

from comun import Proyecto, plural
from llm import Cortada, ErrorGenerador, crear_cliente, explicar_error_api, llamar_json
from prompts import ESQUEMA_JUEZ, sistema_juez, usuario_juez

TAM_LOTE = 10
log = logging.getLogger("generador")


def _entre(x, lo, hi):
    return max(lo, min(hi, int(x)))


def normalizar_valoracion(v: dict) -> dict:
    return {
        "exactitud": _entre(v["exactitud"], 1, 5),
        "ambiguedad": _entre(v["ambiguedad"], 1, 5),
        "claridad": _entre(v["claridad"], 1, 5),
        "nivel_estimado": _entre(v["nivel_estimado"], 1, 10),
        "comentario": str(v.get("comentario", "")).strip(),
    }


def juzgar(cliente, proyecto: Proyecto, preguntas: list[dict], al_terminar_lote=None) -> dict[str, dict]:
    """Devuelve {id: valoración}. Llama a `al_terminar_lote(parciales)` tras cada lote para ir guardando."""
    sistema = sistema_juez(proyecto)
    salida: dict[str, dict] = {}
    pendientes = [preguntas[i : i + TAM_LOTE] for i in range(0, len(preguntas), TAM_LOTE)]
    while pendientes:
        lote = pendientes.pop(0)
        try:
            datos = llamar_json(cliente, sistema=sistema, usuario=usuario_juez(lote), esquema=ESQUEMA_JUEZ, esfuerzo="high")
        except Cortada:
            # Si la respuesta no cabe, se repite en dos mitades (con una sola pregunta, se deja sin valorar).
            if len(lote) == 1:
                log.warning("  El juez no ha podido valorar %s: la respuesta se ha cortado por longitud.", lote[0]["id"])
                continue
            mitad = (len(lote) + 1) // 2
            pendientes[:0] = [lote[:mitad], lote[mitad:]]
            continue
        ids = {p["id"] for p in lote}
        nuevas = {v["id"]: normalizar_valoracion(v) for v in datos["valoraciones"] if v["id"] in ids}
        salida.update(nuevas)
        if al_terminar_lote:
            al_terminar_lote(nuevas)
    return salida


def juzgar_banco(cliente, proyecto: Proyecto, *, categoria: str | None = None, todas: bool = False,
                 limite: int | None = None, seco: bool = False) -> int:
    banco = proyecto.banco()
    pendientes = [p for p in banco if (todas or not p.get("juez")) and (not categoria or p["categoria"] == categoria)]
    if limite:
        pendientes = pendientes[:limite]
    llamadas = -(-len(pendientes) // TAM_LOTE)
    print(f"Preguntas por puntuar: {len(pendientes)} ({plural(llamadas, 'llamada')} a la API)")
    if seco or not pendientes:
        return 0

    por_id = {p["id"]: p for p in banco}

    def guardar(nuevas: dict[str, dict]):
        tocadas = set()
        for id_, val in nuevas.items():
            por_id[id_]["juez"] = val
            tocadas.add(por_id[id_]["categoria"])
        for cat in tocadas:
            proyecto.guardar_categoria(cat, [p for p in banco if p["categoria"] == cat])
        print(f"  · {plural(len(nuevas), 'puntuada')}")

    juzgar(cliente, proyecto, pendientes, al_terminar_lote=guardar)
    return 0


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--banco", action="store_true", help="puntúa las preguntas del banco")
    ap.add_argument("--categoria", help="solo esta categoría")
    ap.add_argument("--todas", action="store_true", help="vuelve a puntuar también las que ya tienen puntuación")
    ap.add_argument("--limite", type=int, help="como mucho este número de preguntas")
    ap.add_argument("--seco", action="store_true", help="no llama a la API; solo dice qué haría")
    args = ap.parse_args(argv)
    if not args.banco:
        ap.print_help()
        return 2
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    proyecto = Proyecto()
    try:
        cliente = None if args.seco else crear_cliente()
        return juzgar_banco(cliente, proyecto, categoria=args.categoria, todas=args.todas, limite=args.limite, seco=args.seco)
    except ErrorGenerador as exc:
        print(f"✗ {exc}")
        return 1
    except Exception as exc:  # noqa: BLE001 — los errores de la API se explican; el resto se relanza
        mensaje = explicar_error_api(exc)
        if mensaje is None:
            raise
        print(f"✗ {mensaje}")
        return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(principal())
