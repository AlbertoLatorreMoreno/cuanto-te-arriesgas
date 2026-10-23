"""Tests del validador de rondas. Uso: py -m unittest discover -s herramientas"""

import copy
import json
import tempfile
import unittest
from pathlib import Path

import validar_banco as vb
import validar_rondas as vr
from validar_banco import Informe

LISTA = {
    "id": "ron-apostoles", "v": 1, "tipo": "lista", "titulo": "Los doce apóstoles",
    "enunciado": "Nombra a los doce apóstoles de Jesús.", "segundos": 45, "cerrada": True, "nota": None,
    "fuente": "Mateo 10, 2-4",
    "elementos": [{"texto": n, "tambien_vale": []} for n in
                  ("Pedro", "Andrés", "Santiago el Mayor", "Juan", "Felipe", "Bartolomé", "Tomás", "Mateo",
                   "Santiago el Menor", "Judas Tadeo", "Simón el Zelote", "Judas Iscariote")],
}
RAFAGA = {
    "id": "ron-banderas", "v": 1, "tipo": "rafaga", "titulo": "Banderas", "enunciado": "¿De qué país es cada bandera?",
    "segundos": 50, "nota": None, "fuente": "Banderas oficiales",
    "elementos": [
        {"pista": "Roja con una cruz blanca de brazos iguales en el centro", "respuesta": "Suiza", "tambien_vale": []},
        {"pista": "Blanca con un círculo rojo en el centro", "respuesta": "Japón", "tambien_vale": []},
        {"pista": "Tres franjas verticales: verde, blanca y roja", "respuesta": "Italia", "tambien_vale": []},
        {"pista": "Tres franjas verticales: azul, blanca y roja", "respuesta": "Francia", "tambien_vale": []},
        {"pista": "Roja con una cruz blanca desplazada hacia el asta", "respuesta": "Dinamarca", "tambien_vale": []},
        {"pista": "Tres franjas horizontales: negra, roja y amarilla", "respuesta": "Alemania", "tambien_vale": []},
    ],
}


def errores(*rondas):
    inf = Informe()
    vr.validar_rondas(list(rondas), inf)
    return inf.errores, inf.avisos


def con(base, **cambios):
    r = copy.deepcopy(base)
    r.update(cambios)
    return r


class TestValidarRondas(unittest.TestCase):
    def test_validas(self):
        self.assertEqual(errores(LISTA, RAFAGA), ([], []))

    def test_campos_obligatorios_y_tipos(self):
        casos = {
            "id": con(LISTA, id="apostoles"),
            "tipo": con(LISTA, tipo="trivial"),
            "fuente": con(LISTA, fuente=""),
            "segundos": con(LISTA, segundos=500),
            "cerrada": con(LISTA, cerrada=None),
            "v": con(LISTA, v=0),
        }
        for campo, r in casos.items():
            with self.subTest(campo=campo):
                self.assertTrue(errores(r)[0], f"debería fallar sin «{campo}» válido")
        self.assertTrue(errores(con(RAFAGA, cerrada=True))[0], "«cerrada» no va en las ráfagas")

    def test_numero_de_elementos(self):
        self.assertTrue(errores(con(LISTA, elementos=LISTA["elementos"][:4]))[0])
        self.assertTrue(errores(con(RAFAGA, elementos=RAFAGA["elementos"] * 3))[0])

    def test_una_variante_solo_vale_para_un_elemento(self):
        r = copy.deepcopy(LISTA)
        r["elementos"][9]["tambien_vale"] = ["Tadeo", "Judas"]
        r["elementos"][11]["tambien_vale"] = ["Judas"]  # ¿cuál de los dos Judas?
        e, _ = errores(r)
        self.assertTrue(any("«Judas» ya vale para el elemento 10" in x for x in e), e)
        r = copy.deepcopy(RAFAGA)
        r["elementos"][1]["respuesta"] = "Suiza"
        self.assertTrue(errores(r)[0], "dos descripciones con la misma respuesta")

    def test_la_pista_no_puede_contener_la_respuesta(self):
        r = copy.deepcopy(RAFAGA)
        r["elementos"][0]["pista"] = "La bandera de Suiza: roja con una cruz blanca"
        e, _ = errores(r)
        self.assertTrue(any("contiene la respuesta" in x for x in e), e)

    def test_formulas_de_las_rafagas_de_calculo(self):
        r = copy.deepcopy(RAFAGA)
        r["elementos"][0].update(pista="Siete por ocho", respuesta="56", verificacion="7*8")
        self.assertEqual(errores(r)[0], [])
        r["elementos"][0]["respuesta"] = "54"
        self.assertTrue(any("da 56" in e for e in errores(r)[0]))
        r["elementos"][0].update(respuesta="56", verificacion="__import__('os')")
        self.assertTrue(any("no se puede calcular" in e for e in errores(r)[0]))
        # Un número que aparece en la pista delata la respuesta, aunque sea corto.
        r["elementos"][0].update(pista="Noventa y seis entre 12", respuesta="8", verificacion="96/12")
        self.assertFalse(any("contiene la respuesta" in e for e in errores(r)[0]))
        r["elementos"][0].update(pista="Ciento cuarenta y cuatro entre 12", respuesta="12", verificacion="144/12")
        self.assertTrue(any("contiene la respuesta" in e for e in errores(r)[0]))

    def test_tiempo_por_elemento_raro_avisa(self):
        _, avisos = errores(con(LISTA, segundos=180))
        self.assertTrue(any("demasiado fácil o imposible" in a for a in avisos))
        _, avisos = errores(con(LISTA, segundos=10))
        self.assertTrue(any("demasiado fácil o imposible" in a for a in avisos))

    def test_ids_repetidos(self):
        e, _ = errores(LISTA, con(RAFAGA, id=LISTA["id"]))
        self.assertTrue(any("id repetido" in x for x in e))

    def test_huella_cambia_con_el_contenido_y_no_con_el_titulo(self):
        h = vr.huella_ronda(LISTA)
        self.assertEqual(h, vr.huella_ronda(con(LISTA, titulo="Otro título", fuente="Otra fuente", nota="Una nota")))
        self.assertNotEqual(h, vr.huella_ronda(con(LISTA, segundos=40)), "con otro tiempo, las estadísticas no son comparables")
        r = copy.deepcopy(LISTA)
        r["elementos"][0]["tambien_vale"] = ["Simón Pedro"]
        self.assertNotEqual(h, vr.huella_ronda(r))

    def test_archivo_de_control(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "rondas.lock.json"
            ruta.write_text(json.dumps({LISTA["id"]: {"v": 1, "huella": vr.huella_ronda(LISTA)}}), encoding="utf-8")
            inf = Informe()
            vb.validar_lock([con(LISTA, segundos=40)], inf, ruta, vr.huella_ronda)
            self.assertTrue(any("súbela" in e for e in inf.errores), inf.errores)
            inf = Informe()
            vb.validar_lock([con(LISTA, segundos=40, v=2)], inf, ruta, vr.huella_ronda)
            self.assertEqual(inf.errores, [])

    def test_el_archivo_real_es_valido(self):
        inf = Informe()
        rondas = vr.cargar_rondas(inf)
        vr.validar_rondas(rondas, inf)
        self.assertEqual(inf.errores, [])
        self.assertGreaterEqual(len(rondas), 30, "la fase 11 pide al menos 30 rondas")
        tipos = {r["tipo"] for r in rondas}
        self.assertEqual(tipos, {"lista", "rafaga"})


if __name__ == "__main__":
    unittest.main()
