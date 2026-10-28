"""Descarga a analisis/datos/ los registros que los móviles han enviado a la hoja del grupo.

Uso (desde la carpeta raíz del proyecto):
    py analisis/descargar.py                    # dirección de app/data/config.json y código de analisis/envio.json
    py analisis/descargar.py --codigo …         # o el código a mano (y --url para otra dirección)

`analisis/envio.json` lo creas tú, con el código de descarga que pusiste en el script:
    {"codigo": "…"}
.gitignore lo excluye: es la contraseña para leer la hoja. La dirección no es secreta (la lleva la app).

Escribe siempre el mismo archivo, analisis/datos/arriesga-hoja.json, con todo lo que hay en la hoja. Puede
convivir con las exportaciones a mano: la calibración junta todos los archivos y descarta los registros repetidos.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

RAIZ = Path(__file__).resolve().parent.parent
CONFIG = RAIZ / "analisis" / "envio.json"
NOMBRE = "arriesga-hoja.json"
POR_PETICION = 2000

# Forma de un registro de la app (docs/esquema_datos.md). Lo que llega de la hoja lo puede haber enviado
# cualquiera (la dirección del script es pública): lo que no tenga esta forma se descarta antes de calibrar.
TIPOS = {"respuesta", "anulacion", "revision", "ronda", "ronda_anulada", "final", "final_anulada"}
ID_VALIDO = re.compile(r"^[A-Za-z0-9][\w.-]{0,99}$")
TS_VALIDO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$")
LOGICOS = {"es_final", "acierto", "tiempo_agotado"}
ENTEROS = {"turno", "v", "nivel_inicial", "nivel_mostrado", "apuesta", "nivel_desde", "nivel_hasta", "cronometro", "puntos", "nivel",
           "nivel_pedido", "ventaja", "rebaja", "ronda_oro", "aciertos", "minimo", "total", "leidos", "extra", "segundos"}
NUMEROS = {"lat_senalada", "lon_senalada", "distancia_km", "distancia_max_km"}
LISTAS_DE_ENTEROS = {"marcados"}
MAX_TEXTO = 200


class ErrorDescarga(Exception):
    pass


def registro_valido(r) -> bool:
    """Si tiene la forma de un registro de la app: id, tipo y fecha válidos, cada campo de su tipo y textos cortos, sin
    objetos anidados. Uno con otra forma (una lista donde va un nombre, un texto enorme) haría fallar la calibración."""
    if not isinstance(r, dict) or not isinstance(r.get("id"), str) or not ID_VALIDO.match(r["id"]) or r.get("tipo") not in TIPOS:
        return False
    if not isinstance(r.get("ts"), str) or not TS_VALIDO.match(r["ts"]):
        return False
    for clave, valor in r.items():
        if valor is None:
            continue
        if clave in LOGICOS:
            bien = isinstance(valor, bool)
        elif clave in ENTEROS:
            bien = isinstance(valor, int) and not isinstance(valor, bool) and abs(valor) < 10**6
        elif clave in NUMEROS:
            bien = isinstance(valor, (int, float)) and not isinstance(valor, bool) and math.isfinite(valor) and abs(valor) < 10**6
        elif clave in LISTAS_DE_ENTEROS:
            bien = isinstance(valor, list) and len(valor) <= 100 and all(isinstance(x, int) and not isinstance(x, bool) for x in valor)
        else:
            bien = isinstance(valor, str) and len(valor) <= MAX_TEXTO
        if not bien:
            return False
    return True


def resumen_por_movil(registros: list[dict]) -> list[tuple[str, int, list[str], str, str]]:
    """Por cada móvil (`dispositivo`): cuántos registros, los nombres que salen (jugadores, lectores, quien revisa) y
    entre qué fechas. Sirve para ver de un vistazo si llegan datos de un móvil que no es del grupo."""
    por: dict[str, dict] = {}
    for r in registros:
        d = por.setdefault(str(r.get("dispositivo") or "?"), {"n": 0, "nombres": Counter(), "ts": []})
        d["n"] += 1
        d["ts"].append(r["ts"])
        for campo in ("jugador", "lector", "evaluador"):
            if isinstance(r.get(campo), str):
                d["nombres"][r[campo]] += 1
    filas = [(m, d["n"], [n for n, _ in d["nombres"].most_common(6)], min(d["ts"])[:10], max(d["ts"])[:10]) for m, d in por.items()]
    return sorted(filas, key=lambda f: -f[1])


def error_direccion(url: str) -> str | None:
    """None si es la dirección de una aplicación web de Apps Script (o el sustituto local de las pruebas); si no, qué
    falla. El código de descarga es la llave de todos los datos: no se manda a ningún otro sitio, aunque alguien
    cambie la dirección de config.json o se pegue una equivocada."""
    partes = urlparse(url)
    if partes.scheme == "http" and partes.hostname in ("127.0.0.1", "localhost"):
        return None
    if partes.scheme != "https":
        return "la dirección del script tiene que empezar por https://."
    if (partes.hostname != "script.google.com" or partes.port or partes.username or partes.password or partes.query or partes.fragment
            or not re.fullmatch(r"/macros/s/[A-Za-z0-9_-]+/exec", partes.path)):
        return ("la dirección no es la de una aplicación web de Apps Script (https://script.google.com/macros/s/…/exec), "
                "y el código de descarga no se envía a ningún otro sitio.")
    return None


def pedir(url: str, cuerpo: dict, espera: float = 120) -> dict:
    """POST como el de la app (texto plano). Apps Script contesta con una redirección, que urllib sigue con un GET."""
    peticion = urllib.request.Request(url, data=json.dumps(cuerpo).encode("utf-8"), method="POST",
                                      headers={"Content-Type": "text/plain;charset=utf-8"})
    try:
        with urllib.request.urlopen(peticion, timeout=espera) as r:
            texto = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise ErrorDescarga(f"el script ha respondido con un error {e.code}.") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ErrorDescarga(f"no se ha podido conectar con el script ({e}).") from e
    try:
        return json.loads(texto)
    except ValueError as e:
        raise ErrorDescarga("la respuesta no es la del script de la app: ¿es la dirección de la aplicación web (acaba en /exec)?") from e


def descargar(url: str, codigo: str, pedir=pedir) -> tuple[list[dict], int]:
    """Todos los registros de la hoja, por tandas, y cuántas filas no se han podido leer."""
    registros: list[dict] = []
    ilegibles = 0
    desde = 0
    while desde is not None:
        r = pedir(url, {"codigo": codigo, "accion": "descargar", "desde": desde, "cuantos": POR_PETICION})
        if not isinstance(r, dict) or r.get("ok") is not True:
            mensaje = r.get("mensaje") if isinstance(r, dict) else None
            raise ErrorDescarga(mensaje or "la respuesta no es la del script de la app.")
        registros += [x for x in r.get("registros") or [] if isinstance(x, dict)]
        ilegibles += int(r.get("ilegibles") or 0)
        siguiente = r.get("siguiente")
        # Una respuesta que no avanza se cortaría aquí en vez de pedir lo mismo para siempre.
        if siguiente is not None and (not isinstance(siguiente, int) or siguiente <= desde):
            raise ErrorDescarga("la respuesta no es la del script de la app (la descarga no avanza).")
        desde = siguiente
    return registros, ilegibles


def leer_config(ruta: Path) -> dict:
    if not ruta.exists():
        return {}
    try:
        x = json.loads(ruta.read_text(encoding="utf-8"))
    except ValueError as e:
        raise ErrorDescarga(f"{ruta.name} no es un JSON válido.") from e
    return x if isinstance(x, dict) else {}


def url_de_la_app(ruta: Path = RAIZ / "app" / "data" / "config.json") -> str:
    """La dirección del script que lleva la app (`envio.url`), o vacía."""
    try:
        return str(((leer_config(ruta).get("envio") or {}).get("url")) or "")
    except ErrorDescarga:
        return ""


def escribir_exportacion(registros: list[dict], carpeta: Path) -> Path:
    """Como una exportación de la app, para que la calibración la lea igual. Se escribe aparte y se cambia de
    nombre al final: una descarga cortada nunca deja el archivo a medias."""
    datos = {
        "formato": 1,
        "app": "cuanto-te-arriesgas",
        "exportado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dispositivo": "hoja-del-grupo",
        "registros": sorted(registros, key=lambda r: str(r.get("ts") or "")),
    }
    carpeta.mkdir(parents=True, exist_ok=True)
    destino = carpeta / NOMBRE
    temporal = carpeta / (NOMBRE + ".parcial")
    temporal.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    temporal.replace(destino)
    return destino


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="dirección de la aplicación web del script (por defecto, la de app/data/config.json)")
    ap.add_argument("--codigo", help="código de descarga (por defecto, el de analisis/envio.json)")
    ap.add_argument("--config", type=Path, default=CONFIG, help="archivo con el código de descarga")
    ap.add_argument("--datos", type=Path, default=RAIZ / "analisis" / "datos", help="carpeta de las exportaciones")
    args = ap.parse_args(argv)
    try:
        config = leer_config(args.config)
        url = (args.url or config.get("url") or url_de_la_app()).strip()
        codigo = (args.codigo or config.get("codigo") or "").strip()
        if not url:
            raise ErrorDescarga("falta la dirección del script: ponla en app/data/config.json («envio» → «url») o con --url.")
        if not codigo:
            raise ErrorDescarga(f"falta el código de descarga: ponlo en {args.config.name} o con --codigo.")
        if error := error_direccion(url):
            raise ErrorDescarga(error)
        registros, ilegibles = descargar(url, codigo)
    except ErrorDescarga as e:
        print(f"No se ha podido descargar: {e}", file=sys.stderr)
        return 1
    validos = [r for r in registros if registro_valido(r)]
    raros = len(registros) - len(validos)
    if not validos:
        print("La hoja todavía no tiene registros válidos: no se ha escrito nada." + (f" ({raros} con una forma rara, descartados.)" if raros else ""))
        return 0
    destino = escribir_exportacion(validos, args.datos)
    print(f"Descargados {len(validos)} registros en {destino.relative_to(RAIZ) if destino.is_relative_to(RAIZ) else destino}.")
    if ilegibles:
        print(f"Aviso: {ilegibles} filas de la hoja no se han podido leer (¿se tocaron a mano?).")
    if raros:
        print(f"Aviso: {raros} registros no tienen la forma de los de la app y se han descartado. Si son muchos, alguien está enviando basura a la hoja.")
    # La dirección del script es pública: que se vea si llegan datos de un móvil que no es del grupo.
    print("Por móvil (registros · nombres · fechas):")
    for movil, n, nombres, desde, hasta in resumen_por_movil(validos):
        print(f"  {movil[:8]} · {n} · {', '.join(nombres) or '—'} · {desde} → {hasta}")
    print("Si hay un móvil que no reconoces, borra sus filas de la hoja antes de calibrar.")
    print("Ahora: py analisis/calibrar.py")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(principal())
