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

    def test_el_codigo_solo_va_a_una_direccion_de_apps_script(self):
        buenas = ["https://script.google.com/macros/s/AKfycb-x_1/exec", "http://127.0.0.1:8011/exec", "http://localhost:8011/exec"]
        malas = ["http://script.google.com/macros/s/AKfycb/exec",           # sin https
                 "https://script.google.com.ataque.com/macros/s/AKfycb/exec",  # otro dominio que lo imita
                 "https://ataque.com/macros/s/AKfycb/exec",
                 "https://alguien@script.google.com/macros/s/AKfycb/exec",
                 "https://script.google.com:8443/macros/s/AKfycb/exec",
                 "https://script.google.com/macros/s/AKfycb/exec?siguiente=https://ataque.com",
                 "https://script.google.com/macros/s/AKfycb/dev",              # la versión de pruebas, que pide iniciar sesión
                 "https://script.google.com/a/macros/s/AKfycb/exec",
                 "ftp://script.google.com/macros/s/AKfycb/exec"]
        self.assertEqual([descargar.error_direccion(u) for u in buenas], [None] * len(buenas))
        self.assertTrue(all(descargar.error_direccion(u) for u in malas))
        # Y la descarga ni lo intenta: no llega a mandar el código.
        (self.tmp / "envio.json").write_text(json.dumps({"codigo": CODIGO}), encoding="utf-8")
        salida = io.StringIO()
        with redirect_stdout(salida), redirect_stderr(salida):
            codigo = descargar.principal(["--url", malas[1], "--config", str(self.tmp / "envio.json"), "--datos", str(self.tmp / "datos")])
        self.assertEqual(codigo, 1)
        self.assertIn("no se envía a ningún otro sitio", salida.getvalue())

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


class TestLoQueLlegaDeLaHoja(unittest.TestCase):
    """La dirección del script es pública: lo que se descarga lo puede haber enviado cualquiera."""

    def test_solo_pasan_los_registros_con_la_forma_de_la_app(self):
        bueno = registro(1)
        self.assertTrue(descargar.registro_valido(bueno))
        self.assertTrue(descargar.registro_valido({**bueno, "tipo": "final", "marcados": [0, 2], "nivel": 8, "ronda_oro": None}))
        self.assertTrue(descargar.registro_valido({**bueno, "lat_senalada": 40.4, "distancia_km": 12, "nota": "texto corto"}))
        # El tema que eligió quien juega (fase 23): un texto corto, o null si iba sin tema.
        self.assertTrue(descargar.registro_valido({**bueno, "tema_elegido": "harry_potter"}))
        self.assertTrue(descargar.registro_valido({**bueno, "tema_elegido": None}))
        raros = [
            "no es un objeto",
            {**bueno, "id": "=IMPORTXML(1)"},
            {**bueno, "tipo": "otra_cosa"},
            {**bueno, "ts": 5},
            {**bueno, "ts": "ayer"},
            {**bueno, "jugador": ["ana"]},  # una lista donde va un nombre: rompía la calibración
            {**bueno, "jugador": "x" * 500},
            {**bueno, "acierto": "sí"},
            {**bueno, "v": True},
            {**bueno, "apuesta": 10**9},
            {**bueno, "lat_senalada": float("nan")},
            {**bueno, "marcados": [1, "dos"]},
            {**bueno, "extra_raro": {"anidado": 1}},
        ]
        self.assertEqual([descargar.registro_valido(r) for r in raros], [False] * len(raros))

    def test_resumen_por_movil(self):
        regs = [{**registro(i), "dispositivo": "aaaa1111-x", "jugador": "ana", "lector": "luis"} for i in range(3)]
        regs += [{**registro(9), "id": "otro", "dispositivo": "bbbb2222-y", "tipo": "revision", "jugador": None, "evaluador": "eva"}]
        filas = descargar.resumen_por_movil(regs)
        self.assertEqual([(m, n, nombres) for m, n, nombres, _, _ in filas], [("aaaa1111-x", 3, ["ana", "luis"]), ("bbbb2222-y", 1, ["eva"])])
        self.assertEqual(filas[0][3:], ("2026-10-26", "2026-10-26"))

    def test_los_nombres_no_rompen_el_informe(self):
        from informe import celda
        self.assertEqual(celda("ana | luis\n<b>"), "ana \\| luis &lt;b&gt;")


class TestFrenoDeRetiradas(unittest.TestCase):
    """Una sola marca de «errónea» retira una pregunta: con marcas falsas en la hoja se podría vaciar el banco."""

    def test_frena_si_se_retiran_de_golpe_mas_del_maximo(self):
        from calibracion import freno_retiradas
        marcas = [{"pregunta": f"q{i}", "quien": "evaluador:intruso", "motivo": "erronea"} for i in range(12)]
        marcas.append({"pregunta": "q0", "quien": "partida:p1", "motivo": "ambigua"})
        retiradas = {f"q{i}": "erronea" for i in range(12)}
        freno = freno_retiradas(retiradas, {}, marcas, 10)
        self.assertEqual(len(freno["nuevas"]), 12)
        self.assertEqual(freno["origen"][0], ("evaluador:intruso", 12))
        self.assertIsNone(freno_retiradas(retiradas, {f"q{i}": "erronea" for i in range(5)}, marcas, 10), "las ya retiradas no cuentan")
        self.assertIsNone(freno_retiradas({"q1": "erronea"}, {}, marcas, 10))
        self.assertIsNone(freno_retiradas(retiradas, {}, marcas, None), "sin máximo en la configuración, no frena")


class SinRedirecciones(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


if __name__ == "__main__":
    unittest.main()
