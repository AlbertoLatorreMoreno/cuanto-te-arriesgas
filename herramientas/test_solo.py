"""Tests del modo solo: validador de opciones y generador del calendario. Uso: py -m unittest discover -s herramientas"""

import copy
import unittest
from datetime import date

import generar_retos as gr
import validar_banco as vb
import validar_opciones as vo
from validar_banco import Informe

PREGUNTA = {"id": "cie-x-01", "v": 1, "categoria": "ciencias", "subtema": "biologia", "nivel": 3,
            "pregunta": "¿Qué órgano fabrica la bilis?", "respuesta": "El hígado", "tambien_vale": ["Hígado"],
            "criterio": "No vale la vesícula biliar: solo la almacena."}
BUENAS = {"v": 1, "incorrectas": ["La vesícula biliar", "El páncreas", "El bazo", "El riñón", "El estómago", "El duodeno", "El apéndice"]}


def validar(p, o):
    inf = Informe()
    vo.validar_entrada(p, o, inf)
    return inf


class TestValidarOpciones(unittest.TestCase):
    def test_unas_opciones_buenas_pasan_sin_avisos(self):
        inf = validar(PREGUNTA, BUENAS)
        self.assertEqual(inf.errores, [])
        self.assertEqual(inf.avisos, [])

    def test_forma(self):
        self.assertTrue(validar(PREGUNTA, {**BUENAS, "incorrectas": BUENAS["incorrectas"][:6]}).errores, "6 incorrectas")
        self.assertTrue(validar(PREGUNTA, {**BUENAS, "v": 2}).errores, "de otra versión")
        repetida = BUENAS["incorrectas"][:6] + ["el pancreas"]
        self.assertTrue(any("repetidas" in e for e in validar(PREGUNTA, {**BUENAS, "incorrectas": repetida}).errores))
        larga = BUENAS["incorrectas"][:6] + ["El " + "muy " * 20 + "largo"]
        self.assertTrue(any("larga" in e for e in validar(PREGUNTA, {**BUENAS, "incorrectas": larga}).errores))
        self.assertTrue(validar(PREGUNTA, {**BUENAS, "incorrectas": BUENAS["incorrectas"][:6] + ["Ninguna de las anteriores"]}).errores)

    def test_una_forma_de_la_respuesta_no_puede_ser_incorrecta(self):
        for mala in ("Hígado", "el higado", "EL HÍGADO"):
            inf = validar(PREGUNTA, {**BUENAS, "incorrectas": BUENAS["incorrectas"][:6] + [mala]})
            self.assertTrue(any("forma de la respuesta" in e for e in inf.errores), mala)

    def test_cifras_iguales_en_otro_formato_y_el_margen_del_criterio(self):
        p = {**PREGUNTA, "respuesta": "2,25", "tambien_vale": [], "criterio": "No vale 1,25.", "verificacion": "1.5*1.5"}
        base = ["1,25", "3", "2,5", "1,5", "4,5", "2", "3,25"]
        self.assertEqual(validar(p, {"v": 1, "incorrectas": base}).errores, [])
        self.assertTrue(validar(p, {"v": 1, "incorrectas": base[:6] + ["2.25"]}).errores, "2.25 es 2,25")
        rango = {**PREGUNTA, "respuesta": "7,26", "tambien_vale": [], "criterio": "Vale entre 7 y 7,3."}
        self.assertTrue(any("margen" in e for e in validar(rango, {"v": 1, "incorrectas": ["5", "6", "7,1", "8", "9", "10", "4"]}).errores))
        # «0 positivo» no es el mismo número que «0 negativo»: son grupos distintos.
        sangre = {**PREGUNTA, "respuesta": "0 negativo", "tambien_vale": []}
        self.assertEqual(validar(sangre, {"v": 1, "incorrectas": ["0 positivo", "A positivo", "A negativo", "B positivo", "B negativo", "AB positivo", "AB negativo"]}).errores, [])

    def test_avisa_si_falta_la_trampa_del_criterio(self):
        sin_trampa = ["El páncreas", "El bazo", "El riñón", "El estómago", "El duodeno", "El apéndice", "El pulmón"]
        self.assertTrue(any("trampa" in a for a in validar(PREGUNTA, {"v": 1, "incorrectas": sin_trampa}).avisos))

    def test_el_banco_real_no_tiene_errores(self):
        inf, cobertura = vo.validar()
        self.assertEqual(inf.errores, [])
        self.assertIn("ciencias", cobertura)


def banco_sintetico(por_celda=6):
    config = vb.cargar_config()
    preguntas = []
    for cat in vb.categorias_del_banco(config):
        for k in range(por_celda):
            for nivel in range(1, 11):
                sub = cat["subtemas"][k % len(cat["subtemas"])]["id"]
                preguntas.append({"id": f"{cat['id']}-{nivel}-{k}", "v": 1, "categoria": cat["id"], "subtema": sub, "nivel": nivel,
                                  "nivel_efectivo": nivel, "pregunta": f"¿Pregunta {k} de {cat['id']} {nivel}?",
                                  "respuesta": f"Respuesta{cat['id']}{nivel}x{k}", "tambien_vale": [], **({"tipo": "mapa"} if cat.get("tipo") == "mapa" else {})})
    return config, preguntas


