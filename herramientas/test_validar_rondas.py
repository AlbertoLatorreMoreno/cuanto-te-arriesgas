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
    "elementos": [{"texto": n, "tambien_vale": [], "nivel": nivel} for n, nivel in
                  (("Pedro", 1), ("Andrés", 6), ("Santiago el Mayor", 5), ("Juan", 3), ("Felipe", 7), ("Bartolomé", 8), ("Tomás", 5),
                   ("Mateo", 4), ("Santiago el Menor", 10), ("Judas Tadeo", 9), ("Simón el Zelote", 9), ("Judas Iscariote", 2))],
}
RAFAGA = {
    "id": "ron-banderas", "v": 1, "tipo": "rafaga", "titulo": "Banderas", "enunciado": "¿De qué país es cada bandera?",
    "segundos": 50, "nota": None, "fuente": "Banderas oficiales",
    "elementos": [
        {"pista": "Roja con una cruz blanca de brazos iguales en el centro", "respuesta": "Suiza", "tambien_vale": [], "nivel": 1},
        {"pista": "Blanca con un círculo rojo en el centro", "respuesta": "Japón", "tambien_vale": [], "nivel": 1},
        {"pista": "Tres franjas verticales: verde, blanca y roja", "respuesta": "Italia", "tambien_vale": [], "nivel": 2},
        {"pista": "Tres franjas verticales: azul, blanca y roja", "respuesta": "Francia", "tambien_vale": [], "nivel": 3},
        {"pista": "Roja con una cruz blanca desplazada hacia el asta", "respuesta": "Dinamarca", "tambien_vale": [], "nivel": 3},
        {"pista": "Tres franjas horizontales: negra, roja y amarilla", "respuesta": "Alemania", "tambien_vale": [], "nivel": 4},
    ],
}
# El primero se da colocado; los demás, cada vez más juntos.
ORDENAR = {
    "id": "ron-montanas", "v": 1, "tipo": "ordenar", "titulo": "Montañas", "orden": "desc",
    "enunciado": "Ordena montañas por su altura. Al primer fallo, se acaba.", "segundos": 60, "nota": None, "fuente": "IGN",
    "elementos": [{"texto": t, "valor": v, "etiqueta": f"{v} m", **({"nivel": n} if n else {})} for t, v, n in
                  (("Teide", 3715, None), ("Everest", 8849, 1), ("Mont Blanc", 4806, 1), ("K2", 8611, 2), ("Aneto", 3404, 2),
                   ("Kilimanjaro", 5895, 3), ("Mulhacén", 3479, 3), ("Aconcagua", 6961, 4), ("Elbrus", 5642, 5),
                   ("Cervino", 4478, 6), ("Fuji", 3776, 8), ("Denali", 6190, 10))],
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
        self.assertEqual(errores(LISTA, RAFAGA, ORDENAR), ([], []))

    def test_cada_elemento_lleva_su_nivel(self):
        r = copy.deepcopy(RAFAGA)
        del r["elementos"][2]["nivel"]
        self.assertTrue(any("lleva «nivel»" in e for e in errores(r)[0]))
        r["elementos"][2]["nivel"] = 11
        self.assertTrue(any("lleva «nivel»" in e for e in errores(r)[0]))
        # En una de ordenar, el primero no lo necesita (se da colocado), pero los demás sí.
        r = copy.deepcopy(ORDENAR)
        del r["elementos"][3]["nivel"]
        self.assertTrue(any("(menos el primero)" in e for e in errores(r)[0]))

    def test_las_rafagas_van_de_facil_a_dificil(self):
        r = copy.deepcopy(RAFAGA)
        r["elementos"].reverse()
        self.assertTrue(any("de más fácil a más difícil" in e for e in errores(r)[0]))
        # Una lista se dice en cualquier orden: el suyo da igual.
        r = copy.deepcopy(LISTA)
        r["elementos"].reverse()
        self.assertEqual(errores(r)[0], [])

    def test_llegar_a_k_aciertos_cuesta_como_un_nivel_k(self):
        # Diez fáciles: sacar 8 o 9 sería casi seguro. Es lo que se quería evitar (fase 25).
        r = con(RAFAGA, elementos=[{"pista": f"Descripción {i}", "respuesta": f"País {i}", "tambien_vale": [], "nivel": 2} for i in range(10)])
        e, _ = errores(r)
        self.assertTrue(any("más fácil que acertar una pregunta de nivel k" in x for x in e), e)
        # Todos dificilísimos: no es un error, pero avisa (la ronda da muy pocas casillas).
        r = con(RAFAGA, elementos=[{**e, "nivel": 10} for e in RAFAGA["elementos"]])
        e, avisos = errores(r)
        self.assertEqual(e, [])
        self.assertTrue(any("más difícil que acertar una pregunta de nivel k" in a for a in avisos), avisos)
        # Pasar de diez tiene que costar al menos como un nivel 10: una lista de 30 fáciles, no.
        r = con(LISTA, cerrada=False, elementos=[{"texto": f"Héroe {i}", "tambien_vale": [], "nivel": 5} for i in range(30)])
        e, _ = errores(r)
        self.assertTrue(any("11 aciertos" in x for x in e), e)

    def test_la_curva_sigue_al_modelo(self):
        config = vb.cargar_config()
        obj = config["objetivo_acierto"]
        # Una ráfaga con un elemento de cada nivel: sacar 5 es, más o menos, acertar una de nivel 5.
        c = vr.curva(list(range(1, 11)), obj, 1.5)
        self.assertAlmostEqual(vr.nivel_equivalente(c[4], obj), 5, delta=0.3)
        self.assertTrue(all(a > b for a, b in zip(c, c[1:])), "cuantos más aciertos, menos probable")
        # Sin variación entre jugadores y con un solo elemento, la curva es la tabla.
        self.assertAlmostEqual(vr.curva([7], obj, 1e-9)[0], obj[6], places=6)
        # La escalera se para al primer fallo: con dos elementos, el segundo exige los dos.
        p = vr.curva([3, 3], obj, 1e-9, escalera=True)
        self.assertAlmostEqual(p[1], obj[2] ** 2, places=6)
        self.assertAlmostEqual(vr.nivel_equivalente(obj[3], obj), 4)

    def test_ordenar(self):
        casos = {
            "orden": con(ORDENAR, orden="arriba"),
            "valor": con(ORDENAR, elementos=[{**ORDENAR["elementos"][0], "valor": "alto"}, *ORDENAR["elementos"][1:]]),
            "etiqueta": con(ORDENAR, elementos=[{**ORDENAR["elementos"][0], "etiqueta": ""}, *ORDENAR["elementos"][1:]]),
            "mismo valor": con(ORDENAR, elementos=[*ORDENAR["elementos"][:-1], {**ORDENAR["elementos"][-1], "valor": 3715}]),
            "repetido": con(ORDENAR, elementos=[*ORDENAR["elementos"][:-1], {**ORDENAR["elementos"][-1], "texto": "Teide"}]),
            "pista": con(ORDENAR, elementos=[{**ORDENAR["elementos"][0], "pista": "Volcán"}, *ORDENAR["elementos"][1:]]),
            "pocos": con(ORDENAR, elementos=ORDENAR["elementos"][:5]),
        }
        for caso, r in casos.items():
            with self.subTest(caso=caso):
                self.assertTrue(errores(r)[0], f"debería fallar: {caso}")
        self.assertTrue(errores(con(LISTA, orden="asc"))[0], "«orden» solo va en las de ordenar")
        self.assertTrue(errores(con(ORDENAR, cerrada=True))[0], "«cerrada» solo va en las listas")

    def test_la_huella_no_cuenta_los_niveles(self):
        r = copy.deepcopy(RAFAGA)
        r["elementos"][0]["nivel"] = 2
        self.assertEqual(vr.huella_ronda(r), vr.huella_ronda(RAFAGA), "creer otra cosa de un elemento no cambia la ronda")
        self.assertNotEqual(vr.huella_ronda(ORDENAR), vr.huella_ronda(con(ORDENAR, orden="asc")))

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
        self.assertEqual(tipos, {"lista", "rafaga", "ordenar"})
        # Fase 25: de media, una ronda da lo que sumaría una pregunta de cada nivel acertada con la tabla.
        config = vb.cargar_config()
        medias = [sum(vr.curva_de_ronda(r, config)) for r in rondas]
        self.assertLess(sum(medias) / len(medias), 5.5)


if __name__ == "__main__":
    unittest.main()
