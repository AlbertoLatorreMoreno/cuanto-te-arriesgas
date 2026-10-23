"""Genera preguntas nuevas con IA y las deja en un archivo de candidatas para revisarlas.

Flujo: generar → validar (esquema, mates, duplicados) → juez → filtro → candidatas.
Nada entra en el banco hasta que lo incorporas con `generador/incorporar.py`.

Uso:
    py generador/generar.py --seco                      # qué huecos rellenaría y cuántas llamadas haría
    py generador/generar.py                             # rellena hasta 3 preguntas por subtema y nivel
    py generador/generar.py --objetivo 4 --max-celdas 10
    py generador/generar.py --celda mates/calculo/7 --cantidad 3

Necesita una clave de API en ANTHROPIC_API_KEY (o `ant auth login`).
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

import filtro as ft
from comun import Proyecto, ajuste_vigente, es_duplicada, esta_retirada, huecos, limpiar, nivel_efectivo, plural, siguiente_id, vb
from juez import juzgar
from llm import MODELO, Cortada, ErrorGenerador, Rechazo, crear_cliente, explicar_error_api, llamar_json
from prompts import ESQUEMA_GENERACION, sistema_generador, usuario_generador

log = logging.getLogger("generador")
MAX_POR_LLAMADA = 8  # preguntas por petición de generación


class Lote:
    """Archivo de candidatas que se va guardando tras cada celda (no se pierde nada si algo falla)."""

    def __init__(self, ruta: Path, modo_filtro: str):
        self.ruta = ruta
        self.datos = {
            "formato": 1,
            "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "modelo": MODELO,
            "filtro": modo_filtro,
            "preguntas": [],
            "rechazadas": [],
        }

    def aceptar(self, p: dict, motivo: str):
        self.datos["preguntas"].append({**limpiar(p), "_motivo_filtro": motivo})

    def rechazar(self, p: dict, motivo: str):
        self.datos["rechazadas"].append({k: p.get(k) for k in ("categoria", "subtema", "nivel", "pregunta", "respuesta")} | {"motivo": motivo})

    def guardar(self):
        self.ruta.parent.mkdir(parents=True, exist_ok=True)
        self.ruta.write_text(json.dumps(self.datos, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def ejemplos_de_nivel(banco: list[dict], ajustes: dict, nivel: int, excluir_sub: tuple[str, str], rng: random.Random, n: int = 4) -> list[dict]:
    """Preguntas de referencia del mismo nivel efectivo y de otros subtemas, para calibrar.
    Prefiere las de la misma categoría (en Mates y lógica la dificultad no se mide igual que en
    las demás) y, dentro de eso, las que ya ha recolocado la calibración (su nivel se basa en datos reales)."""
    calibradas = ajustes.get("niveles", {})
    candidatas = [p for p in banco if not esta_retirada(p, ajustes) and nivel_efectivo(p, ajustes) == nivel and (p["categoria"], p["subtema"]) != excluir_sub]
    rng.shuffle(candidatas)
    recolocada = lambda p: p["id"] in calibradas and ajuste_vigente(p, ajustes)
    candidatas.sort(key=lambda p: (p["categoria"] != excluir_sub[0], not recolocada(p)))  # estable: conserva el azar
    return candidatas[:n]


def agrupar(celdas: list[tuple[str, str, int, int]]) -> dict[tuple[str, str], dict[int, int]]:
    """Agrupa las celdas por subtema, conservando el orden: {(categoría, subtema): {nivel: cantidad}}.
    Así se piden todos los niveles de un subtema en una sola llamada."""
    grupos: dict[tuple[str, str], dict[int, int]] = {}
    for cat, sub, nivel, cantidad in celdas:
        pedidos = grupos.setdefault((cat, sub), {})
        pedidos[nivel] = pedidos.get(nivel, 0) + cantidad
    return grupos


def trocear(pedidos: dict[int, int], maximo: int) -> list[dict[int, int]]:
    """Reparte {nivel: cantidad} en peticiones de como mucho `maximo` preguntas."""
    trozos: list[dict[int, int]] = []
    actual: dict[int, int] = {}
    ocupado = 0
    for nivel in sorted(pedidos):
        restante = pedidos[nivel]
        while restante > 0:
            if ocupado == maximo:
                trozos.append(actual)
                actual, ocupado = {}, 0
            tomar = min(restante, maximo - ocupado)
            actual[nivel] = actual.get(nivel, 0) + tomar
            ocupado += tomar
            restante -= tomar
    if actual:
        trozos.append(actual)
    return trozos


def generar_grupo(cliente, proyecto: Proyecto, banco: list[dict], usados: set[str], cat: str, sub: str,
                  pedidos: dict[int, int], rng: random.Random, previas: list[dict] = ()) -> list[dict]:
    """Pide de una vez las preguntas de varios niveles de un subtema y devuelve candidatas con id,
    ya limpias (sin validar ni juzgar). Lo que no se haya pedido se descarta.
    `previas` son las candidatas de este subtema pedidas antes en la misma ejecución: el modelo
    las ve como existentes para no repetirlas."""
    existentes = [p for p in banco if p["categoria"] == cat and p["subtema"] == sub] + list(previas)
    ajustes = proyecto.ajustes()
    ejemplos = {nivel: ejemplos_de_nivel(banco, ajustes, nivel, (cat, sub), rng, n=2) for nivel in sorted(pedidos)}
    datos = llamar_json(
        cliente,
        sistema=sistema_generador(proyecto),
        usuario=usuario_generador(proyecto, cat, sub, pedidos, existentes, ejemplos),
        esquema=ESQUEMA_GENERACION,
        esfuerzo="high",
    )
    pendientes = dict(pedidos)
    salida = []
    for item in datos["preguntas"]:
        nivel = item.get("nivel")
        if pendientes.get(nivel, 0) <= 0:
            log.info("  Se descarta una pregunta de nivel %s que no se había pedido", nivel)
            continue
        pendientes[nivel] -= 1
        salida.append(limpiar({
            "id": siguiente_id(cat, sub, usados),
            "v": 1,
            "categoria": cat,
            "subtema": sub,
            "nivel": nivel,
            "pregunta": item["pregunta"].strip(),
            "respuesta": item["respuesta"].strip(),
            "tambien_vale": [t.strip() for t in item["tambien_vale"] if t.strip()],
            "criterio": item["criterio"].strip(),
            "explicacion": item["explicacion"].strip(),
            "verificacion": item["verificacion"].strip(),
            "origen": "generada",
        }))
    return salida


def errores_validacion(p: dict, proyecto: Proyecto) -> list[str]:
    inf = vb.Informe()
    archivo = Path(proyecto.categoria(p["categoria"])["archivo"]).name
    vb.validar_pregunta({**p, "_archivo": archivo}, proyecto.config, inf)
    return [e.split(": ", 1)[-1] for e in inf.errores]


def ejecutar(cliente, proyecto: Proyecto, celdas: list[tuple[str, str, int, int]], lote: Lote, modelo_filtro: dict | None,
             semilla: int = 1) -> dict:
    banco = proyecto.banco()
    usados = proyecto.ids_usados()
    rng = random.Random(semilla)
    aceptadas_texto: dict[str, list[str]] = {}
    resumen = {"pedidas": 0, "aceptadas": 0, "rechazadas": 0}

    for (cat, sub), pedidos in agrupar(celdas).items():
        log.info("%s/%s: pidiendo %s", cat, sub, ", ".join(f"{n} de nivel {nivel}" for nivel, n in sorted(pedidos.items())))
        candidatas = []
        pendientes = trocear(pedidos, MAX_POR_LLAMADA)
        while pendientes:
            trozo = pendientes.pop(0)
            try:
                candidatas += generar_grupo(cliente, proyecto, banco, usados, cat, sub, trozo, rng, previas=candidatas)
            except Cortada:
                total = sum(trozo.values())
                if total <= 1:
                    log.warning("  La respuesta se ha cortado por longitud incluso pidiendo una sola pregunta; se salta.")
                    continue
                log.info("  La respuesta se ha cortado por longitud: se repite en dos peticiones más pequeñas.")
                pendientes[:0] = trocear(trozo, (total + 1) // 2)
            except Rechazo as exc:
                log.warning("  %s Se salta el resto de este subtema.", exc)
                break
        resumen["pedidas"] += len(candidatas)

        existentes = [p["pregunta"] for p in banco if p["categoria"] == cat] + aceptadas_texto.get(cat, [])
        validas = []
        for p in candidatas:
            errores = errores_validacion(p, proyecto)
            choca = es_duplicada(p["pregunta"], existentes)
            if errores:
                lote.rechazar(p, "no pasa la validación: " + "; ".join(errores))
            elif choca:
                lote.rechazar(p, f"duplicada: se parece a «{choca}»")
            else:
                validas.append(p)
                existentes.append(p["pregunta"])

        try:
            valoraciones = juzgar(cliente, proyecto, validas) if validas else {}
        except Rechazo as exc:
            log.warning("  El juez no ha podido valorar este subtema: %s", exc)
            valoraciones = {}
        for p in validas:
            p["juez"] = valoraciones.get(p["id"])
            pasa, motivo = ft.evaluar(p, modelo_filtro)
            if pasa:
                lote.aceptar(p, motivo)
                aceptadas_texto.setdefault(cat, []).append(p["pregunta"])
            else:
                lote.rechazar(p, motivo + (f" ({p['juez']['comentario']})" if p.get("juez") and p["juez"]["comentario"] else ""))
        lote.guardar()

    resumen["aceptadas"] = len(lote.datos["preguntas"])
    resumen["rechazadas"] = len(lote.datos["rechazadas"])
    return resumen


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--objetivo", type=int, default=3, help="preguntas por subtema y nivel que se quieren tener (3)")
    ap.add_argument("--max-celdas", type=int, default=40, help="como mucho tantas combinaciones de subtema y nivel por ejecución (40)")
    ap.add_argument("--celda", help="una sola combinación: categoria/subtema/nivel, p. ej. mates/calculo/7")
    ap.add_argument("--cantidad", type=int, default=3, help="preguntas a pedir con --celda (3)")
    ap.add_argument("--semilla", type=int, default=1)
    ap.add_argument("--seco", action="store_true", help="no llama a la API; solo dice qué haría")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    proyecto = Proyecto()
    if args.celda:
        try:
            cat, sub, nivel = args.celda.split("/")
            proyecto.subtema(cat, sub)
            celdas = [(cat, sub, int(nivel), args.cantidad)]
        except (ValueError, KeyError) as exc:
            print(f"✗ Celda no válida «{args.celda}»: {exc}")
            return 2
    else:
        todas = huecos(proyecto, args.objetivo)
        # Primero las celdas a las que más les falta, repartidas entre categorías y subtemas.
        random.Random(args.semilla).shuffle(todas)
        todas.sort(key=lambda c: -c[3])
        celdas = todas[: args.max_celdas]
        print(f"Huecos con menos de {args.objetivo} preguntas: {len(todas)} (se rellenan {len(celdas)})")

    total = sum(c[3] for c in celdas)
    grupos = agrupar(celdas)
    llamadas = sum(len(trocear(p, MAX_POR_LLAMADA)) for p in grupos.values())
    juez_llamadas = sum(-(-sum(p.values()) // 10) for p in grupos.values())
    print(f"Se pedirán {plural(total, 'pregunta')} de {plural(len(grupos), 'subtema')}: "
          f"{plural(llamadas, 'llamada')} de generación y como mucho {juez_llamadas} del juez.")
    for cat, sub, nivel, n in celdas:
        print(f"  · {cat}/{sub} nivel {nivel}: {n}")
    if args.seco or not celdas:
        return 0

    modelo_filtro = ft.cargar_modelo(proyecto.raiz / "generador" / "filtro.json")
    marca = datetime.now().strftime("%Y%m%d-%H%M%S")
    lote = Lote(proyecto.raiz / "generador" / "candidatas" / f"lote-{marca}.json", "modelo" if modelo_filtro else "umbrales")
    try:
        cliente = crear_cliente()
        resumen = ejecutar(cliente, proyecto, celdas, lote, modelo_filtro, args.semilla)
    except Exception as exc:  # noqa: BLE001 — los errores conocidos se explican; el resto se relanza
        mensaje = str(exc) if isinstance(exc, ErrorGenerador) else explicar_error_api(exc)
        if mensaje is None:
            raise
        print(f"✗ {mensaje}")
        if lote.datos["preguntas"] or lote.datos["rechazadas"]:
            print(f"Lo generado hasta ahora está en {lote.ruta.relative_to(proyecto.raiz)}")
        return 1

    print(f"\nPedidas {resumen['pedidas']} · aceptadas {resumen['aceptadas']} · rechazadas {resumen['rechazadas']}")
    print(f"Candidatas en {lote.ruta.relative_to(proyecto.raiz)}")
    print("Revísalas y, si te convencen:  py generador/incorporar.py " + str(lote.ruta.relative_to(proyecto.raiz)).replace("\\", "/"))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(principal())
