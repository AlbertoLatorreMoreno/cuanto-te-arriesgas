"""Descarga de la hoja del grupo (analisis/descargar.py) contra el script simulado (herramientas/script_simulado.py),
servido en este ordenador: con la redirección que hace Apps Script, por tandas, y leída después por la calibración."""

from __future__ import annotations

import io
import json
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from calibracion import RAIZ, leer_exportaciones
import descargar

sys.path.insert(0, str(RAIZ / "herramientas"))
from script_simulado import ScriptSimulado, crear_servidor  # noqa: E402

CODIGO = "codigo-de-prueba"


def registro(i: int) -> dict:
    return {"id": f"reg-{i:03d}", "tipo": "respuesta", "ts": f"2026-10-26T10:{i // 60:02d}:{i % 60:02d}.000Z", "partida": "p1", "jugador": "ana", "acierto": i % 2 == 0}


class TestDescargar(unittest.TestCase):
    def setUp(self):
        self.script = ScriptSimulado(CODIGO, max_descarga=4)
        self.servidor = crear_servidor(self.script)
        threading.Thread(target=self.servidor.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.servidor.server_address[1]}/exec"
        self.tmp = Path(tempfile.mkdtemp(prefix="descargar-"))

    def tearDown(self):
        self.servidor.shutdown()
        self.servidor.server_close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ejecutar(self, *args) -> tuple[int, str]:
        salida = io.StringIO()
        with redirect_stdout(salida), redirect_stderr(salida):
            codigo = descargar.principal([*args, "--datos", str(self.tmp), "--config", str(self.tmp / "no-existe.json")])
        return codigo, salida.getvalue()

    def enviar(self, registros: list[dict]) -> dict:
        exp = {"formato": 1, "app": "cuanto-te-arriesgas", "dispositivo": "d1", "registros": registros}
        return descargar.pedir(self.url, {"codigo": CODIGO, "accion": "enviar", "exportacion": exp})

    def test_el_simulado_redirige_como_apps_script(self):
        peticion = urllib.request.Request(self.url, data=b"{}", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.build_opener(SinRedirecciones).open(peticion)
        self.assertEqual(e.exception.code, 302)

    def test_descarga_por_tandas_y_la_calibracion_lo_lee(self):
        self.assertEqual(self.enviar([registro(i) for i in range(10)]), {"ok": True, "nuevos": 10, "repetidos": 0})
        self.assertEqual(self.enviar([registro(9), registro(10)])["nuevos"], 1, "reenviar no duplica")
        codigo, salida = self.ejecutar("--url", self.url, "--codigo", CODIGO)
        self.assertEqual(codigo, 0, salida)
        self.assertIn("Descargados 11 registros", salida)
        datos = json.loads((self.tmp / descargar.NOMBRE).read_text(encoding="utf-8"))
        self.assertEqual([datos["formato"], datos["app"]], [1, "cuanto-te-arriesgas"])
        self.assertEqual([r["id"] for r in datos["registros"]], [f"reg-{i:03d}" for i in range(11)])
        self.assertEqual(len(leer_exportaciones(self.tmp, avisar=lambda _: None).registros), 11)
        self.assertFalse(list(self.tmp.glob("*.parcial")))

        # Otra descarga sustituye al archivo (no se acumulan copias).
        self.enviar([registro(11)])
        self.assertEqual(self.ejecutar("--url", self.url, "--codigo", CODIGO)[0], 0)
        self.assertEqual([p.name for p in self.tmp.iterdir()], [descargar.NOMBRE])
        self.assertEqual(len(json.loads((self.tmp / descargar.NOMBRE).read_text(encoding="utf-8"))["registros"]), 12)

    def test_con_otro_codigo_o_sin_datos_no_escribe_nada(self):
        self.enviar([registro(1)])
        codigo, salida = self.ejecutar("--url", self.url, "--codigo", "otro-codigo")
        self.assertEqual(codigo, 1)
        self.assertIn("El código de descarga no coincide", salida)
        self.assertEqual(list(self.tmp.iterdir()), [])
        self.assertEqual(self.ejecutar("--url", "http://example.com/exec", "--codigo", CODIGO)[0], 1, "sin https, ni lo intenta")
        self.assertEqual(self.ejecutar()[0], 1, "sin dirección ni código")
        vacio = ScriptSimulado(CODIGO)
        self.assertEqual(descargar.descargar("x", CODIGO, pedir=lambda url, cuerpo: vacio.atender(cuerpo)), ([], 0))

    def test_la_direccion_sale_de_la_app_y_el_codigo_del_archivo(self):
        self.enviar([registro(1)])
        (self.tmp / "envio.json").write_text(json.dumps({"codigo": CODIGO}), encoding="utf-8")
        original = descargar.url_de_la_app
        descargar.url_de_la_app = lambda: self.url
        try:
            salida = io.StringIO()
            with redirect_stdout(salida):
                codigo = descargar.principal(["--datos", str(self.tmp / "datos"), "--config", str(self.tmp / "envio.json")])
        finally:
            descargar.url_de_la_app = original
        self.assertEqual(codigo, 0, salida.getvalue())
        self.assertTrue((self.tmp / "datos" / descargar.NOMBRE).exists())

    def test_enviar_no_pide_codigo_y_descargar_si(self):
        exp = {"formato": 1, "app": "cuanto-te-arriesgas", "registros": [registro(1)]}
        self.assertEqual(descargar.pedir(self.url, {"accion": "enviar", "exportacion": exp})["nuevos"], 1)
        self.assertEqual(descargar.pedir(self.url, {"accion": "descargar"})["error"], "codigo")

    def test_la_direccion_de_la_app_se_lee_de_su_configuracion(self):
        ruta = self.tmp / "config.json"
        ruta.write_text(json.dumps({"envio": {"url": "https://script.google.com/macros/s/x/exec"}}), encoding="utf-8")
        self.assertEqual(descargar.url_de_la_app(ruta), "https://script.google.com/macros/s/x/exec")
        ruta.write_text("{roto", encoding="utf-8")
        self.assertEqual(descargar.url_de_la_app(ruta), "")
        self.assertIsInstance(descargar.url_de_la_app(), str, "la de verdad, aunque esté vacía")

    def test_una_respuesta_que_no_avanza_no_se_queda_pidiendo_para_siempre(self):
        atascado = lambda url, cuerpo: {"ok": True, "registros": [registro(1)], "siguiente": 0}  # noqa: E731
        with self.assertRaises(descargar.ErrorDescarga):
            descargar.descargar("x", CODIGO, pedir=atascado)
        with self.assertRaises(descargar.ErrorDescarga):
            descargar.descargar("x", CODIGO, pedir=lambda url, cuerpo: ["no es un objeto"])


class SinRedirecciones(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


if __name__ == "__main__":
    unittest.main()
