"""Tests del generador del banco con Codex (banco_codex.py), con un Codex simulado: ninguno llama a Codex ni toca
herramientas/banco_lotes ni app/data. Uso: py -m unittest discover -s herramientas"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import banco_codex as bc
import validar_banco as vb
import validar_opciones as vo

TEMA = {"id": "tema_prueba", "nombre": "Tema de prueba", "corto": "Prueba", "publico": "nicho", "referencia": "fan", "por_que": "",
        "riesgo": "", "aprobado": True,
        "subtemas": [{"id": s, "nombre": f"Subtema {s}", "rincones": [f"rincón {s} {i}" for i in range(8)]} for s in ("uno", "dos", "tres", "cuatro")]}

GENERADAS = [
    {"nivel": 1, "pregunta": "¿Qué animal es Blinky, la mascota de la prueba?", "respuesta": "Un tejón", "tambien_vale": ["Tejón"],
     "criterio": "", "explicacion": "Se eligió por votación.", "rincon": "mascotas", "boton": "",
     "incorrectas": ["Un zorro", "Un hurón", "Un mapache", "Un castor", "Un erizo", "Un lirón", "Un topo"]},
    {"nivel": 2, "pregunta": "¿En qué año se fundó el club imaginario Rayo Tembleque?", "respuesta": "1987", "tambien_vale": [],
     "criterio": "", "explicacion": "Lo fundaron unos vecinos.", "rincon": "clubes", "boton": "",
     "incorrectas": ["1977", "1981", "1984", "1986", "1989", "1992", "1995"]},
    {"nivel": 3, "pregunta": "¿Qué instrumento toca la capitana Mirlo en la orquesta inventada?", "respuesta": "El fagot",
     "tambien_vale": ["Fagot"], "criterio": "", "explicacion": "Aprendió de niña.", "rincon": "orquesta", "boton": "",
     "incorrectas": ["El oboe", "El clarinete", "La flauta", "El corno inglés", "La tuba", "El fagot", "La viola"]},
]
REVISION = {
    "revisiones": [{"n": 1, "propia": "Tejón", "veredicto": "ok", "nivel": 1, "notas": [5, 1, 5]},
                   {"n": 2, "propia": "1987", "veredicto": "descartar", "nivel": 2, "notas": [2, 1, 5]},
                   {"n": 3, "propia": "Fagot", "veredicto": "ok", "nivel": 3, "notas": [5, 1, 5]},
                   {"n": 9, "propia": "", "veredicto": "ok", "nivel": 3, "notas": [5, 1, 5]}],
    "detalles": [{"n": 1, "motivo": "", "tambien_vale_anadir": ["El tejón"], "pregunta": "", "respuesta": "", "criterio": "", "explicacion": "",
                  "opciones_mal": ["un zorro"], "opciones_nuevas": ["Una nutria"]},
                 {"n": 2, "motivo": "El año es dudoso.", "tambien_vale_anadir": [], "pregunta": "", "respuesta": "", "criterio": "",
                  "explicacion": "", "opciones_mal": [], "opciones_nuevas": []}],
}


class ConLotesDePrueba(unittest.TestCase):
    """Todo lo que escribe el generador va a una carpeta temporal, con un tema propuesto y aprobado."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        (self.tmp / "banco_temas.json").write_text(json.dumps({"temas": [TEMA]}, ensure_ascii=False), encoding="utf-8")
        for nombre, valor in (("LOTES", self.tmp / "lotes"), ("TEMAS_PROPUESTOS", self.tmp / "banco_temas.json"), ("avisar", lambda texto: None)):
            parche = mock.patch.object(bc, nombre, valor)
            parche.start()
            self.addCleanup(parche.stop)
        self.ctx = bc.Contexto()


