"""Tests del generador con un cliente simulado: no llaman a la API ni gastan nada.
Uso: py -m unittest discover -s generador
"""

from __future__ import annotations

import json
import random
import re
import shutil
import tempfile
import unittest
import unittest.mock
from pathlib import Path
from types import SimpleNamespace

import filtro as ft
import generar
import incorporar
import juez
from comun import RAIZ, Proyecto, cobertura, siguiente_id, vb
from llm import BETA_RESPALDO, MODELO, Cortada, ErrorGenerador, Rechazo, llamar_json


# ------------------------------------------------------------------ cliente simulado

def respuesta(datos=None, stop_reason="end_turn", texto=None):
    return SimpleNamespace(
        stop_reason=stop_reason,
        stop_details=SimpleNamespace(category="cyber") if stop_reason == "refusal" else None,
        content=[SimpleNamespace(type="text", text=texto if texto is not None else json.dumps(datos, ensure_ascii=False))],
        usage=SimpleNamespace(iterations=None),
        model=MODELO,
    )


class ClienteFalso:
    """Imita client.beta.messages.create. `generacion(kw)` y `juicio(ids)` deciden qué responde."""

    def __init__(self, generacion=None, juicio=None):
        self.llamadas = []
        self.generacion = generacion or (lambda kw: {"preguntas": []})
        self.juicio = juicio or (lambda ids: {"valoraciones": [valoracion(i) for i in ids]})
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.llamadas.append(kw)
        esquema = kw["output_config"]["format"]["schema"]
        if "valoraciones" in esquema.get("properties", {}):
            ids = re.findall(r"^id: (\S+)$", kw["messages"][0]["content"], flags=re.M)
            return respuesta(self.juicio(ids))
        return respuesta(self.generacion(kw))


def valoracion(id_, exactitud=5, ambiguedad=1, claridad=5, nivel=5, comentario=""):
    return {"id": id_, "exactitud": exactitud, "ambiguedad": ambiguedad, "claridad": claridad, "nivel_estimado": nivel, "comentario": comentario}


def item(pregunta, respuesta_, verificacion="", nivel=5):
    return {"nivel": nivel, "pregunta": pregunta, "respuesta": respuesta_, "tambien_vale": [], "criterio": "", "explicacion": "Dato.",
            "verificacion": verificacion, "nivel_estimado": nivel}


def copia_proyecto() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="arriesga-"))
    shutil.copytree(RAIZ / "app" / "data", tmp / "app" / "data")
    (tmp / "docs").mkdir()
    shutil.copy(RAIZ / "docs" / "rubrica_niveles.md", tmp / "docs")
    (tmp / "generador").mkdir()
    return tmp


# ------------------------------------------------------------------ tests

