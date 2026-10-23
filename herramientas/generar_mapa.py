"""Genera el mapa de la app (`app/data/mapa.json`) a partir de los países de Natural Earth.

Uso:
    py herramientas/generar_mapa.py ruta/ne_50m_admin_0_countries.geojson

El archivo de entrada se descarga una vez de
https://github.com/nvkelso/natural-earth-vector (geojson/ne_50m_admin_0_countries.geojson),
que es de dominio público. No hace falta tenerlo en el proyecto: el resultado sí se guarda.

Proyección de Mercator (la de los mapas del móvil: las formas se reconocen al acercarse), en un
cuadrado de ANCHO unidades que va de 180° oeste a 180° este y de 85° sur a 85° norte. Cada país se
simplifica (Douglas-Peucker) y se escribe como trazado SVG con coordenadas enteras relativas, para
que el archivo pese poco. La app hace la cuenta inversa para saber qué punto se ha tocado.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "app" / "data" / "mapa.json"
ANCHO = 40_000  # unidades: un grado de longitud son 111 unidades; en España, 1 unidad ≈ 0,8 km
LAT_MAX = 85.0


def proyectar(lon: float, lat: float) -> tuple[float, float]:
    """Mercator: (lon, lat) en grados → (x, y) en unidades, con y hacia abajo."""
    lat = max(-LAT_MAX, min(LAT_MAX, lat))
    x = (lon + 180.0) / 360.0 * ANCHO
    y_merc = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    y_max = math.log(math.tan(math.pi / 4 + math.radians(LAT_MAX) / 2))
    y = (y_max - y_merc) / (2 * y_max) * ANCHO
    return x, y


def simplificar(puntos: list[tuple[float, float]], tolerancia: float) -> list[tuple[float, float]]:
    """Douglas-Peucker iterativo (los anillos largos harían recursión muy profunda)."""
    if len(puntos) < 3:
        return puntos
    conservar = [False] * len(puntos)
    conservar[0] = conservar[-1] = True
    pila = [(0, len(puntos) - 1)]
    while pila:
        a, b = pila.pop()
        (x1, y1), (x2, y2) = puntos[a], puntos[b]
        dx, dy = x2 - x1, y2 - y1
        largo = math.hypot(dx, dy)
        peor, indice = -1.0, -1
        for i in range(a + 1, b):
            x0, y0 = puntos[i]
            d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / largo if largo else math.hypot(x0 - x1, y0 - y1)
            if d > peor:
                peor, indice = d, i
        if peor > tolerancia:
            conservar[indice] = True
            pila += [(a, indice), (indice, b)]
    return [p for p, c in zip(puntos, conservar) if c]


def area(puntos: list[tuple[int, int]]) -> float:
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(puntos, puntos[1:] + puntos[:1]))) / 2


def trazado(anillo: list[tuple[int, int]]) -> str:
    """Un anillo como «Mx y» seguido de desplazamientos relativos «l dx dy …» y «z»."""
    partes = [f"M{anillo[0][0]} {anillo[0][1]}l"]
    numeros = []
    for (xa, ya), (xb, yb) in zip(anillo, anillo[1:]):
        numeros += [xb - xa, yb - ya]
    texto = ""
    for n in numeros:
        # Un número negativo no necesita espacio delante: el signo ya separa.
        texto += (str(n) if n < 0 or not texto else " " + str(n))
    return partes[0] + texto + "z"


def anillos(geometria: dict):
    if geometria["type"] == "Polygon":
        yield from geometria["coordinates"]
    elif geometria["type"] == "MultiPolygon":
        for poligono in geometria["coordinates"]:
            yield from poligono


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("geojson", type=Path)
    ap.add_argument("--tolerancia", type=float, default=4.0, help="error máximo al simplificar, en unidades (4 ≈ 3 km en España)")
    ap.add_argument("--area-minima", type=float, default=60.0, help="islas más pequeñas que esto (unidades²) se omiten")
    ap.add_argument("--salida", type=Path, default=SALIDA)
    args = ap.parse_args(argv)

    datos = json.loads(args.geojson.read_text(encoding="utf-8"))
    trazos, n_puntos, n_anillos = [], 0, 0
    for feature in datos["features"]:
        for anillo in anillos(feature["geometry"]):
            proyectado = [proyectar(lon, lat) for lon, lat in anillo]
            simple = simplificar(proyectado, args.tolerancia)
            enteros = []
            for x, y in simple:
                p = (round(x), round(y))
                if not enteros or p != enteros[-1]:
                    enteros.append(p)
            if len(enteros) > 1 and enteros[0] == enteros[-1]:
                enteros.pop()
            if len(enteros) < 3 or area(enteros) < args.area_minima:
                continue
            trazos.append(trazado(enteros))
            n_puntos += len(enteros)
            n_anillos += 1

    mapa = {
        "formato": 1,
        "fuente": "Natural Earth, países 1:50m (dominio público), naturalearthdata.com",
        "proyeccion": "mercator",
        "ancho": ANCHO,
        "lat_max": LAT_MAX,
        "d": "".join(trazos),
    }
    args.salida.write_text(json.dumps(mapa, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{n_anillos} contornos, {n_puntos} puntos, {args.salida.stat().st_size / 1024:.0f} KB → {args.salida}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(principal())
