"""Pone una versión a los archivos de la app para que el navegador no mezcle versiones.

Justo después de publicar, un navegador con la app abierta podía cargar un archivo nuevo
junto a otro viejo de su caché, y la app fallaba o se comportaba mal. Esta herramienta
calcula una huella del contenido de `app/js`, `app/css` y `app/sw.js` y la añade como
`?v=…` a todos los archivos en `app/index.html` (con un mapa de importación para los
módulos) y al nombre de la caché del service worker. Si cambia cualquier archivo, cambian
todas las direcciones y el navegador pide las versiones nuevas. También comprueba que el
service worker guarde todos los módulos para poder jugar sin conexión.

Uso (antes de publicar, después de cambiar JS, CSS o sw.js):
    py herramientas/versionar.py
    py herramientas/versionar.py --comprobar   # sale con 1 si hace falta volver a ejecutarlo
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
APP = RAIZ / "app"


def archivos_versionados(app: Path = APP) -> list[Path]:
    return sorted([*app.glob("js/**/*.js"), *app.glob("css/*.css")])


RE_VERSION_SW = re.compile(r'const VERSION = "[^"]*";')

# Política de seguridad (CSP) de index.html: el navegador solo ejecuta los archivos de la app y los scripts en
# línea cuya huella está en `script-src`. El mapa de importación cambia con cada versión, así que su huella también.
RE_SCRIPT_EN_LINEA = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S)
RE_SCRIPT_SRC_CSP = re.compile(r"(script-src 'self')[^;\"]*")


def huella_csp(texto: str) -> str:
    """Huella de un script en línea tal como la calcula el navegador (con los saltos de línea normalizados)."""
    resumen = hashlib.sha256(texto.replace("\r\n", "\n").encode("utf-8")).digest()
    return f"'sha256-{base64.b64encode(resumen).decode('ascii')}'"


def con_huellas_csp(html: str) -> str:
    huellas = " ".join(huella_csp(s) for s in RE_SCRIPT_EN_LINEA.findall(html))
    return RE_SCRIPT_SRC_CSP.sub(lambda m: f"{m.group(1)} {huellas}".rstrip(), html, count=1)


def calcular_version(app: Path = APP) -> str:
    h = hashlib.sha1()
    for ruta in archivos_versionados(app):
        h.update(ruta.relative_to(app).as_posix().encode("utf-8"))
        h.update(ruta.read_bytes().replace(b"\r\n", b"\n"))
    # sw.js entra sin su propia línea de VERSION (si no, la huella dependería de sí misma).
    sw = RE_VERSION_SW.sub("", (app / "sw.js").read_text(encoding="utf-8").replace("\r\n", "\n"))
    h.update(sw.encode("utf-8"))
    return h.hexdigest()[:10]


def sin_guardar_en_sw(app: Path = APP) -> list[str]:
    """Archivos JS/CSS que el service worker no guarda (sin ellos no se puede jugar sin conexión)."""
    sw = (app / "sw.js").read_text(encoding="utf-8")
    rutas = [r.relative_to(app).as_posix() for r in archivos_versionados(app)]
    return [r for r in rutas if f'"{r}"' not in sw]


def mapa_importacion(app: Path, version: str) -> str:
    modulos = [r.relative_to(app).as_posix() for r in archivos_versionados(app) if r.suffix == ".js" and r.name != "main.js"]
    imports = {f"./{m}": f"./{m}?v={version}" for m in modulos}
    cuerpo = json.dumps({"imports": imports}, ensure_ascii=False, indent=2)
    sangrado = "\n".join("      " + linea for linea in cuerpo.splitlines())
    return f'<script type="importmap">\n{sangrado}\n    </script>'


def aplicar(app: Path = APP) -> tuple[str, str]:
    """Devuelve (index.html, sw.js) con la versión actual, sin escribirlos."""
    version = calcular_version(app)
    html = (app / "index.html").read_text(encoding="utf-8")
    html = re.sub(r'href="css/estilos\.css(\?v=[^"]*)?"', f'href="css/estilos.css?v={version}"', html)
    html = re.sub(r'src="js/main\.js(\?v=[^"]*)?"', f'src="js/main.js?v={version}"', html)
    mapa = mapa_importacion(app, version)
    if '<script type="importmap">' in html:
        html = re.sub(r'<script type="importmap">.*?</script>', lambda _: mapa, html, count=1, flags=re.S)
    else:
        # El mapa tiene que ir antes que cualquier módulo.
        html = html.replace('    <link rel="stylesheet"', f"    {mapa}\n    <link rel=\"stylesheet\"", 1)
    html = con_huellas_csp(html)
    sw = (app / "sw.js").read_text(encoding="utf-8")
    sw = RE_VERSION_SW.sub(f'const VERSION = "cta-{version}";', sw, count=1)
    return html, sw


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--comprobar", action="store_true", help="no escribe; sale con 1 si los archivos no están al día")
    args = ap.parse_args(argv)
    faltan = sin_guardar_en_sw()
    if faltan:
        print("Añade a ARCHIVOS en app/sw.js (si no, sin conexión no cargarán): " + ", ".join(faltan))
        if args.comprobar:
            return 1
    html, sw = aplicar()
    al_dia = html == (APP / "index.html").read_text(encoding="utf-8") and sw == (APP / "sw.js").read_text(encoding="utf-8")
    if args.comprobar:
        print("Versión al día." if al_dia else "Hay cambios sin versionar: ejecuta  py herramientas/versionar.py")
        return 0 if al_dia else 1
    (APP / "index.html").write_text(html, encoding="utf-8")
    (APP / "sw.js").write_text(sw, encoding="utf-8")
    print(f"Versión {calcular_version()}" + (" (sin cambios)" if al_dia else " aplicada a index.html y sw.js"))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(principal())
