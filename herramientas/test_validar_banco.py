"""Tests del validador. Uso: py -m unittest discover -s herramientas"""

import math
import unittest

import json
import tempfile
from pathlib import Path
from unittest import mock

import validar_banco as vb
from validar_banco import Informe, cargar_config, evaluar, valor_respuesta, validar_pregunta


class TestValorRespuesta(unittest.TestCase):
    def test_formatos(self):
        casos = {
            "36": 36, "2,5": 2.5, "-4": -4, "1/36": 1 / 36, "9π": 9 * math.pi, "9 π": 9 * math.pi,
            "π/2": math.pi / 2, "2π/3": 2 * math.pi / 3, "10 000": 10000, "1.000.000": 1e6,
            "25 %": 25, "12 cm²": 12, "Raíz de 3": math.sqrt(3), "2√2": 2 * math.sqrt(2), "0,05 euros": 0.05, "13 983 816": 13983816, "180 grados": 180, "3,14": 3.14, "45 cm": 45, "1/2 de probabilidad": 0.5,
        }
        for texto, esperado in casos.items():
            with self.subTest(texto=texto):
                self.assertTrue(math.isclose(valor_respuesta(texto), esperado), f"{texto} → {valor_respuesta(texto)}")

    def test_no_numericas(self):
        for texto in ("Marte", "ninguno", ""):
            self.assertIsNone(valor_respuesta(texto))


class TestEvaluar(unittest.TestCase):
    def test_expresiones_validas(self):
        self.assertEqual(evaluar("17*23"), 391)
        self.assertEqual(evaluar("comb(5, 2)"), 10)
        self.assertEqual(evaluar("Fraction(1, 6) * Fraction(1, 6)"), Fraction_1_36())
        self.assertEqual(evaluar("sum(x for x in range(1, 11))"), 55)

    def test_calculos_desmesurados_se_rechazan_enseguida(self):
        import time
        for expr in ("9**9**9", "2**100000", "factorial(10**7)", "comb(10**6, 5*10**5)", "sum(range(10**10))",
                     "sum(1 for a in range(10**4) for b in range(10**4))", "len([0]*10**9)",
                     # Se saltaban los límites (revisión del 21 de octubre): potencia de una fracción y sum con listas.
                     "Fraction(10**9999)**10000", "Fraction(1, 10**9999)**10000", "sum([[0]*1000]*3000, [])"):
            with self.subTest(expr=expr):
                inicio = time.perf_counter()
                with self.assertRaises(ValueError):
                    evaluar(expr)
                self.assertLess(time.perf_counter() - inicio, 2)
        # Lo que usa el banco sigue funcionando.
        self.assertEqual(evaluar("2**100 % 7"), 2)
        self.assertEqual(evaluar("sum(1 for k in range(1, 20) if factorial(25) % 10**k == 0)"), 6)
        self.assertEqual(evaluar("comb(49, 6)"), 13983816)
        self.assertEqual(evaluar("(5/6)**4"), (5 / 6) ** 4)
        self.assertEqual(evaluar("Fraction(1, 2)**3"), 0.125)
        self.assertEqual(evaluar("sum(n/2**n for n in range(1, 200))"), sum(n / 2**n for n in range(1, 200)))

    def test_expresiones_peligrosas(self):
        for expr in ("__import__('os')", "open('x')", "(1).__class__", "[x for x in ().__class__.__bases__]"):
            with self.subTest(expr=expr), self.assertRaises(Exception):
                evaluar(expr)


def Fraction_1_36():
    from fractions import Fraction
    return Fraction(1, 36)


class TestValidarPregunta(unittest.TestCase):
    def setUp(self):
        self.config = cargar_config()

    def base(self, **cambios):
        p = {
            "id": "mat-cal-01", "v": 1, "categoria": "mates", "subtema": "calculo", "nivel": 2,
            "pregunta": "¿Cuánto es 7 por 8?", "respuesta": "56", "tambien_vale": [],
            "criterio": None, "explicacion": None, "verificacion": "7*8", "origen": "semilla",
            "_archivo": "mates.json",
        }
        p.update(cambios)
        return p

    def errores(self, p):
        inf = Informe()
        validar_pregunta(p, self.config, inf)
        return inf.errores

    def test_correcta(self):
        self.assertEqual(self.errores(self.base()), [])

    def test_respuesta_que_no_cuadra(self):
        errores = self.errores(self.base(respuesta="54"))
        self.assertTrue(any("no coincide" in e for e in errores))
        self.assertFalse(any("coma" in e for e in errores))

    def test_decimal_con_punto_da_una_pista(self):
        errores = self.errores(self.base(pregunta="¿Cuánto es 5 entre 2?", respuesta="2.5", verificacion="5/2"))
        self.assertTrue(any("van con coma" in e for e in errores))
        self.assertEqual(self.errores(self.base(pregunta="¿Cuánto es 5 entre 2?", respuesta="2,5", verificacion="5/2")), [])

    def test_falta_verificacion(self):
        self.assertTrue(any("verificacion" in e for e in self.errores(self.base(verificacion=None))))

    def test_id_y_signos(self):
        errores = self.errores(self.base(id="mat-geo-01", pregunta="Cuánto es 7 por 8"))
        self.assertTrue(any("id" in e for e in errores))
        self.assertTrue(any("«¿»" in e for e in errores))

    def test_pregunta_de_un_tema(self):
        tema = {"id": "har-pel-01", "categoria": "harry_potter", "subtema": "peliculas", "pregunta": "¿Qué actor interpretó a Severus Snape?",
                "respuesta": "Alan Rickman", "verificacion": None, "_archivo": "harry_potter.json"}
        self.assertEqual(self.errores(self.base(**tema)), [])
        self.assertTrue(any("id" in e for e in self.errores(self.base(**{**tema, "id": "hp-pel-01"}))))
        self.assertTrue(any("subtema desconocido" in e for e in self.errores(self.base(**{**tema, "subtema": "actores"}))))


