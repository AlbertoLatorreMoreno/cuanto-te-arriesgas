"""Tests del versionado de archivos. Uso: py -m unittest discover -s herramientas"""

import json
import re
import tempfile
import unittest
from pathlib import Path

import versionar as ver

HTML = """<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="css/estilos.css" />
    <script type="module" src="js/main.js"></script>
  </head>
  <body></body>
</html>
"""
SW = """const VERSION = "cta-v1";
const ARCHIVOS = ["css/estilos.css", "js/main.js", "js/motor.js", "js/pantallas/inicio.js"];
"""


class TestVersionar(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.app = Path(self._tmp.name)
        for ruta, texto in {
            "index.html": HTML,
            "sw.js": SW,
            "css/estilos.css": "body {}\n",
            "js/main.js": 'import "./motor.js";\n',
            "js/motor.js": "export const x = 1;\n",
            "js/pantallas/inicio.js": 'import "../motor.js";\n',
        }.items():
            (self.app / ruta).parent.mkdir(parents=True, exist_ok=True)
            (self.app / ruta).write_text(texto, encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def escribir(self):
        html, sw = ver.aplicar(self.app)
        (self.app / "index.html").write_text(html, encoding="utf-8")
        (self.app / "sw.js").write_text(sw, encoding="utf-8")
        return html, sw

    def test_pone_la_version_en_todas_las_direcciones(self):
        html, sw = self.escribir()
        v = ver.calcular_version(self.app)
        self.assertIn(f'href="css/estilos.css?v={v}"', html)
        self.assertIn(f'src="js/main.js?v={v}"', html)
        self.assertIn(f'const VERSION = "cta-{v}";', sw)
        mapa = json.loads(re.search(r'<script type="importmap">(.*?)</script>', html, re.S).group(1))
        self.assertEqual(mapa["imports"], {
            "./js/motor.js": f"./js/motor.js?v={v}",
            "./js/pantallas/inicio.js": f"./js/pantallas/inicio.js?v={v}",
        })
        # El mapa va antes que cualquier módulo (si no, el navegador lo ignora).
        self.assertLess(html.index('type="importmap"'), html.index('type="module"'))

    def test_es_idempotente(self):
        primero = self.escribir()
        self.assertEqual(self.escribir(), primero)
        self.assertEqual(primero[0].count('type="importmap"'), 1)

    def test_cambia_si_cambia_un_archivo_y_no_por_finales_de_linea(self):
        self.escribir()
        v1 = ver.calcular_version(self.app)
        (self.app / "js/motor.js").write_bytes(b"export const x = 1;\r\n")
        self.assertEqual(ver.calcular_version(self.app), v1)
        (self.app / "js/motor.js").write_text("export const x = 2;\n", encoding="utf-8")
        v2 = ver.calcular_version(self.app)
        self.assertNotEqual(v2, v1)
        html, sw = self.escribir()
        self.assertNotIn(v1, html + sw)

    def test_sw_cuenta_pero_no_su_propia_version(self):
        v1 = ver.calcular_version(self.app)
        self.escribir()  # solo cambia la línea de VERSION de sw.js
        self.assertEqual(ver.calcular_version(self.app), v1)
        sw = (self.app / "sw.js").read_text(encoding="utf-8")
        (self.app / "sw.js").write_text(sw + "// otro cambio\n", encoding="utf-8")
        self.assertNotEqual(ver.calcular_version(self.app), v1)

    def test_avisa_de_modulos_que_el_service_worker_no_guarda(self):
        self.assertEqual(ver.sin_guardar_en_sw(self.app), [])
        (self.app / "js/nuevo.js").write_text("export {};\n", encoding="utf-8")
        self.assertEqual(ver.sin_guardar_en_sw(self.app), ["js/nuevo.js"])

    def test_pone_en_la_csp_las_huellas_de_los_scripts_en_linea(self):
        csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self' 'sha256-vieja'; object-src 'none'\" />"
        html = HTML.replace("<head>", f"<head>\n    {csp}").replace("<body></body>", "<body><script>console.log(1)</script></body>")
        (self.app / "index.html").write_text(html, encoding="utf-8")
        html, _ = self.escribir()
        mapa = re.search(r'<script type="importmap">(.*?)</script>', html, re.S).group(1)
        politica = re.search(r'Content-Security-Policy" content="([^"]*)"', html).group(1)
        self.assertIn(f"script-src 'self' {ver.huella_csp(mapa)} {ver.huella_csp('console.log(1)')};", politica)
        self.assertNotIn("vieja", politica)
        self.assertIn("object-src 'none'", politica)
        self.assertEqual(ver.huella_csp("a\r\nb"), ver.huella_csp("a\nb"), "como el navegador: sin distinguir finales de línea")
        self.assertEqual(self.escribir()[0], html, "idempotente")

    def test_la_csp_solo_deja_conectar_con_el_script_de_la_app(self):
        """Con `https://script.google.com` a secas, un código colado en la página (o en otro proyecto del mismo
        usuario.github.io) podría mandar los datos a un script de Google suyo. Solo vale la dirección de config.json."""
        html = (ver.APP / "index.html").read_text(encoding="utf-8")
        politica = re.search(r'Content-Security-Policy" content="([^"]*)"', html).group(1)
        conectar = next(d.split()[1:] for d in politica.split(";") if d.split()[:1] == ["connect-src"])
        url = json.loads((ver.APP / "data" / "config.json").read_text(encoding="utf-8"))["envio"]["url"]
        if url:
            self.assertIn(url, conectar, "si cambias la dirección del script en config.json, cámbiala también en la CSP de index.html")
        for fuente in conectar:
            self.assertNotIn(fuente, {"https://script.google.com", "https:", "*", "https://*.google.com"}, f"demasiado abierto: {fuente}")
            if fuente.startswith("https://script.google.com"):
                self.assertEqual(fuente, url)

    def test_la_app_real_tiene_csp_sin_codigo_en_atributos(self):
        html = (ver.APP / "index.html").read_text(encoding="utf-8")
        politica = re.search(r'Content-Security-Policy" content="([^"]*)"', html).group(1)
        scripts = ver.RE_SCRIPT_EN_LINEA.findall(html)
        self.assertGreaterEqual(len(scripts), 2, "el mapa de importación y el aviso de carga")
        for s in scripts:
            self.assertIn(ver.huella_csp(s), politica)
        self.assertNotIn("unsafe", politica, "nada de 'unsafe-inline' ni 'unsafe-eval'")
        self.assertIsNone(re.search(r"\son[a-z]+\s*=", html), "sin código en atributos (onclick=…): la CSP no lo deja ejecutar")
        self.assertLess(html.index("Content-Security-Policy"), html.index("<script"), "la CSP va antes que cualquier script")

    def test_la_app_real_esta_al_dia(self):
        html, sw = ver.aplicar()
        self.assertEqual(html, (ver.APP / "index.html").read_text(encoding="utf-8"), "ejecuta py herramientas/versionar.py")
        self.assertEqual(sw, (ver.APP / "sw.js").read_text(encoding="utf-8"), "ejecuta py herramientas/versionar.py")
        self.assertEqual(ver.sin_guardar_en_sw(), [])


if __name__ == "__main__":
    unittest.main()
