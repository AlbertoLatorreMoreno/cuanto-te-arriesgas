"""Tests del validador de finales propias. Uso: py -m unittest discover -s herramientas"""

import copy
import json
import tempfile
import unittest
from pathlib import Path

import validar_banco as vb
import validar_finales as vf
from validar_banco import Informe

PREGUNTA = {
    "id": "fin-001", "v": 1, "nivel": 9, "tipo": "pregunta",
    "pregunta": "¿Qué elemento químico se descubrió en el Sol antes que en la Tierra?",
    "respuesta": "Helio", "tambien_vale": ["He"], "criterio": None,
    "explicacion": "Se vio en el espectro solar durante el eclipse de 1868.", "segundos": None,
    "fuente": "Royal Society of Chemistry, «Helium»",
}
CALCULO = {
    "id": "fin-002", "v": 1, "nivel": 10, "tipo": "pregunta",
    "pregunta": "¿Cuánto suman todos los números del 1 al 200?", "respuesta": "20100", "tambien_vale": [],
    "criterio": None, "explicacion": "200 × 201 / 2.", "segundos": 60, "verificacion": "200*201/2", "fuente": "Cálculo",
}
RETO = {
    "id": "fin-003", "v": 1, "nivel": 10, "tipo": "reto", "titulo": "Banderas de estados",
    "enunciado": "Te describo cinco banderas de estados de EE. UU.: acierta al menos cuatro.",
    "minimo": 4, "segundos": 60, "nota": None, "fuente": "Banderas oficiales de cada estado",
    "elementos": [
        {"pista": "Un oso pardo sobre la hierba y una estrella roja", "respuesta": "California", "tambien_vale": []},
        {"pista": "Una estrella solitaria blanca sobre azul, con franjas blanca y roja", "respuesta": "Texas", "tambien_vale": []},
        {"pista": "Sol rojo de los zia sobre fondo amarillo", "respuesta": "Nuevo México", "tambien_vale": ["New Mexico"]},
        {"pista": "Siete estrellas doradas formando la Osa Mayor sobre azul", "respuesta": "Alaska", "tambien_vale": []},
        {"pista": "Una palmera y una luna creciente blancas sobre azul", "respuesta": "Carolina del Sur", "tambien_vale": ["South Carolina"]},
    ],
}


def errores(*finales, banco=None):
    inf = Informe()
    vf.validar_finales(list(finales), inf, banco)
    return inf.errores, inf.avisos


def con(base, **cambios):
    f = copy.deepcopy(base)
    f.update(cambios)
    return f