class TestMensajes(ConLotesDePrueba):
    def estado(self, cat, sub):
        return {**bc.cargar_estado(cat, sub), "rondas": 1}

    def test_cada_mensaje_lleva_solo_sus_secciones(self):
        mates = bc.prompt_generar(self.ctx, "mates", "calculo", {1: 2}, self.estado("mates", "calculo"))
        mapa = bc.prompt_generar(self.ctx, "geohistoria", "lugares", {1: 2}, self.estado("geohistoria", "lugares"))
        texto = bc.prompt_generar(self.ctx, "ciencias", "astronomia", {1: 2}, self.estado("ciencias", "astronomia"))
        for prompt, esta, no_esta in ((mates, ["## Mates y lógica", "## Las opciones del modo solo", "En **Mates y lógica**", "siempre en cifras"],
                                       ["## Localízalo", "En **Localízalo**", "En los **temas**"]),
                                      (mapa, ["## Localízalo", "En **Localízalo**"], ["## Mates y lógica", "## Las opciones del modo solo", "En **Mates"]),
                                      (texto, ["## Las opciones del modo solo", "## Cómo trabajar"], ["## Mates y lógica", "## Localízalo", "En **Mates"])):
            for trozo in esta:
                self.assertIn(trozo, prompt)
            for trozo in [*no_esta, "## Normas de redacción", "<!-- seccion"]:
                self.assertNotIn(trozo, prompt)

    def test_el_redactor_recibe_respuestas_ya_usadas_y_no_preguntas(self):
        prompt = bc.prompt_generar(self.ctx, "ciencias", "astronomia", {1: 2}, self.estado("ciencias", "astronomia"))
        del_subtema = [p for p in self.ctx.banco if p["categoria"] == "ciencias" and p["subtema"] == "astronomia"]
        lote = prompt.split("# Este lote")[1]
        self.assertIn("Respuestas ya usadas", lote)
        self.assertFalse([p["id"] for p in del_subtema if p["pregunta"] in lote], "van preguntas enteras del subtema")
        self.assertEqual(bc.ya_usadas(self.ctx, "mates", "calculo"), [], "en mates las respuestas son números: no hay lista")
        sitios = bc.ya_usadas(self.ctx, "geohistoria", "espana")
        de_fuera = next(p for p in self.ctx.banco if p["categoria"] == "geohistoria" and p["subtema"] != "espana")
        self.assertIn(bc.nombre_del_sitio(de_fuera["respuesta"]).strip(), sitios, "en el mapa, los sitios de toda la categoría, sin el país")
        self.assertLess(len(prompt), 16000, "el mensaje del redactor ha engordado (antes del 10-11-2026 eran 29 000 de media)")

    def test_el_revisor_no_ve_la_respuesta_en_mates_ni_las_opciones(self):
        q = {**GENERADAS[1], "_clave": "x", "pregunta": "¿Cuánto es 3 por 7?", "respuesta": "21"}
        mates = bc.prompt_auditar(self.ctx, "mates", "calculo", [q]).split("# Este lote")[1]
        self.assertNotIn("Respuesta:", mates)
        self.assertNotIn("1977", mates)
        self.assertFalse(bc.con_opciones("mates", [q]))
        texto = bc.prompt_auditar(self.ctx, "ciencias", "astronomia", [q])
        self.assertIn("Opciones incorrectas: 1977 | 1981", texto)
        self.assertIn("## Las opciones del modo solo", texto)

    def test_las_lecciones_del_revisor_llegan_al_redactor(self):
        st = self.estado("ciencias", "astronomia")
        for i in range(bc.MAX_LECCIONES + 3):
            bc.leccion(st, {"pregunta": f"¿Pregunta {i}?", "respuesta": "x"}, f"auditor: motivo {i}")
        self.assertEqual(len(st["lecciones"]), bc.MAX_LECCIONES)
        prompt = bc.prompt_generar(self.ctx, "ciencias", "astronomia", {1: 2}, st)
        self.assertIn(f"motivo {bc.MAX_LECCIONES + 2}", prompt)
        self.assertNotIn("motivo 0", prompt)

    def test_los_esquemas_son_estrictos_y_solo_con_los_campos_del_lote(self):
        def objetos(e):
            if isinstance(e, dict):
                if e.get("type") == "object":
                    yield e
                for v in e.values():
                    yield from objetos(v)
        for esquema in (bc.esquema_generacion(False, True, True), bc.esquema_generacion(True), bc.esquema_auditoria(True), bc.esquema_auditoria(False, True),
                        bc.esquema_temas()):
            for o in objetos(esquema):
                self.assertEqual(o["required"], list(o["properties"]))
                self.assertIs(o["additionalProperties"], False)
        campos = lambda e: set(e["properties"]["preguntas"]["items"]["properties"])  # noqa: E731
        self.assertLessEqual({"verificacion", "incorrectas", "rincon"}, campos(bc.esquema_generacion(False, True, True)))
        self.assertFalse({"verificacion", "lat", "rincon"} & campos(bc.esquema_generacion(False, False, False)))
        self.assertFalse({"incorrectas", "boton", "verificacion"} & campos(bc.esquema_generacion(True)))
        self.assertNotIn("opciones_mal", bc.esquema_auditoria(False)["properties"]["detalles"]["items"]["properties"])