class TestLlamada(unittest.TestCase):
    def test_parametros_de_la_peticion(self):
        cliente = ClienteFalso()
        llamar_json(cliente, sistema="S", usuario="U", esquema={"type": "object"}, esfuerzo="medium")
        kw = cliente.llamadas[0]
        self.assertEqual(kw["model"], "claude-opus-5-5")
        self.assertEqual(kw["betas"], [BETA_RESPALDO])
        self.assertEqual(kw["fallbacks"], "default")
        self.assertEqual(kw["output_config"]["effort"], "medium")
        self.assertEqual(kw["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(kw["system"][0]["cache_control"], {"type": "ephemeral"})
        self.assertNotIn("thinking", kw, "en Opus 5.5 el pensamiento no se configura: se controla con effort")

    def test_rechazo_y_corte(self):
        for stop, error in (("refusal", Rechazo), ("max_tokens", ErrorGenerador)):
            cliente = ClienteFalso()
            cliente.beta.messages.create = lambda **kw: respuesta({}, stop_reason=stop)
            with self.subTest(stop=stop), self.assertRaises(error):
                llamar_json(cliente, sistema="S", usuario="U", esquema={})

    def test_sdk_antiguo(self):
        cliente = ClienteFalso()

        def antiguo(**kw):
            raise TypeError("create() got an unexpected keyword argument 'fallbacks'")

        cliente.beta.messages.create = antiguo
        with self.assertRaisesRegex(ErrorGenerador, "pip install -U anthropic"):
            llamar_json(cliente, sistema="S", usuario="U", esquema={})

    def test_json_invalido(self):
        cliente = ClienteFalso()
        cliente.beta.messages.create = lambda **kw: respuesta(texto="no es json")
        with self.assertRaises(ErrorGenerador):
            llamar_json(cliente, sistema="S", usuario="U", esquema={})


class TestIdsYArchivos(unittest.TestCase):
    def test_siguiente_id_salta_los_usados_y_los_del_archivo_de_control(self):
        usados = {"mat-cal-01", "mat-cal-20", "mat-cal-07", "mat-geo-30"}
        self.assertEqual(siguiente_id("mates", "calculo", usados), "mat-cal-21")
        self.assertEqual(siguiente_id("mates", "calculo", usados), "mat-cal-22")
        self.assertIn("mat-cal-22", usados)

    def test_reescribir_el_banco_no_cambia_ni_un_byte(self):
        tmp = copia_proyecto()
        p = Proyecto(tmp)
        for cat in p.config["categorias"]:
            original = (RAIZ / "app" / cat["archivo"]).read_text(encoding="utf-8")
            preguntas = json.loads(original)["preguntas"]
            p.guardar_categoria(cat["id"], preguntas)
            self.assertEqual((tmp / "app" / cat["archivo"]).read_text(encoding="utf-8"), original, cat["id"])


class TestFlujo(unittest.TestCase):
    def setUp(self):
        self.tmp = copia_proyecto()
        self.proyecto = Proyecto(self.tmp)
        banco = self.proyecto.banco()
        self.existente = next(p["pregunta"] for p in banco if p["subtema"] == "calculo")

    def generar_con(self, items, juicio=None, celda=("mates", "calculo", 5, 3), generacion=None):
        cliente = ClienteFalso(generacion=generacion or (lambda kw: {"preguntas": items}), juicio=juicio)
        lote = generar.Lote(self.tmp / "generador" / "candidatas" / "lote.json", "umbrales")
        resumen = generar.ejecutar(cliente, self.proyecto, [celda], lote, None)
        return cliente, lote, resumen

    def test_valida_deduplica_juzga_y_filtra(self):
        items = [
            item("¿Cuánto es 6 por 7?", "42", "6*7"),
            item(self.existente, "56", "7*8"),            # duplicada de una existente
            item("¿Cuánto es 9 por 9?", "80", "9*9"),     # la verificación no cuadra
        ]
        cliente, lote, resumen = self.generar_con(items)
        self.assertEqual(resumen, {"pedidas": 3, "aceptadas": 1, "rechazadas": 2})
        aceptada = lote.datos["preguntas"][0]
        self.assertEqual(aceptada["respuesta"], "42")
        self.assertEqual(aceptada["origen"], "generada")
        self.assertEqual(aceptada["nivel"], 5)
        self.assertRegex(aceptada["id"], r"^mat-cal-\d{2,}$")
        self.assertNotIn(aceptada["id"], {p["id"] for p in self.proyecto.banco()})
        self.assertEqual(aceptada["juez"]["exactitud"], 5)
        motivos = " | ".join(r["motivo"] for r in lote.datos["rechazadas"])
        self.assertIn("duplicada", motivos)
        self.assertIn("no coincide con la verificación", motivos)
        # Una llamada de generación y una del juez (solo con la pregunta válida).
        self.assertEqual(len(cliente.llamadas), 2)
        self.assertIn("ya existen en este subtema", cliente.llamadas[0]["messages"][0]["content"])
        self.assertTrue((self.tmp / "generador" / "candidatas" / "lote.json").exists())

    def test_cada_peticion_ve_lo_pedido_antes_y_el_juez_ve_la_explicacion(self):
        # 10 preguntas de un subtema van en dos peticiones (8 + 2): la segunda debe ver las de la primera.
        lotes = iter([
            [item(f"¿Cuánto es {n} por 3?", str(3 * n), f"{n}*3") for n in range(11, 19)],
            [item("¿Cuánto es 19 por 3?", "57", "19*3"), item("¿Cuánto es 21 por 3?", "63", "21*3")],
        ])
        cliente, lote, resumen = self.generar_con(None, celda=("mates", "calculo", 5, 10), generacion=lambda kw: {"preguntas": next(lotes)})
        self.assertEqual(resumen["pedidas"], 10)
        es_juez = lambda c: "valoraciones" in c["output_config"]["format"]["schema"]["properties"]
        generacion = [c["messages"][0]["content"] for c in cliente.llamadas if not es_juez(c)]
        self.assertEqual(len(generacion), 2)
        self.assertIn("Escribe 8 preguntas nuevas", generacion[0])
        self.assertIn("Escribe 2 preguntas nuevas", generacion[1])
        self.assertIn("¿Cuánto es 11 por 3? → 33", generacion[1])
        self.assertNotIn("¿Cuánto es 11 por 3?", generacion[0])
        juicio = next(c["messages"][0]["content"] for c in cliente.llamadas if es_juez(c))
        self.assertIn("explicación: Dato.", juicio)

    def test_si_la_respuesta_se_corta_se_repite_en_trozos_mas_pequenos(self):
        # Simula que el modelo no cabe en el límite si se le piden más de 2 preguntas o se juzgan más de 2.
        cliente = ClienteFalso()
        crear_real = cliente.beta.messages.create
        contador = iter(range(100, 200))

        def crear(**kw):
            texto = kw["messages"][0]["content"]
            es_juez = "valoraciones" in kw["output_config"]["format"]["schema"]["properties"]
            if es_juez:
                if len(re.findall(r"^id: ", texto, flags=re.M)) > 2:
                    cliente.llamadas.append(kw)
                    return respuesta({}, stop_reason="max_tokens")
                return crear_real(**kw)
            n = int(re.search(r"Escribe (\d+) pregunta", texto).group(1))
            if n > 2:
                cliente.llamadas.append(kw)
                return respuesta({}, stop_reason="max_tokens")
            cliente.generacion = lambda kw, n=n: {"preguntas": [item(f"¿Cuánto es {k} más 1000?", str(k + 1000), f"{k}+1000") for k in [next(contador) for _ in range(n)]]}
            return crear_real(**kw)

        cliente.beta.messages.create = crear
        lote = generar.Lote(self.tmp / "generador" / "candidatas" / "lote.json", "umbrales")
        resumen = generar.ejecutar(cliente, self.proyecto, [("mates", "calculo", 5, 5)], lote, None)
        self.assertEqual(resumen["pedidas"], 5, "las 5 preguntas llegan aunque la primera petición se corte")
        self.assertEqual(resumen["aceptadas"], 5, "y el juez las valora todas partiendo sus lotes")

    def test_el_juez_descarta_las_dudosas(self):
        items = [item("¿Cuánto es 6 por 7?", "42", "6*7"), item("¿Cuánto es 11 por 11?", "121", "11*11")]
        juicio = lambda ids: {"valoraciones": [valoracion(ids[0]), valoracion(ids[1], exactitud=2, comentario="dudosa")]}
        _, lote, resumen = self.generar_con(items, juicio)
        self.assertEqual(resumen["aceptadas"], 1)
        self.assertIn("exactitud 2/5", lote.datos["rechazadas"][0]["motivo"])
        self.assertIn("dudosa", lote.datos["rechazadas"][0]["motivo"])

    def test_un_rechazo_del_modelo_salta_la_celda_sin_romper(self):
        cliente = ClienteFalso()
        cliente.beta.messages.create = lambda **kw: respuesta({}, stop_reason="refusal")
        lote = generar.Lote(self.tmp / "generador" / "candidatas" / "lote.json", "umbrales")
        resumen = generar.ejecutar(cliente, self.proyecto, [("ciencias", "quimica", 4, 2)], lote, None)
        self.assertEqual(resumen["pedidas"], 0)

    def test_incorporar_anade_al_banco_y_actualiza_el_control(self):
        antes = len(self.proyecto.banco())
        _, lote, _ = self.generar_con([item("¿Cuánto es 6 por 7?", "42", "6*7")])
        nuevas, problemas = incorporar.incorporar(self.proyecto, lote.datos)
        self.assertEqual(problemas, [])
        self.assertEqual(len(nuevas), 1)
        banco = self.proyecto.banco()
        self.assertEqual(len(banco), antes + 1)
        nueva = next(p for p in banco if p["id"] == nuevas[0]["id"])
        self.assertNotIn("_motivo_filtro", nueva)
        lock = json.loads((self.tmp / "app" / "data" / "preguntas.lock.json").read_text(encoding="utf-8"))
        self.assertEqual(lock[nueva["id"]]["huella"], vb.huella(nueva))
        # Incorporar dos veces el mismo lote falla sin escribir nada.
        _, problemas = incorporar.incorporar(self.proyecto, lote.datos)
        self.assertTrue(any("ya existe" in x for x in problemas))
        self.assertEqual(len(self.proyecto.banco()), antes + 1)

    def test_juez_del_banco_guarda_puntuaciones_sin_cambiar_huellas(self):
        antes = {p["id"]: vb.huella(p) for p in self.proyecto.banco()}
        cliente = ClienteFalso()
        juez.juzgar_banco(cliente, self.proyecto, categoria="mates", limite=12)
        banco = self.proyecto.banco()
        con_juez = [p for p in banco if p.get("juez")]
        self.assertEqual(len(con_juez), 12)
        self.assertEqual(len(cliente.llamadas), 2)  # lotes de 10
        self.assertTrue(all(vb.huella(p) == antes[p["id"]] for p in banco))


class TestAgrupacion(unittest.TestCase):
    def test_agrupar_por_subtema(self):
        celdas = [("mates", "calculo", 3, 1), ("ciencias", "fisica", 2, 2), ("mates", "calculo", 7, 2)]
        self.assertEqual(generar.agrupar(celdas), {("mates", "calculo"): {3: 1, 7: 2}, ("ciencias", "fisica"): {2: 2}})

    def test_trocear_respeta_el_maximo(self):
        trozos = generar.trocear({1: 3, 4: 5, 9: 4}, 5)
        self.assertTrue(all(sum(t.values()) <= 5 for t in trozos))
        total = {}
        for t in trozos:
            for nivel, n in t.items():
                total[nivel] = total.get(nivel, 0) + n
        self.assertEqual(total, {1: 3, 4: 5, 9: 4})
        self.assertEqual(len(trozos), 3)

    def test_varios_niveles_en_una_llamada_y_descarta_lo_no_pedido(self):
        tmp = copia_proyecto()
        proyecto = Proyecto(tmp)
        items = [
            item("¿Cuánto es 6 por 7?", "42", "6*7", nivel=3),
            item("¿Cuánto es 13 por 17?", "221", "13*17", nivel=7),
            item("¿Cuánto es 19 por 23?", "437", "19*23", nivel=7),
            item("¿Cuánto es 3 más 4?", "7", "3+4", nivel=1),  # nivel no pedido
        ]
        cliente = ClienteFalso(generacion=lambda kw: {"preguntas": items})
        lote = generar.Lote(tmp / "generador" / "candidatas" / "lote.json", "umbrales")
        resumen = generar.ejecutar(cliente, proyecto, [("mates", "calculo", 3, 1), ("mates", "calculo", 7, 2)], lote, None)
        self.assertEqual(resumen["pedidas"], 3)
        self.assertEqual(sorted(p["nivel"] for p in lote.datos["preguntas"]), [3, 7, 7])
        # Una sola llamada de generación para los dos niveles y una del juez.
        self.assertEqual(len(cliente.llamadas), 2)
        texto = cliente.llamadas[0]["messages"][0]["content"]
        self.assertIn("nivel 3: 1 pregunta", texto)
        self.assertIn("nivel 7: 2 preguntas", texto)

    def test_ejemplos_de_la_misma_categoria_y_de_otro_subtema(self):
        # Para una pregunta de astronomía no sirven de referencia los acertijos de lógica.
        banco = Proyecto().banco()
        for semilla in range(5):
            ejemplos = generar.ejemplos_de_nivel(banco, {}, 3, ("ciencias", "astronomia"), random.Random(semilla), n=4)
            self.assertEqual(len(ejemplos), 4)
            self.assertTrue(all(e["categoria"] == "ciencias" and e["subtema"] != "astronomia" and e["nivel"] == 3 for e in ejemplos))
        # Si la calibración ha recolocado alguna, va primero.
        otra = next(p for p in banco if p["categoria"] == "ciencias" and p["subtema"] != "astronomia" and p["nivel"] == 4)
        ejemplos = generar.ejemplos_de_nivel(banco, {"niveles": {otra["id"]: 3}}, 3, ("ciencias", "astronomia"), random.Random(0), n=2)
        self.assertEqual(ejemplos[0]["id"], otra["id"])
        # Pero no si el ajuste se calculó para otra versión de la pregunta: vuelve a su nivel inicial.
        ajustes = {"niveles": {otra["id"]: 3}, "versiones": {otra["id"]: otra["v"] + 1}}
        ejemplos = generar.ejemplos_de_nivel(banco, ajustes, 3, ("ciencias", "astronomia"), random.Random(0), n=4)
        self.assertNotIn(otra["id"], [e["id"] for e in ejemplos])

    def test_la_cobertura_no_aplica_ajustes_de_otra_version(self):
        # Una pregunta retirada que se arregla (sube su `v`) vuelve a contar, como en la app.
        p = Proyecto().banco()[0]
        celda = (p["categoria"], p["subtema"], p["nivel"])
        base = Proyecto()
        total = cobertura(base)[celda]
        with unittest.mock.patch.object(Proyecto, "ajustes", lambda self: {"retiradas": {p["id"]: "erronea"}, "versiones": {p["id"]: p["v"]}}):
            self.assertEqual(cobertura(base)[celda], total - 1)
        with unittest.mock.patch.object(Proyecto, "ajustes", lambda self: {"retiradas": {p["id"]: "erronea"}, "versiones": {p["id"]: p["v"] - 1}}):
            self.assertEqual(cobertura(base)[celda], total)


class TestFiltro(unittest.TestCase):
    base = {"nivel": 5, "pregunta": "¿Pregunta de prueba?", "respuesta": "Algo"}

    def test_umbrales(self):
        bien = {**self.base, "juez": valoracion("x")}
        self.assertTrue(ft.evaluar(bien, None)[0])
        for cambio in ({"ambiguedad": 3}, {"claridad": 3}, {"nivel_estimado": 8}):
            p = {**self.base, "juez": {**valoracion("x"), **cambio}}
            with self.subTest(cambio=cambio):
                self.assertFalse(ft.evaluar(p, None)[0])
        self.assertFalse(ft.evaluar({**self.base, "juez": None}, None)[0])

    def test_respuesta_numerica(self):
        casos = {"42": 1, "−273,15 °C": 1, "-4": 1, " 9π": 1, "1/2": 1, "Raíz de 3": 0, "Todos": 0, "Marte": 0}
        for respuesta, esperado in casos.items():
            with self.subTest(respuesta=respuesta):
                self.assertEqual(ft.es_numerica(respuesta), esperado)

    def test_probabilidades_del_caso_guardado(self):
        # Caso guardado (generador/caso_filtro_comun.json): sus probabilidades las calculó la versión en R, ya retirada.
        caso = json.loads((RAIZ / "generador" / "caso_filtro_comun.json").read_text(encoding="utf-8"))
        self.assertEqual(caso["modelo"]["caracteristicas"], ft.CARACTERISTICAS)
        for p in caso["preguntas"]:
            with self.subTest(id=p["id"]):
                self.assertAlmostEqual(ft.prob_mala(p, caso["modelo"]), caso["esperado"][p["id"]], places=9)

    def test_modelo_logistico(self):
        modelo = {"formato": 1, "caracteristicas": ft.CARACTERISTICAS, "intercepto": 0.0,
                  "pesos": [-2.0, 1.0, 0, 0, 0, 0], "medias": [4, 2, 4, 1, 0.6, 0.2], "desviaciones": [1, 1, 1, 1, 0.2, 0.4], "umbral": 0.5}
        buena = {**self.base, "juez": valoracion("x", exactitud=5, ambiguedad=1)}
        mala = {**self.base, "juez": valoracion("x", exactitud=2, ambiguedad=4)}
        self.assertLess(ft.prob_mala(buena, modelo), 0.1)
        self.assertGreater(ft.prob_mala(mala, modelo), 0.9)
        self.assertTrue(ft.evaluar(buena, modelo)[0])
        self.assertFalse(ft.evaluar(mala, modelo)[0])


if __name__ == "__main__":
    unittest.main()