class TestCoberturaDeTemas(unittest.TestCase):
    """Los temas tienen una pregunta por casilla a propósito; las categorías del tablero, al menos --min-celda."""

    def test_una_por_casilla_basta_en_un_tema_pero_no_en_el_tablero(self):
        config = cargar_config()
        tema = config["temas"]["lista"][0]
        preguntas = [{"categoria": tema["id"], "subtema": s["id"], "nivel": n} for s in tema["subtemas"] for n in range(1, 11)]
        preguntas += [{"categoria": "ciencias", "subtema": "fisica", "nivel": n} for n in range(1, 11)]
        matriz = vb.matriz_cobertura(preguntas, config)
        self.assertTrue(all(k == 1 for s in tema["subtemas"] for k in matriz[(tema["id"], s["id"])].values()))
        self.assertGreaterEqual(1, vb.MIN_CELDA_TEMA)
        self.assertTrue(all(k < 2 for k in matriz[("ciencias", "fisica")].values()))


class TestControlDeVersiones(unittest.TestCase):
    """El archivo de control detecta textos cambiados sin subir la versión."""

    def comprobar(self, lock: dict, preguntas: list[dict]) -> list[str]:
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "preguntas.lock.json"
            ruta.write_text(json.dumps(lock), encoding="utf-8")
            with mock.patch.object(vb, "LOCK", ruta):
                inf = Informe()
                vb.validar_lock(preguntas, inf)
                return inf.errores

    def pregunta(self, **cambios):
        p = {"id": "cie-bio-01", "v": 1, "pregunta": "¿A?", "respuesta": "B", "tambien_vale": [], "criterio": None}
        p.update(cambios)
        return p

    def test_sin_cambios(self):
        p = self.pregunta()
        self.assertEqual(self.comprobar({p["id"]: {"v": 1, "huella": vb.huella(p)}}, [p]), [])

    def test_texto_cambiado_sin_subir_version(self):
        original = self.pregunta()
        lock = {original["id"]: {"v": 1, "huella": vb.huella(original)}}
        errores = self.comprobar(lock, [self.pregunta(respuesta="C")])
        self.assertTrue(any("súbela" in e for e in errores))

    def test_texto_cambiado_subiendo_version(self):
        original = self.pregunta()
        lock = {original["id"]: {"v": 1, "huella": vb.huella(original)}}
        self.assertEqual(self.comprobar(lock, [self.pregunta(respuesta="C", v=2)]), [])

    def test_explicacion_no_cuenta(self):
        original = self.pregunta()
        lock = {original["id"]: {"v": 1, "huella": vb.huella(original)}}
        self.assertEqual(self.comprobar(lock, [self.pregunta(explicacion="Otra")]), [])

    def test_una_borrada_conserva_su_id_para_no_reutilizarlo(self):
        # Si --actualizar la quitara del control, el generador podría dar su id a otra pregunta
        # y R mezclaría los datos de las dos.
        borrada = self.pregunta(id="cie-bio-02", pregunta="¿Otra?")
        lock = {"cie-bio-02": {"v": 1, "huella": vb.huella(borrada)}}
        p = self.pregunta()
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "preguntas.lock.json"
            ruta.write_text(json.dumps(lock), encoding="utf-8")
            with mock.patch.object(vb, "LOCK", ruta):
                inf = Informe()
                nuevo = vb.validar_lock([p], inf)
                self.assertEqual(nuevo["cie-bio-02"], {"v": 1, "huella": vb.huella(borrada), "eliminada": True})
                self.assertEqual(len(inf.avisos), 1)
                # Una vez apuntada como eliminada, ya no avisa cada vez.
                ruta.write_text(json.dumps(nuevo), encoding="utf-8")
                inf = Informe()
                vb.validar_lock([p], inf)
                self.assertEqual(inf.avisos, [])
                # Si vuelve con otro texto y la misma versión, hay que subirla.
                inf = Informe()
                vb.validar_lock([p, self.pregunta(id="cie-bio-02", pregunta="¿Distinta?")], inf)
                self.assertTrue(any("súbela" in e for e in inf.errores))

    def test_version_que_baja(self):
        p = self.pregunta()
        errores = self.comprobar({p["id"]: {"v": 3, "huella": vb.huella(p)}}, [p])
        self.assertTrue(any("ha bajado" in e for e in errores))


if __name__ == "__main__":
    unittest.main()