class TestPiezas(ConLotesDePrueba):
    def test_tokens_de_una_llamada(self):
        eventos = '{"type":"turn.started"}\n{"type":"turn.completed","usage":{"input_tokens":16244,"cached_input_tokens":13696,"output_tokens":905,"reasoning_output_tokens":700}}\n'
        self.assertEqual(bc.uso_de(eventos), {"entrada": 16244, "cache": 13696, "salida": 905, "razonamiento": 700, "gasto": 16244 - 13696 + 905})
        self.assertIsNone(bc.uso_de("sin eventos"))

    def test_mates_con_los_numeros_en_cifras(self):
        q = {"_clave": "x", "nivel": 2, "pregunta": "Lanzas tres dados de parchís. ¿Cuánto suman como máximo sus caras?", "respuesta": "18",
             "tambien_vale": [], "explicacion": "Son 6 puntos por dado.", "verificacion": "6 * 3"}
        self.assertIn("en cifras", bc.comprobar(self.ctx, "mates", "calculo", q))
        q["pregunta"] = "Lanzas 3 dados de parchís. ¿Cuánto suman como máximo sus caras?"
        self.assertNotIn("en cifras", str(bc.comprobar(self.ctx, "mates", "calculo", q)))
        for frase in ("un dado y cada uno paga", "el segundo cuarto", "militar", "el 15 por ciento de 80", "Sube un 10 POR CIENTO"):
            self.assertIsNone(bc.RE_NUMERO_EN_LETRA.search(frase), frase)
        self.assertIsNotNone(bc.RE_NUMERO_EN_LETRA.search("ciento veinte euros"))

    def test_en_mates_sobran_las_variantes_en_letra(self):
        crudo = {"nivel": 3, "pregunta": "¿Cuánto es 1/4 más 1/4?", "respuesta": "1/2", "tambien_vale": ["Un medio", "La mitad", "0,5", "2/4"]}
        self.assertEqual(bc.limpiar(crudo, False, True)["tambien_vale"], ["0,5", "2/4"])
        self.assertEqual(len(bc.limpiar(crudo, False)["tambien_vale"]), 4, "solo en mates")
        nombre = {"nivel": 3, "pregunta": "¿Quién miente?", "respuesta": "Ana", "tambien_vale": ["Anita"]}
        self.assertEqual(bc.limpiar(nombre, False, True)["tambien_vale"], ["Anita"], "si la respuesta no es un número, se quedan")
        # En las demás categorías, los números en letra siguen valiendo.
        otra = {"_clave": "y", "nivel": 2, "pregunta": "¿Qué fruta inventada comen los tres ogros del cuento de prueba Zarbón?", "respuesta": "La zarbona",
                "tambien_vale": [], "explicacion": "Es de color azul."}
        self.assertNotIn("en cifras", str(bc.comprobar(self.ctx, "ciencias", "biologia", otra)))

    def test_opciones_que_no_valen(self):
        q = {**GENERADAS[0], "_clave": "x"}
        self.assertIsNone(bc.comprobar_opciones(q))
        self.assertIsNotNone(bc.comprobar_opciones({**q, "incorrectas": q["incorrectas"][:6]}))
        self.assertIn("forma de la respuesta", bc.comprobar_opciones({**q, "incorrectas": q["incorrectas"][:6] + ["tejon"]}))
        self.assertEqual(bc.comprobar_opciones({**q, "incorrectas": []}), "no trae opciones")

    def test_el_revisor_cambia_opciones(self):
        q = {**GENERADAS[0], "_clave": "x"}
        self.assertIsNone(bc.arreglar_opciones(q, {"opciones_mal": ["un ZORRO"], "opciones_nuevas": ["Una nutria", "Un visón"]}))
        self.assertEqual(q["incorrectas"], ["Un hurón", "Un mapache", "Un castor", "Un erizo", "Un lirón", "Un topo", "Una nutria"])
        self.assertIn("no está", bc.arreglar_opciones(dict(q), {"opciones_mal": ["Un lobo"], "opciones_nuevas": ["Un gato"]}))
        self.assertIn("bastantes", bc.arreglar_opciones(dict(q), {"opciones_mal": ["Un topo"], "opciones_nuevas": ["Un erizo"]}))
        self.assertIsNone(bc.arreglar_opciones(dict(q), {"opciones_mal": [], "opciones_nuevas": []}))

    def test_la_revision_corta_se_lee_por_numero(self):
        pendientes = [{"_clave": f"k{i}"} for i in range(1, 4)]
        por_clave = bc.revisiones_por_clave(REVISION, pendientes)
        self.assertEqual(set(por_clave), {"k1", "k2", "k3"}, "el número 9 no es de este lote")
        self.assertEqual(por_clave["k1"]["tambien_vale_anadir"], ["El tejón"])
        self.assertEqual((por_clave["k2"]["exactitud"], por_clave["k2"]["motivo"]), (2, "El año es dudoso."))
        sin_notas = bc.revisiones_por_clave({"revisiones": [{"n": 1, "propia": "x", "veredicto": "ok", "nivel": 1, "notas": []}]}, pendientes)
        self.assertEqual((sin_notas["k1"]["exactitud"], sin_notas["k1"]["ambiguedad"]), (0, 5), "sin notas, las peores")

    def test_la_rubrica_tiene_las_marcas_que_la_parten(self):
        for cat in ("mates", "geohistoria", "harry_potter", "ciencias"):
            self.assertIn("Qué significa cada nivel", bc.rubrica_para(self.ctx, cat))
        self.assertIn("Harry Potter", bc.rubrica_para(self.ctx, "tema_prueba"))


