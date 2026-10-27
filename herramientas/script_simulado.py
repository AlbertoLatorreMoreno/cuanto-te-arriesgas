"""Un sustituto local del Apps Script de la hoja del grupo (herramientas/apps_script.gs), para probar la
app y analisis/descargar.py sin Google. Contesta como el de verdad: el POST responde con una redirección
(Apps Script redirige a otra dirección para dar la respuesta) y las dos respuestas llevan CORS abierto.
Los registros se guardan en memoria: al pararlo, se pierden.

Como el de verdad, enviar no pide código y descargar sí.

Uso:
    py herramientas/script_simulado.py --puerto 8011 --codigo codigo-de-prueba
    (para que la app envíe aquí, en app/data/config.json: "envio": {"url": "http://127.0.0.1:8011/exec"};
    para descargar: py analisis/descargar.py --url http://127.0.0.1:8011/exec --codigo codigo-de-prueba)
"""

from __future__ import annotations

import argparse
import json
import re
import secrets
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ID_VALIDO = re.compile(r"^[A-Za-z0-9][\w.-]{0,99}$")
TIPOS = {"respuesta", "anulacion", "revision", "ronda", "ronda_anulada", "final", "final_anulada"}
MAX_REGISTROS_POR_ENVIO = 500


class ScriptSimulado:
    """Lo que hace el script con cada petición, sin HTTP."""

    def __init__(self, codigo: str, max_descarga: int = 2000):
        self.codigo = codigo
        self.max_descarga = max_descarga
        self.filas: list[dict] = []  # los registros, en el orden en que llegaron
        self.cerrojo = threading.Lock()

    def atender(self, peticion) -> dict:
        if not isinstance(peticion, dict):
            return {"ok": False, "error": "formato", "mensaje": "La petición no es JSON."}
        if peticion.get("accion") == "enviar":
            return self.guardar(peticion.get("exportacion"))
        if peticion.get("accion") == "descargar":
            if peticion.get("codigo") != self.codigo:
                return {"ok": False, "error": "codigo", "mensaje": "El código de descarga no coincide con el del script."}
            return self.descargar(peticion.get("desde"), peticion.get("cuantos"))
        return {"ok": False, "error": "accion", "mensaje": "Acción desconocida."}

    def guardar(self, exp) -> dict:
        if not isinstance(exp, dict) or exp.get("app") != "cuanto-te-arriesgas" or exp.get("formato") != 1 or not isinstance(exp.get("registros"), list):
            return {"ok": False, "error": "formato", "mensaje": "No es una exportación de la app."}
        registros = exp["registros"]
        if len(registros) > MAX_REGISTROS_POR_ENVIO:
            return {"ok": False, "error": "tamano", "mensaje": f"Como mucho {MAX_REGISTROS_POR_ENVIO} registros por envío."}
        if not all(isinstance(r, dict) and ID_VALIDO.match(str(r.get("id"))) and r.get("tipo") in TIPOS for r in registros):
            return {"ok": False, "error": "formato", "mensaje": "Hay un registro sin id o de un tipo desconocido."}
        with self.cerrojo:
            guardados = {r["id"] for r in self.filas}
            nuevos = 0
            for r in registros:
                if r["id"] not in guardados:
                    guardados.add(r["id"])
                    self.filas.append(r)
                    nuevos += 1
        return {"ok": True, "nuevos": nuevos, "repetidos": len(registros) - nuevos}

    def descargar(self, desde, cuantos) -> dict:
        inicio = max(0, int(desde or 0))
        n = min(self.max_descarga, max(1, int(cuantos or self.max_descarga)))
        with self.cerrojo:
            total = len(self.filas)
            trozo = self.filas[inicio:inicio + n]
        fin = inicio + len(trozo)
        return {"ok": True, "total": total, "registros": trozo, "ilegibles": 0, "siguiente": fin if fin < total else None}


def crear_servidor(script: ScriptSimulado, puerto: int = 0) -> ThreadingHTTPServer:
    respuestas: dict[str, bytes] = {}

    class Manejador(BaseHTTPRequestHandler):
        def _enviar(self, codigo: int, cuerpo: bytes = b"", cabeceras: dict | None = None):
            self.send_response(codigo)
            self.send_header("Access-Control-Allow-Origin", "*")
            for k, v in (cabeceras or {}).items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)

        def do_POST(self):
            if urlparse(self.path).path != "/exec":
                return self._enviar(404)
            crudo = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            try:
                peticion = json.loads(crudo.decode("utf-8"))
            except ValueError:
                datos = {"ok": False, "error": "formato", "mensaje": "La petición no es JSON."}
            else:
                datos = script.atender(peticion)
            ficha = secrets.token_hex(8)
            respuestas[ficha] = json.dumps(datos, ensure_ascii=False).encode("utf-8")
            self._enviar(302, cabeceras={"Location": f"/echo?ficha={ficha}"})

        def do_GET(self):
            ruta = urlparse(self.path)
            if ruta.path == "/exec":
                cuerpo = {"ok": True, "app": "cuanto-te-arriesgas", "mensaje": "El script funciona. Los datos se envían desde la app."}
                return self._enviar(200, json.dumps(cuerpo, ensure_ascii=False).encode("utf-8"), {"Content-Type": "application/json; charset=utf-8"})
            ficha = parse_qs(ruta.query).get("ficha", [""])[0]
            if ruta.path == "/echo" and ficha in respuestas:
                return self._enviar(200, respuestas.pop(ficha), {"Content-Type": "application/json; charset=utf-8"})
            self._enviar(404)

        def log_message(self, formato, *args):
            pass  # sin una línea por petición

    return ThreadingHTTPServer(("127.0.0.1", puerto), Manejador)


def principal(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--puerto", type=int, default=8011)
    ap.add_argument("--codigo", default="codigo-de-prueba")
    args = ap.parse_args(argv)
    servidor = crear_servidor(ScriptSimulado(args.codigo), args.puerto)
    print(f"{datetime.now(timezone.utc):%H:%M:%S} Script simulado en http://127.0.0.1:{args.puerto}/exec (código de descarga: {args.codigo})", flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(principal())