class TestValidarFinales(unittest.TestCase):
    def test_validas(self):
        self.assertEqual(errores(PREGUNTA, CALCULO, RETO), ([], []))

    def test_campos_obligatorios(self):
        casos = {
            "id": con(PREGUNTA, id="final-1"),
            "nivel bajo": con(PREGUNTA, nivel=7),
            "nivel alto": con(PREGUNTA, nivel=11),
            "tipo": con(PREGUNTA, tipo="ronda"),
            "fuente": con(PREGUNTA, fuente=""),
            "v": con(PREGUNTA, v=0),
            "interrogación": con(PREGUNTA, pregunta="Qué elemento se descubrió en el Sol"),
            "respuesta": con(PREGUNTA, respuesta=""),
            "tambien_vale": con(PREGUNTA, tambien_vale=None),
            "categoría": con(PREGUNTA, categoria="ciencias"),
            "segundos del reto": con(RETO, segundos=None),
            "mínimo": con(RETO, minimo=6),
            "elementos": con(RETO, elementos=RETO["elementos"][:2]),
            "pregunta en un reto": con(RETO, pregunta="¿Qué?"),
        }
        for campo, f in casos.items():
            with self.subTest(campo=campo):
                self.assertTrue(errores(f)[0], f"debería fallar sin «{campo}» válido")

    def test_la_verificacion_se_calcula(self):
        self.assertTrue(any("no coincide" in e for e in errores(con(CALCULO, respuesta="20000"))[0]))
        _, avisos = errores(con(CALCULO, verificacion=None))
        self.assertTrue(any("no «verificacion»" in a for a in avisos), avisos)

    def test_reto_demasiado_facil_avisa(self):
        _, avisos = errores(con(RETO, minimo=2))
        self.assertTrue(any("demasiado fácil" in a for a in avisos), avisos)

    def test_reto_pista_y_variantes(self):
        r = copy.deepcopy(RETO)
        r["elementos"][1]["pista"] = "La bandera de Texas: una estrella solitaria"
        self.assertTrue(any("contiene la respuesta" in e for e in errores(r)[0]))
        r = copy.deepcopy(RETO)
        r["elementos"][4]["tambien_vale"] = ["California"]
        self.assertTrue(any("ya vale para el elemento 1" in e for e in errores(r)[0]))

    def test_variantes_que_solo_cambian_tildes_sobran(self):
        _, avisos = errores(con(PREGUNTA, tambien_vale=["helio", "He"]))
        self.assertTrue(any("«helio»" in a and "sobra" in a for a in avisos), avisos)
        r = copy.deepcopy(RETO)
        r["elementos"][2]["tambien_vale"] = ["Nuevo Mexico"]
        _, avisos = errores(r)
        self.assertTrue(any("elemento 3" in a and "sobra" in a for a in avisos), avisos)

    def test_repetidas_y_parecidas_al_banco(self):
        e, _ = errores(PREGUNTA, con(CALCULO, id=PREGUNTA["id"]))
        self.assertTrue(any("id repetido" in x for x in e))
        e, _ = errores(PREGUNTA, con(PREGUNTA, id="fin-009"))
        self.assertTrue(any("idéntica a fin-001" in x for x in e))
        banco = [{"id": "cie-qui-07", "pregunta": PREGUNTA["pregunta"]}]
        self.assertTrue(any("es la pregunta cie-qui-07" in x for x in errores(PREGUNTA, banco=banco)[0]))
        banco = [{"id": "cie-qui-08", "pregunta": "¿Qué elemento químico se descubrió en el Sol antes que en nuestro planeta?"}]
        _, avisos = errores(PREGUNTA, banco=banco)
        self.assertTrue(any("muy parecida a cie-qui-08" in a for a in avisos), avisos)

    def test_datos_que_ya_salen_en_el_banco_o_en_las_rondas(self):
        # Los tres casos de la revisión del 21 de octubre: una serie del banco, un año en un enunciado y un
        # nombre en una explicación.
        reto = con(RETO, elementos=[
            {"pista": "1, 8, 27, 64…", "respuesta": "125", "tambien_vale": [], "verificacion": "5**3"},
            {"pista": "La batalla de Waterloo", "respuesta": "1815", "tambien_vale": []},
            {"pista": "Freddie Mercury", "respuesta": "Farrokh Bulsara", "tambien_vale": []},
            {"pista": "Un oso pardo sobre la hierba y una estrella roja", "respuesta": "California", "tambien_vale": []},
            {"pista": "Sol rojo de los zia sobre fondo amarillo", "respuesta": "Nuevo México", "tambien_vale": []},
        ])
        banco = [
            {"id": "mat-ser-09", "pregunta": "¿Qué número sigue en la serie 1, 8, 27, 64?", "respuesta": "125", "tambien_vale": []},
            {"id": "geo-his-17", "pregunta": "¿Dónde se libró la batalla de Waterloo, en 1815?", "respuesta": "Waterloo", "tambien_vale": []},
            {"id": "ent-mus-05", "pregunta": "¿Cómo se llamaba el cantante de Queen?", "respuesta": "Freddie Mercury", "tambien_vale": [],
             "explicacion": "Nació en Zanzíbar con el nombre de Farrokh Bulsara."},
            {"id": "his-pai-99", "pregunta": "¿Qué estado de EE. UU. tiene más habitantes?", "respuesta": "California", "tambien_vale": []},
        ]
        rondas = [{"id": "ron-x", "elementos": [{"pista": "Tiene ocho brazos y tres corazones", "respuesta": "Pulpo", "tambien_vale": []}]}]
        inf = Informe()
        vf.validar_finales([reto], inf, banco, rondas)
        avisos = " | ".join(inf.avisos)
        self.assertIn("ya es una pregunta: mat-ser-09", avisos)
        self.assertIn("«1815» también sale en geo-his-17", avisos)
        self.assertIn("«Farrokh Bulsara» también sale en ent-mus-05", avisos)
        # Una sola palabra que coincide con otra respuesta no es una fuga: no avisa.
        self.assertNotIn("California", avisos)

    def test_huella(self):
        h = vf.huella_final(PREGUNTA)
        self.assertEqual(h, vf.huella_final(con(PREGUNTA, nivel=8, fuente="Otra", explicacion="Otra")))
        self.assertNotEqual(h, vf.huella_final(con(PREGUNTA, respuesta="Litio")))
        hr = vf.huella_final(RETO)
        self.assertEqual(hr, vf.huella_final(con(RETO, titulo="Otro título")))
        self.assertNotEqual(hr, vf.huella_final(con(RETO, minimo=3)), "con otro mínimo, las estadísticas no son comparables")

    def test_archivo_de_control(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "finales.lock.json"
            ruta.write_text(json.dumps({RETO["id"]: {"v": 1, "huella": vf.huella_final(RETO)}}), encoding="utf-8")
            inf = Informe()
            vb.validar_lock([con(RETO, segundos=45)], inf, ruta, vf.huella_final)
            self.assertTrue(any("súbela" in e for e in inf.errores), inf.errores)
            inf = Informe()
            vb.validar_lock([con(RETO, segundos=45, v=2)], inf, ruta, vf.huella_final)
            self.assertEqual(inf.errores, [])

    def test_el_archivo_real_es_valido(self):
        config = vb.cargar_config()
        inf = Informe()
        banco = vb.cargar_banco(config, inf)
        finales = vf.cargar_finales(inf)
        vf.validar_finales(finales, inf, banco)
        self.assertEqual(inf.errores, [])
        for nivel in (8, 9, 10):
            with self.subTest(nivel=nivel):
                self.assertGreaterEqual(sum(1 for f in finales if f["nivel"] == nivel), 15, "la fase 14 pide al menos 15 por nivel")
        self.assertGreaterEqual(sum(1 for f in finales if f["tipo"] == "reto"), 10, "y unos cuantos retos")
        self.assertEqual(config["final"]["archivo"], "data/finales.json")


if __name__ == "__main__":
    unittest.main()