class TestFlujo(ConLotesDePrueba):
    def codex(self, prompt, esquema, nombre, agente="generar", esperar=True):
        self.llamadas.append((nombre, agente, prompt))
        return {"preguntas": GENERADAS} if agente == "generar" else REVISION

    def test_un_tema_aprobado_es_un_flujo_mas(self):
        self.assertIn(("tema_prueba", "dos"), self.ctx.flujos())
        self.assertIn("tema_prueba", self.ctx.temas)
        self.assertEqual(self.ctx.objetivo_celda("tema_prueba"), bc.OBJETIVO_TEMA // 40 + bc.EXTRA_NICHO_TEMA)
        self.assertEqual(len(bc.rincones(self.ctx, "tema_prueba", "dos", 1)), bc.RINCONES_POR_LOTE)
        self.assertIsNone(bc.tema_limpio({**TEMA, "id": "Tema Prueba"}, set(self.ctx.cats)), "ya existe")
        self.assertIsNone(bc.tema_limpio({**TEMA, "id": "otro", "subtemas": TEMA["subtemas"][:3]}, set()), "le falta un subtema")
        limpio = bc.tema_limpio({**TEMA, "id": "Reguetón español", "aprobado": True}, set())
        self.assertEqual((limpio["id"], limpio["aprobado"]), ("regueton_espanol", False), "lo aprueba el usuario, no el agente")

    def test_redactor_comprobacion_y_revisor(self):
        self.llamadas = []
        st = bc.cargar_estado("tema_prueba", "uno")
        st["rondas"] = 1
        with mock.patch.object(bc, "llamar_codex", self.codex):
            self.assertTrue(bc.generar(self.ctx, "tema_prueba", "uno", st, {1: 1, 2: 1, 3: 1}))
            # La tercera trae la respuesta entre sus opciones: entra, pero sin opciones.
            self.assertEqual([bool(q.get("incorrectas")) for q in st["pendientes"]], [True, True, False])
            self.assertTrue(bc.auditar(self.ctx, "tema_prueba", "uno", st))
        self.assertEqual([agente for _, agente, _ in self.llamadas], ["generar", "auditar"])
        self.assertEqual([q["respuesta"] for q in st["aceptadas"]], ["Un tejón", "El fagot"])
        tejon = st["aceptadas"][0]
        self.assertIn("Una nutria", tejon["incorrectas"])
        self.assertNotIn("Un zorro", tejon["incorrectas"])
        self.assertIn("El tejón", tejon["tambien_vale"])
        self.assertEqual(tejon["_flujo"], 2)
        self.assertEqual((st["descartadas"], st["pendientes"]), (1, []))
        self.assertIn("El año es dudoso", st["lecciones"][0])
        # Y la lección llega al lote siguiente.
        st["rondas"] = 2
        self.assertIn("El año es dudoso", bc.prompt_generar(self.ctx, "tema_prueba", "uno", {4: 1}, st))

    def test_si_el_redactor_no_responde_no_se_gasta_la_ronda(self):
        def sin_respuesta(*a, **k):
            raise RuntimeError("Codex está en el límite de uso")
        with mock.patch.object(bc, "llamar_codex", sin_respuesta):
            linea = bc.flujo(self.ctx, "tema_prueba", "dos", 5)
        self.assertIn("parado", linea)
        self.assertEqual(bc.cargar_estado("tema_prueba", "dos")["rondas"], 0)

    def test_incorporar_lleva_las_opciones_al_modo_solo(self):
        app = self.tmp / "app"
        shutil.copytree(vb.APP / "data", app / "data")
        for objeto, nombre, valor in ((vb, "APP", app), (vb, "LOCK", app / "data" / vb.LOCK.name)):
            parche = mock.patch.object(objeto, nombre, valor)
            parche.start()
            self.addCleanup(parche.stop)
        # En el banco real las casillas ya están en su objetivo: aquí, sitio de sobra para las dos de prueba.
        hueco = mock.patch.object(type(self.ctx), "objetivo_celda", lambda _self, _cat: 10**6)
        hueco.start()
        self.addCleanup(hueco.stop)
        st = bc.cargar_estado("ciencias", "astronomia")
        st["aceptadas"] = [{**GENERADAS[0], "_clave": "cie-ast-n0001", "_revision": 0, "_auditoria": {"exactitud": 5, "ambiguedad": 1, "claridad": 5}},
                           {**GENERADAS[1], "_clave": "cie-ast-n0002", "_revision": 0, "incorrectas": None}]
        bc.guardar_estado("ciencias", "astronomia", st)
        with mock.patch("builtins.print"):
            self.assertEqual(bc.incorporar(self.ctx, ["ciencias/astronomia"]), 2)
        banco = json.loads((app / "data" / "preguntas" / "ciencias.json").read_text(encoding="utf-8"))["preguntas"]
        nueva = next(p for p in banco if p["respuesta"] == "Un tejón")
        self.assertEqual((nueva["origen"], nueva["v"]), ("generada", 1))
        self.assertNotIn("incorrectas", nueva)
        opciones = json.loads((app / "data" / "opciones" / "ciencias.json").read_text(encoding="utf-8"))["opciones"]
        inf = vb.Informe()
        vo.validar_entrada(nueva, opciones[nueva["id"]], inf)
        self.assertEqual(inf.errores, [])
        sin = next(p for p in banco if p["respuesta"] == "1987" and p["pregunta"].startswith("¿En qué año se fundó el club"))
        self.assertNotIn(sin["id"], opciones, "la que no traía opciones no las tiene: se le harán con opciones_codex.py")
        self.assertEqual(bc.cargar_estado("ciencias", "astronomia")["aceptadas"], [])


if __name__ == "__main__":
    unittest.main()