class TestGenerarRetos(unittest.TestCase):
    def test_calendario_en_orden_sin_repetir_y_temático_los_miércoles_y_domingos(self):
        config, jugables = banco_sintetico()
        inf = Informe()
        cal = gr.ampliar(config, {"dias": []}, jugables, date(2026, 11, 6), date(2026, 11, 25), inf)
        self.assertEqual(inf.errores, [])
        self.assertEqual(len(cal["dias"]), 20)
        por_id = {q["id"]: q for q in jugables}
        todas = [id_ for d in cal["dias"] for id_ in d["preguntas"]]
        self.assertEqual(len(todas), len(set(todas)), "ninguna pregunta se repite")
        for d in cal["dias"]:
            niveles = [por_id[i]["nivel_efectivo"] for i in d["preguntas"]]
            self.assertEqual(niveles, list(range(1, 11)), d["fecha"])
            dia = gr.js_dia_semana(date.fromisoformat(d["fecha"]))
            if dia in config["solo"]["dias_tematicos"]:
                self.assertTrue(d["tema"] and d["titulo"])
                self.assertEqual({por_id[i]["categoria"] for i in d["preguntas"]}, {d["tema"]})
            else:
                cats = [por_id[i]["categoria"] for i in d["preguntas"]]
                self.assertEqual(cats.count("geohistoria"), 1)
                self.assertEqual(cats, d["categorias"])
        temas = [d["tema"] for d in cal["dias"] if d["tema"]]
        self.assertEqual(len(temas), len(set(temas)), "los temas van por turnos")
        comprobacion = Informe()
        gr.comprobar(config, cal, jugables, comprobacion)
        self.assertEqual(comprobacion.errores, [])

    def test_ampliar_no_toca_los_dias_ya_publicados_y_es_reproducible(self):
        config, jugables = banco_sintetico()
        primero = gr.ampliar(config, {"dias": []}, jugables, date(2026, 11, 6), date(2026, 11, 12), Informe())
        ampliado = gr.ampliar(config, copy.deepcopy(primero), jugables, date(2026, 11, 6), date(2026, 11, 20), Informe())
        self.assertEqual(ampliado["dias"][:7], primero["dias"])
        self.assertEqual(len(ampliado["dias"]), 15)
        otra_vez = gr.ampliar(config, {"dias": []}, jugables, date(2026, 11, 6), date(2026, 11, 12), Informe())
        self.assertEqual(otra_vez["dias"], primero["dias"])

    def test_un_tema_sin_preguntas_se_salta_y_el_que_no_llega_corta_el_calendario(self):
        config, jugables = banco_sintetico(por_celda=1)
        inf = Informe()
        cal = gr.ampliar(config, {"dias": []}, jugables, date(2026, 11, 6), date(2027, 2, 1), inf)
        # Agotarse no es un error: el calendario llega hasta donde se puede, y eso se puede escribir.
        self.assertTrue(cal.get("agotado"), "con una pregunta por celda no llega")
        self.assertEqual(inf.errores, [])
        self.assertTrue(any("no quedan preguntas para armar" in a for a in inf.avisos))
        ultimo = cal["dias"][-1]["fecha"]
        self.assertLess(ultimo, "2027-02-01")
        comprobacion = Informe()
        gr.comprobar(config, cal, jugables, comprobacion)
        self.assertEqual(comprobacion.errores, [], "lo que llega es válido")

    def test_no_pone_el_mismo_dia_dos_preguntas_que_se_delatan(self):
        a = {"id": "a", "categoria": "ciencias", "subtema": "x", "pregunta": "¿Quién descubrió la penicilina?", "respuesta": "Alexander Fleming", "tambien_vale": ["Fleming"]}
        b = {"id": "b", "categoria": "ciencias", "subtema": "y", "pregunta": "¿Qué descubrió Fleming en 1928?", "respuesta": "La penicilina", "tambien_vale": []}
        c = {"id": "c", "categoria": "ciencias", "subtema": "z", "pregunta": "¿Qué gas respiramos?", "respuesta": "Oxígeno", "tambien_vale": []}
        self.assertTrue(gr.delata(a, b))
        self.assertFalse(gr.delata(a, c))
        import random
        self.assertEqual(gr.elegir_pregunta([b, c], [a], random.Random(1))["id"], "c")

    def test_el_calendario_real_esta_bien(self):
        config = vb.cargar_config()
        jugables, _, inf = gr.cargar(config)
        cal = gr.leer_calendario()
        gr.comprobar(config, cal, jugables, inf)
        self.assertEqual(inf.errores, [])


if __name__ == "__main__":
    unittest.main()
